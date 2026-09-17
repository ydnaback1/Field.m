// Shared, UI-free live location primitives for future navigation and recording.
(function (global) {
  'use strict';

  const MAX_ACCURACY_METERS = 100;
  const DUPLICATE_DISTANCE_METERS = 3;
  const MAX_WALKING_SPEED_MPS = 12;

  function isValidCoordinate(position) {
    return position && Number.isFinite(position.lat) && Number.isFinite(position.lng) &&
      position.lat >= -90 && position.lat <= 90 && position.lng >= -180 && position.lng <= 180;
  }

  function normalisePosition(browserPosition) {
    const coords = browserPosition && browserPosition.coords;
    const lat = Number(coords && coords.latitude);
    const lng = Number(coords && coords.longitude);
    const accuracy = Number(coords && coords.accuracy);
    const timestamp = Number(browserPosition && browserPosition.timestamp);
    const position = { lat, lng, accuracy, timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() };
    return isValidCoordinate(position) && Number.isFinite(accuracy) && accuracy >= 0 ? position : null;
  }

  function positionError(error) {
    const code = Number(error && error.code);
    const type = code === 1 ? 'permission-denied' : code === 2 ? 'position-unavailable' : code === 3 ? 'timeout' : 'unknown';
    return { type, code: Number.isFinite(code) ? code : 0, message: error && error.message ? String(error.message) : type };
  }

  function acceptsPosition(position, previous) {
    if (!isValidCoordinate(position) || !Number.isFinite(position.accuracy) || position.accuracy > MAX_ACCURACY_METERS) return false;
    if (!previous) return true;
    const elapsedSeconds = Math.max(0, (position.timestamp - previous.timestamp) / 1000);
    const moved = distanceBetweenCoordinates([previous.lng, previous.lat], [position.lng, position.lat]);
    if (moved < DUPLICATE_DISTANCE_METERS) return false;
    const jumpLimit = Math.max(75, elapsedSeconds * MAX_WALKING_SPEED_MPS + previous.accuracy + position.accuracy);
    return moved <= jumpLimit;
  }

  function cumulativeDistance(points) {
    return points.reduce((total, point, index) => index ? total + distanceBetweenCoordinates(
      [points[index - 1].lng, points[index - 1].lat], [point.lng, point.lat]
    ) : total, 0);
  }

  function coordinatesFor(geojson) {
    return typeof routeLineCoordinates === 'function' ? routeLineCoordinates(geojson) : [];
  }

  function projectToSegment(point, start, end) {
    const latitude = (point.lat + start[1] + end[1]) / 3 * Math.PI / 180;
    const scaleX = 111320 * Math.cos(latitude);
    const scaleY = 110540;
    const px = point.lng * scaleX, py = point.lat * scaleY;
    const ax = start[0] * scaleX, ay = start[1] * scaleY;
    const bx = end[0] * scaleX, by = end[1] * scaleY;
    const dx = bx - ax, dy = by - ay;
    const ratio = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    const coordinate = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    return { ratio, coordinate, distance: distanceBetweenCoordinates([point.lng, point.lat], coordinate) };
  }

  function nearestRoutePosition(geojson, position) {
    const coordinates = coordinatesFor(geojson);
    if (!isValidCoordinate(position) || coordinates.length < 2) return null;
    let totalDistance = 0;
    let nearest = null;
    for (let index = 1; index < coordinates.length; index++) {
      const segmentLength = distanceBetweenCoordinates(coordinates[index - 1], coordinates[index]);
      if (segmentLength < 0.01) continue;
      const projected = projectToSegment(position, coordinates[index - 1], coordinates[index]);
      if (!nearest || projected.distance < nearest.distanceFromRoute) {
        nearest = {
          coordinate: projected.coordinate,
          lat: projected.coordinate[1], lng: projected.coordinate[0],
          distanceFromRoute: projected.distance,
          distanceAlong: totalDistance + segmentLength * projected.ratio,
          segmentIndex: index - 1
        };
      }
      totalDistance += segmentLength;
    }
    if (!nearest || !totalDistance) return null;
    nearest.totalDistance = totalDistance;
    nearest.distanceRemaining = Math.max(0, totalDistance - nearest.distanceAlong);
    nearest.progress = nearest.distanceAlong / totalDistance;
    return nearest;
  }

  function stabilizeRouteProgress(raw, previous, livePosition) {
    if (!raw) return { match: null, state: previous || null };
    if (!previous) return { match: { ...raw }, state: { distanceAlong: raw.distanceAlong, position: livePosition } };
    const previousPosition = previous.position;
    const gpsMovement = previousPosition && livePosition ? distanceBetweenCoordinates(
      [previousPosition.lng, previousPosition.lat], [livePosition.lng, livePosition.lat]
    ) : Infinity;
    const accuracyAllowance = Math.max(10, Number(livePosition && livePosition.accuracy) || 0, Number(previousPosition && previousPosition.accuracy) || 0);
    const elapsedSeconds = previousPosition && livePosition ? Math.max(0, (livePosition.timestamp - previousPosition.timestamp) / 1000) : 0;
    const maximumProgressChange = Math.max(35, elapsedSeconds * 4 + accuracyAllowance * 2);
    let distanceAlong = raw.distanceAlong;
    // At crossings or during a stationary accuracy wobble, retain the existing branch.
    if (gpsMovement <= accuracyAllowance && Math.abs(raw.distanceAlong - previous.distanceAlong) > accuracyAllowance) distanceAlong = previous.distanceAlong;
    else if (Math.abs(raw.distanceAlong - previous.distanceAlong) > maximumProgressChange) {
      distanceAlong = previous.distanceAlong + Math.sign(raw.distanceAlong - previous.distanceAlong) * maximumProgressChange;
    } else if (raw.distanceAlong < previous.distanceAlong && previous.distanceAlong - raw.distanceAlong <= accuracyAllowance) {
      distanceAlong = previous.distanceAlong;
    }
    distanceAlong = Math.max(0, Math.min(raw.totalDistance, distanceAlong));
    const match = { ...raw, distanceAlong, distanceRemaining: raw.totalDistance - distanceAlong, progress: distanceAlong / raw.totalDistance };
    return { match, state: { distanceAlong, position: livePosition } };
  }

  function elevationAtDistance(route, distanceAlong) {
    const samples = route && route.elevation && Array.isArray(route.elevation.samples) ? route.elevation.samples.filter(sample =>
      Number.isFinite(sample && sample.distance) && Number.isFinite(sample && sample.elevation)
    ) : [];
    if (samples.length < 2 || !Number.isFinite(distanceAlong)) return null;
    let index = 1;
    while (index < samples.length - 1 && samples[index].distance < distanceAlong) index++;
    const before = samples[index - 1], after = samples[index];
    const span = after.distance - before.distance;
    const ratio = span > 0 ? Math.max(0, Math.min(1, (distanceAlong - before.distance) / span)) : 0;
    const elevation = before.elevation + (after.elevation - before.elevation) * ratio;
    const remainingSamples = [{ distance: distanceAlong, elevation }].concat(samples.slice(index));
    let remainingAscent = 0;
    for (let i = 1; i < remainingSamples.length; i++) {
      const gain = remainingSamples[i].elevation - remainingSamples[i - 1].elevation;
      if (gain >= 3) remainingAscent += gain;
    }
    return { elevation, profileDistance: distanceAlong, profileProgress: distanceAlong / samples[samples.length - 1].distance, remainingAscent };
  }

  function matchRouteProgress(routeOrGeojson, position, progressState) {
    const route = routeOrGeojson && routeOrGeojson.geojson ? routeOrGeojson : null;
    const raw = nearestRoutePosition(route ? route.geojson : routeOrGeojson, position);
    if (!raw) return { raw: null, stabilised: null, progressState: progressState || null, elevation: null, remainingTime: null };
    const stable = stabilizeRouteProgress(raw, progressState, position);
    const elevation = elevationAtDistance(route, stable.match.distanceAlong);
    const remainingTime = typeof calculateRouteWalkingTime === 'function' ? calculateRouteWalkingTime(
      stable.match.distanceRemaining / 1000, elevation ? { ascent: elevation.remainingAscent } : null
    ) : null;
    return { raw, stabilised: stable.match, progressState: stable.state, elevation, remainingTime };
  }

  function bearingChange(a, b, c) {
    const toXY = (from, to) => {
      const latitude = (from.lat + to.lat) / 2 * Math.PI / 180;
      return [(to.lng - from.lng) * 111320 * Math.cos(latitude), (to.lat - from.lat) * 110540];
    };
    const first = toXY(a, b), second = toXY(b, c);
    const firstLength = Math.hypot(first[0], first[1]), secondLength = Math.hypot(second[0], second[1]);
    if (!firstLength || !secondLength) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (first[0] * second[0] + first[1] * second[1]) / (firstLength * secondLength)))) * 180 / Math.PI;
  }

  function shouldRetainRecordingPoint(points, point) {
    if (!points.length) return true;
    const previous = points[points.length - 1];
    const moved = distanceBetweenCoordinates([previous.lng, previous.lat], [point.lng, point.lat]);
    const elapsed = Math.max(0, point.timestamp - previous.timestamp);
    if (moved >= 5 || elapsed >= 20000) return true;
    return points.length >= 2 && moved >= 2.5 && bearingChange(points[points.length - 2], previous, point) >= 30;
  }

  function recordingGeoJSON(points) {
    const coordinates = points.map(point => [point.lng, point.lat]);
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] };
  }

  const manager = {
    watcherId: null, sessions: new Set(), latestPosition: null, error: null,
    start(session) {
      this.sessions.add(session);
      if (this.watcherId !== null) return true;
      if (!global.navigator || !global.navigator.geolocation || typeof global.navigator.geolocation.watchPosition !== 'function') {
        this.error = { type: 'unsupported', code: 0, message: 'Live location is unavailable in this browser.' };
        this.sessions.delete(session);
        session.onLocationError(this.error);
        return false;
      }
      this.error = null;
      this.watcherId = global.navigator.geolocation.watchPosition(
        browserPosition => this.receive(browserPosition), error => this.receiveError(error),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
      return true;
    },
    stop(session) {
      this.sessions.delete(session);
      if (this.sessions.size || this.watcherId === null) return;
      if (global.navigator && global.navigator.geolocation && typeof global.navigator.geolocation.clearWatch === 'function') global.navigator.geolocation.clearWatch(this.watcherId);
      this.watcherId = null;
    },
    receive(browserPosition) {
      const position = normalisePosition(browserPosition);
      if (!position || !acceptsPosition(position, this.latestPosition)) return false;
      this.latestPosition = position;
      this.error = null;
      this.sessions.forEach(session => session.onLocation(position));
      return true;
    },
    receiveError(browserError) {
      this.error = positionError(browserError);
      this.sessions.forEach(session => session.onLocationError(this.error));
    },
    teardown() {
      this.sessions.clear();
      if (this.watcherId !== null && global.navigator && global.navigator.geolocation && typeof global.navigator.geolocation.clearWatch === 'function') global.navigator.geolocation.clearWatch(this.watcherId);
      this.watcherId = null;
    }
  };

  function createSession() {
    const session = {
      active: false, latestPosition: null, error: null, recording: null,
      start() { if (this.active) return true; this.active = manager.start(this); return this.active; },
      stop() { if (!this.active) return; this.active = false; manager.stop(this); },
      onLocation(position) {
        this.latestPosition = position;
        this.error = null;
        if (this.recording && this.recording.status === 'recording' && shouldRetainRecordingPoint(this.recording.points, position)) {
          const previous = this.recording.points[this.recording.points.length - 1];
          this.recording.points.push(position);
          // A resumed recording deliberately starts a fresh distance segment: movement
          // while paused must not be counted as recorded distance.
          if (!this.recording.pendingResume && previous) this.recording.distance += distanceBetweenCoordinates([previous.lng, previous.lat], [position.lng, position.lat]);
          this.recording.pendingResume = false;
        }
      },
      onLocationError(error) { this.error = error; },
      startRecording() {
        this.recording = { status: 'recording', points: [], distance: 0, startTime: Date.now(), pausedAt: null, finishedAt: null, pausedDuration: 0, pendingResume: false };
        this.start();
        return this.getRecording();
      },
      pauseRecording() { if (this.recording && this.recording.status === 'recording') { this.recording.status = 'paused'; this.recording.pausedAt = Date.now(); } return this.getRecording(); },
      resumeRecording() { if (this.recording && this.recording.status === 'paused') { this.recording.pausedDuration += Date.now() - this.recording.pausedAt; this.recording.pausedAt = null; this.recording.pendingResume = true; this.recording.status = 'recording'; } return this.getRecording(); },
      finishRecording() { if (!this.recording) return null; this.recording.finishedAt = Date.now(); const result = this.getRecording(); result.status = 'finished'; result.geojson = recordingGeoJSON(this.recording.points); this.recording.status = 'finished'; this.stop(); return result; },
      resumeFinishedRecording() {
        if (!this.recording || this.recording.status !== 'finished') return this.getRecording();
        this.recording.pausedDuration += Date.now() - this.recording.finishedAt;
        this.recording.finishedAt = null;
        this.recording.pendingResume = true;
        this.recording.status = 'recording';
        this.start();
        return this.getRecording();
      },
      cancelRecording() { this.recording = null; this.stop(); },
      getRecording() {
        if (!this.recording) return null;
        const now = this.recording.pausedAt || this.recording.finishedAt || Date.now();
        return { status: this.recording.status, points: this.recording.points.slice(), pointCount: this.recording.points.length, distance: this.recording.distance, startTime: this.recording.startTime, elapsed: Math.max(0, now - this.recording.startTime - this.recording.pausedDuration) };
      },
      getState() { return { active: this.active, latestPosition: this.latestPosition, accuracy: this.latestPosition && this.latestPosition.accuracy, error: this.error || manager.error }; }
    };
    return session;
  }

  global.FieldMapsLiveLocation = { createSession, normalisePosition, acceptsPosition, cumulativeDistance, nearestRoutePosition, matchRouteProgress, recordingGeoJSON, _manager: manager };
  if (global.addEventListener) global.addEventListener('beforeunload', () => manager.teardown());
})(window);
