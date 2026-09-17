const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let watchCalls = 0;
let clearCalls = 0;
let success;
let failure;
global.window = global;
Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: {
  watchPosition(ok, bad) { watchCalls++; success = ok; failure = bad; return 42; },
  clearWatch(id) { assert.equal(id, 42); clearCalls++; }
} } });
global.calculateRouteWalkingTime = (distanceKm, elevation) => ({ usesAscent: Number.isFinite(elevation && elevation.ascent), distanceKm, ascent: elevation && elevation.ascent });
vm.runInThisContext(fs.readFileSync('js/routes.js', 'utf8'), { filename: 'routes.js' });
vm.runInThisContext(fs.readFileSync('js/live-location.js', 'utf8'), { filename: 'live-location.js' });

const api = global.FieldMapsLiveLocation;
const route = { type: 'LineString', coordinates: [[-1, 51], [-0.99, 51], [-0.98, 51]] };
const nearStart = api.matchRouteProgress(route, { lat: 51, lng: -0.9998, accuracy: 5, timestamp: 1000 });
const midpoint = api.matchRouteProgress(route, { lat: 51, lng: -0.99, accuracy: 5, timestamp: 2000 });
const nearEnd = api.matchRouteProgress(route, { lat: 51, lng: -0.9802, accuracy: 5, timestamp: 3000 });
const away = api.matchRouteProgress(route, { lat: 51.002, lng: -0.99, accuracy: 5, timestamp: 4000 });
assert(nearStart.raw.progress < 0.05);
assert(midpoint.raw.progress > 0.45 && midpoint.raw.progress < 0.55);
assert(nearEnd.raw.progress > 0.95);
assert(away.raw.distanceFromRoute > 150);
const elevatedRoute = {
  geojson: route,
  elevation: { samples: [
    { distance: 0, elevation: 100 }, { distance: 700, elevation: 150 }, { distance: 1400, elevation: 120 }, { distance: 2200, elevation: 180 }
  ] }
};
const elevationProgress = api.matchRouteProgress(elevatedRoute, { lat: 51, lng: -0.99, accuracy: 5, timestamp: 4500 });
assert(elevationProgress.elevation.elevation > 140 && elevationProgress.elevation.elevation < 160);
assert(elevationProgress.elevation.remainingAscent > 40);
assert(elevationProgress.remainingTime && elevationProgress.remainingTime.usesAscent);
let state = midpoint.progressState;
for (let i = 0; i < 5; i++) state = api.matchRouteProgress(route, { lat: 51 + (i % 2 ? 0.00001 : -0.00001), lng: -0.99, accuracy: 8, timestamp: 5000 + i * 1000 }, state).progressState;
assert(Math.abs(state.distanceAlong - midpoint.stabilised.distanceAlong) < 15);

const session = api.createSession();
assert.equal(session.start(), true);
assert.equal(session.start(), true);
assert.equal(watchCalls, 1);
success({ coords: { latitude: 51, longitude: -1, accuracy: 5 }, timestamp: 10000 });
assert.equal(session.getState().latestPosition.lat, 51);
assert.equal(api._manager.receive({ coords: { latitude: 51, longitude: -1, accuracy: 5 }, timestamp: 11000 }), false);
assert.equal(api._manager.receive({ coords: { latitude: 52, longitude: -1, accuracy: 5 }, timestamp: 12000 }), false);
failure({ code: 1, message: 'denied' });
assert.equal(session.getState().error.type, 'permission-denied');
session.stop();
assert.equal(clearCalls, 1);
api._manager.teardown();
api._manager.latestPosition = null;

const recorder = api.createSession();
recorder.startRecording();
api._manager.receive({ coords: { latitude: 51, longitude: -1, accuracy: 5 }, timestamp: 20000 });
api._manager.receive({ coords: { latitude: 51, longitude: -0.9999, accuracy: 5 }, timestamp: 24000 });
const beforePause = recorder.getRecording();
assert.equal(beforePause.pointCount, 2);
assert(beforePause.distance > 5);
recorder.pauseRecording();
api._manager.receive({ coords: { latitude: 51, longitude: -0.998, accuracy: 5 }, timestamp: 30000 });
assert.equal(recorder.getRecording().pointCount, 2);
recorder.resumeRecording();
api._manager.receive({ coords: { latitude: 51, longitude: -0.9979, accuracy: 5 }, timestamp: 35000 });
api._manager.receive({ coords: { latitude: 51, longitude: -0.9977, accuracy: 5 }, timestamp: 40000 });
const finished = recorder.finishRecording();
assert.equal(finished.status, 'finished');
assert.equal(finished.geojson.features[0].geometry.type, 'LineString');
assert(finished.geojson.features[0].geometry.coordinates.length >= 3);
assert(finished.distance > beforePause.distance);
console.log('live-location tests passed');
