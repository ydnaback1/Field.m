// js/routes.js

const routeStorageErrors = { uk: null, world: null };
const lastMalformedRouteRaw = { uk: null, world: null };

function routeStorageFailure(error, operation) {
    console.warn(`Route storage ${operation} failed`, error);
    const name = error?.name;
    const code = operation === 'read' || name === 'SecurityError' ? 'blocked'
        : name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014
            ? 'quota' : 'write-failed';
    return { ok: false, code };
}

function readRouteStorage(mode) {
    let raw;
    try { raw = localStorage.getItem(`routeList_${mode}`); }
    catch (error) { return routeStorageFailure(error, 'read'); }
    if (raw === null || raw === '') {
        lastMalformedRouteRaw[mode] = null;
        return { ok: true, routes: [], raw };
    }
    try {
        const routes = JSON.parse(raw);
        if (Array.isArray(routes)) {
            lastMalformedRouteRaw[mode] = null;
            return { ok: true, routes, raw };
        }
    } catch (error) {
        if (lastMalformedRouteRaw[mode] !== raw) console.warn(`Saved ${mode} route data could not be parsed`, error);
    }
    lastMalformedRouteRaw[mode] = raw;
    return { ok: false, code: 'malformed', raw };
}

function writeRouteStorage(mode, routes) {
    const current = readRouteStorage(mode);
    if (!current.ok) return routeStorageErrors[mode] = current;
    let serialized;
    try { serialized = JSON.stringify(routes); }
    catch (error) { return routeStorageErrors[mode] = routeStorageFailure(error, 'write'); }
    try { localStorage.setItem(`routeList_${mode}`, serialized); }
    catch (error) { return routeStorageErrors[mode] = routeStorageFailure(error, 'write'); }
    routeStorageErrors[mode] = null;
    return { ok: true };
}

function mutateRouteStorage(mode, change) {
    const current = readRouteStorage(mode);
    if (!current.ok) return routeStorageErrors[mode] = current;
    const result = change(current.routes);
    if (result === false) return { ok: false, code: 'missing-route' };
    return writeRouteStorage(mode, current.routes);
}

function readRouteList(mode) {
    const result = readRouteStorage(mode);
    return result.ok ? result.routes : [];
}

function getRouteList(mode) {
    return readRouteList(mode);
}

function createRouteId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // This only supports older browsers. The timestamp and random portions make
    // collisions impractical without making an ID depend on route contents.
    return `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function ensureRouteId(route, usedIds) {
    if (!isPlainRouteObject(route)) return false;
    const id = typeof route.id === 'string' && route.id ? route.id : null;
    if (id && (!usedIds || !usedIds.has(id))) {
        if (usedIds) usedIds.add(id);
        return false;
    }
    let nextId = createRouteId();
    while (usedIds && usedIds.has(nextId)) nextId = createRouteId();
    route.id = nextId;
    if (usedIds) usedIds.add(nextId);
    return true;
}

function ensureRouteListIds(routes, usedIds) {
    let changed = false;
    routes.forEach(route => { if (ensureRouteId(route, usedIds)) changed = true; });
    return changed;
}

function getAllRouteIds() {
    return new Set(['uk', 'world'].flatMap(mode => readRouteList(mode)
        .map(route => route && route.id)
        .filter(id => typeof id === 'string' && id)));
}

function migrateStoredRouteIds() {
    if (typeof localStorage === 'undefined') return;
    const usedIds = new Set();
    ['uk', 'world'].forEach(mode => {
        const result = readRouteStorage(mode);
        if (!result.ok) return;
        if (ensureRouteListIds(result.routes, usedIds)) writeRouteStorage(mode, result.routes);
    });
}

const DEFAULT_ROUTE_COLORS = {
    uk: '#ff33da',
    world: '#3388ff'
};

const ROUTE_BACKUP_TYPE = 'field-maps-route-backup';
const ROUTE_BACKUP_VERSION = 1;
const ROUTE_BACKUP_MAX_BYTES = 5 * 1024 * 1024;
const ROUTE_BACKUP_MAX_ROUTES_PER_MAP = 1000;
const ROUTE_BACKUP_FIELDS = [
    'id', 'name', 'geojson', 'color', 'annotations', 'routing', 'elevation',
    'elevationData', 'cachedElevation', 'createdAt', 'updatedAt',
    'sourceRouteId', 'activity'
];

function isPlainRouteObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function copySupportedRouteRecord(route) {
    const copy = {};
    ROUTE_BACKUP_FIELDS.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(route, field)) copy[field] = route[field];
    });
    return copy;
}

function isRouteGeoJson(value) {
    return isPlainRouteObject(value) &&
        (value.type === 'Feature' || value.type === 'FeatureCollection' || value.type === 'LineString' || value.type === 'MultiLineString');
}

function hasValidRouteAnnotation(annotation) {
    return isPlainRouteObject(annotation) &&
        typeof annotation.id === 'string' && annotation.id &&
        typeof annotation.title === 'string' && annotation.title &&
        typeof annotation.note === 'string' &&
        Number.isFinite(annotation.lat) && annotation.lat >= -90 && annotation.lat <= 90 &&
        Number.isFinite(annotation.lng) && annotation.lng >= -180 && annotation.lng <= 180;
}

function validateBackupRoute(route) {
    if (!isPlainRouteObject(route) || !isRouteGeoJson(route.geojson) || !hasValidRouteCoordinates(route.geojson)) return false;
    if (route.name !== undefined && typeof route.name !== 'string') return false;
    if (route.color !== undefined && typeof route.color !== 'string') return false;
    if (route.id !== undefined && (typeof route.id !== 'string' || !route.id)) return false;
    if (route.sourceRouteId !== undefined && (typeof route.sourceRouteId !== 'string' || !route.sourceRouteId)) return false;
    if (route.annotations !== undefined && (!Array.isArray(route.annotations) || !route.annotations.every(hasValidRouteAnnotation))) return false;
    if (route.activity !== undefined) {
        const activity = route.activity;
        if (!isPlainRouteObject(activity) || typeof activity.type !== 'string' || !activity.type ||
            typeof activity.startedAt !== 'string' || typeof activity.endedAt !== 'string' ||
            Number.isNaN(Date.parse(activity.startedAt)) || Number.isNaN(Date.parse(activity.endedAt)) ||
            !Number.isFinite(activity.durationSeconds) || activity.durationSeconds < 0) return false;
    }
    return true;
}

function exportRouteBackup() {
    const routes = {};
    for (const mode of ['uk', 'world']) {
        const result = readRouteStorage(mode);
        if (!result.ok) return result;
        routes[mode] = result.routes
            .filter(validateBackupRoute)
            .map(copySupportedRouteRecord);
    }
    return {
        type: ROUTE_BACKUP_TYPE,
        version: ROUTE_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        routes
    };
}

function validateRouteBackup(backup) {
    if (!isPlainRouteObject(backup) || backup.type !== ROUTE_BACKUP_TYPE || backup.version !== ROUTE_BACKUP_VERSION || !isPlainRouteObject(backup.routes)) {
        return { valid: false, error: 'This is not a Field Maps route backup.' };
    }
    const { uk, world } = backup.routes;
    if (!Array.isArray(uk) || !Array.isArray(world)) {
        return { valid: false, error: 'The backup must contain UK and Worldwide route lists.' };
    }
    if (uk.length > ROUTE_BACKUP_MAX_ROUTES_PER_MAP || world.length > ROUTE_BACKUP_MAX_ROUTES_PER_MAP) {
        return { valid: false, error: 'This backup contains too many routes.' };
    }
    if (![...uk, ...world].every(validateBackupRoute)) {
        return { valid: false, error: 'One or more routes in this backup are invalid.' };
    }
    return {
        valid: true,
        backup: {
            type: ROUTE_BACKUP_TYPE,
            version: ROUTE_BACKUP_VERSION,
            exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : undefined,
            routes: {
                uk: uk.map(copySupportedRouteRecord),
                world: world.map(copySupportedRouteRecord)
            }
        }
    };
}

function saveImportedRouteLists(nextLists) {
    let serialized;
    try { serialized = { uk: JSON.stringify(nextLists.uk), world: JSON.stringify(nextLists.world) }; }
    catch (error) { return { valid: false, ...routeStorageFailure(error, 'write'), error: 'The backup could not be prepared.' }; }
    const previous = {};
    try {
        previous.uk = localStorage.getItem('routeList_uk');
        previous.world = localStorage.getItem('routeList_world');
    } catch (error) {
        return { valid: false, ...routeStorageFailure(error, 'read'), error: 'Browser storage is not available. The backup was not imported.' };
    }
    const written = [];
    try {
        localStorage.setItem('routeList_uk', serialized.uk);
        written.push('uk');
        localStorage.setItem('routeList_world', serialized.world);
        written.push('world');
        return { valid: true };
    } catch (error) {
        const failure = routeStorageFailure(error, 'write');
        const rollbackFailures = [];
        written.reverse().forEach(mode => {
            try {
                if (previous[mode] === null) localStorage.removeItem(`routeList_${mode}`);
                else localStorage.setItem(`routeList_${mode}`, previous[mode]);
            } catch (restoreError) { rollbackFailures.push(mode); routeStorageFailure(restoreError, 'write'); }
        });
        return { valid: false, code: failure.code, rollbackFailed: rollbackFailures.length > 0,
            error: rollbackFailures.length ? `Backup import failed and ${rollbackFailures.join(' and ')} route data could not be restored. Check your saved routes before retrying.`
                : failure.code === 'quota' ? 'Browser storage is full. The backup was not imported.' : 'Browser storage is not available. The backup was not imported.' };
    }
}

function applyRouteBackup(backup, strategy) {
    const result = validateRouteBackup(backup);
    if (!result.valid) return result;
    if (strategy !== 'merge' && strategy !== 'replace') return { valid: false, error: 'Choose how to import this backup.' };
    const current = {};
    for (const mode of ['uk', 'world']) {
        const stored = readRouteStorage(mode);
        if (!stored.ok && (strategy === 'merge' || stored.code !== 'malformed')) {
            return { valid: false, code: stored.code, error: stored.code === 'malformed' ? 'Saved route data could not be read. Download a recovery copy or restore a backup first.' : 'Browser storage is not available. The backup was not imported.' };
        }
        current[mode] = stored.ok ? stored.routes : [];
    }
    const imported = { uk: result.backup.routes.uk.map(copySupportedRouteRecord), world: result.backup.routes.world.map(copySupportedRouteRecord) };
    const existingIds = strategy === 'merge'
        ? new Set([...current.uk, ...current.world].map(route => route && route.id).filter(Boolean))
        : new Set();
    const resultingIds = new Set(existingIds);
    const idMap = new Map();
    ['uk', 'world'].forEach(mode => imported[mode].forEach(route => {
        const importedId = typeof route.id === 'string' && route.id ? route.id : null;
        if (importedId && !resultingIds.has(importedId)) {
            resultingIds.add(importedId);
            idMap.set(importedId, importedId);
        } else {
            const previousId = importedId;
            ensureRouteId(route, resultingIds);
            if (previousId && !idMap.has(previousId)) idMap.set(previousId, route.id);
        }
    }));
    const availableIds = new Set([...existingIds, ...resultingIds]);
    ['uk', 'world'].forEach(mode => imported[mode].forEach(route => {
        if (!route.sourceRouteId) return;
        if (idMap.has(route.sourceRouteId)) route.sourceRouteId = idMap.get(route.sourceRouteId);
        else if (!availableIds.has(route.sourceRouteId)) delete route.sourceRouteId;
    }));
    const nextLists = strategy === 'replace' ? imported : {
        uk: current.uk.concat(imported.uk),
        world: current.world.concat(imported.world)
    };
    return saveImportedRouteLists(nextLists);
}

function getRouteColor(mode, route) {
    return route && typeof route.color === 'string' && route.color ? route.color : DEFAULT_ROUTE_COLORS[mode];
}

function getRouteStyle(mode, route) {
    return { color: getRouteColor(mode, route), weight: 5 };
}

function applyRouteStyle(layer, mode, route) {
    if (!layer) return;
    if (typeof layer.setStyle === 'function') layer.setStyle(getRouteStyle(mode, route));
    if (typeof layer.eachLayer === 'function') {
        layer.eachLayer(child => {
            if (typeof child.setStyle === 'function') child.setStyle(getRouteStyle(mode, route));
        });
    }
}

function saveRouteToList(mode, name, layer, routing, metadata) {
    const geojson = layer.toGeoJSON();
    if (!hasValidRouteCoordinates(geojson)) return null;
    const now = new Date().toISOString();
    const route = { name, geojson, createdAt: now, updatedAt: now };
    if (routing) route.routing = routing;
    if (metadata && typeof metadata.sourceRouteId === 'string' && metadata.sourceRouteId) route.sourceRouteId = metadata.sourceRouteId;
    if (metadata && isPlainRouteObject(metadata.activity)) route.activity = metadata.activity;
    if (metadata && typeof metadata.color === 'string') route.color = metadata.color;
    if (metadata && Array.isArray(metadata.annotations) && metadata.annotations.every(hasValidRouteAnnotation)) route.annotations = metadata.annotations;
    ensureRouteId(route, getAllRouteIds());
    let index = null;
    const result = mutateRouteStorage(mode, arr => { index = arr.push(route) - 1; });
    return result.ok ? index : null;
}

function updateRouteInList(mode, idx, geojson) {
    if (!hasValidRouteCoordinates(geojson)) return false;
    const result = mutateRouteStorage(mode, arr => {
        if (!arr[idx]) return false;
        arr[idx].geojson = geojson;
        // Elevation belongs to this exact displayed line. Any geometry replacement
        // (including editing or future route snapping) makes it stale.
        delete arr[idx].elevation;
        arr[idx].updatedAt = new Date().toISOString();
    });
    if (result.ok && typeof window.clearSteepnessDisplay === 'function') window.clearSteepnessDisplay(mode);
    return result.ok;
}

function updateRouteElevationInList(mode, idx, elevation) {
    return mutateRouteStorage(mode, arr => {
        if (!arr[idx]) return false;
        arr[idx].elevation = elevation;
        arr[idx].updatedAt = new Date().toISOString();
    }).ok;
}

function replaceRouteGeometryInList(mode, idx, geojson, routing) {
    if (!hasValidRouteCoordinates(geojson)) return false;
    const result = mutateRouteStorage(mode, arr => {
        if (!arr[idx]) return false;
        arr[idx].geojson = geojson;
        if (routing) arr[idx].routing = routing;
        else delete arr[idx].routing;
        // Geometry-derived data must never survive a geometry replacement.
        delete arr[idx].elevation;
        delete arr[idx].elevationData;
        delete arr[idx].cachedElevation;
        arr[idx].updatedAt = new Date().toISOString();
    });
    if (result.ok && typeof window.clearSteepnessDisplay === 'function') window.clearSteepnessDisplay(mode);
    return result.ok;
}

function restoreRouteRecordInList(mode, idx, original) {
    if (!validateBackupRoute(original)) return false;
    return mutateRouteStorage(mode, arr => {
        if (!arr[idx] || arr[idx].id !== original.id) return false;
        arr[idx] = original;
    }).ok;
}

const ELEVATION_SAMPLE_INTERVAL_METERS = 60;
const ELEVATION_MAX_SAMPLES = 750;

function routeLineCoordinates(geojson) {
    const lines = [];
    const visit = item => {
        if (!item) return;
        if (item.type === 'Feature') return visit(item.geometry);
        if (item.type === 'FeatureCollection') return item.features.forEach(visit);
        if (item.type === 'LineString') lines.push(item.coordinates);
        if (item.type === 'MultiLineString') item.coordinates.forEach(line => lines.push(line));
    };
    visit(geojson);
    return lines.reduce((points, line) => points.concat(line || []), [])
        .filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
        .map(point => [Number(point[0]), Number(point[1])]);
}

function hasValidRouteCoordinates(geojson) {
    let valid = true;
    let lineCount = 0;
    const checkLine = coordinates => {
        lineCount++;
        if (!Array.isArray(coordinates)) { valid = false; return; }
        let pointCount = 0;
        coordinates.forEach(point => {
            const lng = point && point[0];
            const lat = point && point[1];
            if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) valid = false;
            else pointCount++;
        });
        if (pointCount < 2) valid = false;
    };
    const visit = item => {
        if (!item || typeof item !== 'object') { valid = false; return; }
        if (item.type === 'Feature') return visit(item.geometry);
        if (item.type === 'FeatureCollection') {
            if (!Array.isArray(item.features)) { valid = false; return; }
            item.features.forEach(visit);
        } else if (item.type === 'LineString') checkLine(item.coordinates);
        else if (item.type === 'MultiLineString') {
            if (!Array.isArray(item.coordinates)) { valid = false; return; }
            else item.coordinates.forEach(checkLine);
        } else valid = false;
    };
    visit(geojson);
    return valid && lineCount > 0;
}

function distanceBetweenCoordinates(a, b) {
    const radius = 6371000;
    const toRadians = value => value * Math.PI / 180;
    const dLat = toRadians(b[1] - a[1]);
    const dLng = toRadians(b[0] - a[0]);
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function sampleRouteLine(geojson) {
    const points = routeLineCoordinates(geojson);
    if (points.length < 2) return [];
    const segments = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const length = distanceBetweenCoordinates(points[i - 1], points[i]);
        if (length < 0.01) continue;
        segments.push({ start: points[i - 1], end: points[i], length, distance: total });
        total += length;
    }
    if (!segments.length) return [];
    const interval = Math.max(ELEVATION_SAMPLE_INTERVAL_METERS, total / (ELEVATION_MAX_SAMPLES - 1));
    const distances = [0];
    for (let distance = interval; distance < total - 0.01; distance += interval) distances.push(distance);
    distances.push(total);
    let segmentIndex = 0;
    return distances.map(distance => {
        while (segmentIndex < segments.length - 1 && distance > segments[segmentIndex].distance + segments[segmentIndex].length) segmentIndex++;
        const segment = segments[segmentIndex];
        const ratio = Math.max(0, Math.min(1, (distance - segment.distance) / segment.length));
        return [
            segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
            segment.start[1] + (segment.end[1] - segment.start[1]) * ratio
        ];
    });
}

function returnedElevationCoordinates(result) {
    const geometry = result && (result.geometry || result.features?.[0]?.geometry);
    const coordinates = geometry && geometry.type === 'LineString' ? geometry.coordinates : null;
    if (!Array.isArray(coordinates)) return [];
    return coordinates.filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) && Number.isFinite(Number(point[2])));
}

function elevationSummary(samples) {
    const elevations = samples.map(sample => sample.elevation);
    const smoothed = elevations.map((value, index) => {
        const values = elevations.slice(Math.max(0, index - 1), Math.min(elevations.length, index + 2)).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
    });
    let ascent = 0;
    let descent = 0;
    let anchor = smoothed[0];
    smoothed.slice(1).forEach(value => {
        const delta = value - anchor;
        if (Math.abs(delta) >= 3) {
            if (delta > 0) ascent += delta;
            else descent -= delta;
            anchor = value;
        }
    });
    return {
        ascent: Math.round(ascent),
        descent: Math.round(descent),
        min: Math.round(Math.min(...elevations)),
        max: Math.round(Math.max(...elevations))
    };
}

async function fetchRouteElevation(mode, idx) {
    const route = getRouteList(mode)[idx];
    if (!route || !route.geojson) throw new Error('Route is unavailable');
    const geometryAtRequest = JSON.stringify(route.geojson);
    const coordinates = sampleRouteLine(route.geojson);
    if (coordinates.length < 2) throw new Error('Route needs at least two distinct points');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('https://api.heigit.org/openelevationservice/v0/line', {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: CONFIG.orsApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ format_in: 'geojson', format_out: 'geojson', geometry: { type: 'LineString', coordinates } })
      });
      if (!response.ok) throw new Error('Elevation request failed');
      const returned = returnedElevationCoordinates(await response.json());
      if (returned.length < 2) throw new Error('Elevation response was incomplete');
      const samples = returned.map((point, index) => ({
          distance: index === 0 ? 0 : undefined,
          elevation: Number(point[2]),
          lat: Number(point[1]),
          lng: Number(point[0])
      }));
      for (let index = 1; index < samples.length; index++) {
          samples[index].distance = samples[index - 1].distance + distanceBetweenCoordinates([samples[index - 1].lng, samples[index - 1].lat], [samples[index].lng, samples[index].lat]);
      }
      const elevation = { provider: 'ors', samples, summary: elevationSummary(samples), fetchedAt: new Date().toISOString() };
      const current = getRouteList(mode)[idx];
      if (current?.id !== route.id || JSON.stringify(current?.geojson) !== geometryAtRequest) throw new Error('Route changed while elevation was loading');
      if (!updateRouteElevationInList(mode, idx, elevation)) throw new Error('Route was changed while elevation was loading');
      return elevation;
    } finally { clearTimeout(timeout); }
}

function renameRouteInList(mode, idx, name) {
    return mutateRouteStorage(mode, arr => {
        if (!arr[idx]) return false;
        arr[idx].name = name;
        arr[idx].updatedAt = new Date().toISOString();
    }).ok;
}

function updateRouteColorInList(mode, idx, color) {
    return mutateRouteStorage(mode, arr => {
        if (!arr[idx]) return false;
        arr[idx].color = color;
        arr[idx].updatedAt = new Date().toISOString();
    }).ok;
}

function getRouteAnnotations(route) {
    return Array.isArray(route && route.annotations) ? route.annotations : [];
}

function updateRouteAnnotationsInList(mode, idx, annotations) {
    if (!Array.isArray(annotations) || !annotations.every(hasValidRouteAnnotation)) return false;
    return mutateRouteStorage(mode, arr => {
        if (!arr[idx]) return false;
        arr[idx].annotations = annotations;
        arr[idx].updatedAt = new Date().toISOString();
    }).ok;
}

function saveRouteAnnotation(mode, idx, annotation) {
    const route = getRouteList(mode)[idx];
    if (!route) return false;
    const annotations = getRouteAnnotations(route).slice();
    const next = {
        id: String(annotation.id),
        lat: Number(annotation.lat),
        lng: Number(annotation.lng),
        title: String(annotation.title || ''),
        note: String(annotation.note || '')
    };
    if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng) || !next.title) return false;
    const existingIndex = annotations.findIndex(item => item && item.id === next.id);
    if (existingIndex === -1) annotations.push(next);
    else annotations[existingIndex] = next;
    return updateRouteAnnotationsInList(mode, idx, annotations);
}

function deleteRouteAnnotation(mode, idx, annotationId) {
    const route = getRouteList(mode)[idx];
    if (!route) return false;
    const annotations = getRouteAnnotations(route).filter(item => item && item.id !== annotationId);
    return updateRouteAnnotationsInList(mode, idx, annotations);
}

function deleteRouteFromList(mode, index) {
    return mutateRouteStorage(mode, arr => {
        if (!arr[index]) return false;
        arr.splice(index, 1);
    }).ok;
}

function resetDamagedRouteStorage(mode) {
    const current = readRouteStorage(mode);
    if (current.ok || current.code !== 'malformed') return { ok: false, code: current.ok ? 'not-damaged' : current.code };
    try { localStorage.setItem(`routeList_${mode}`, '[]'); }
    catch (error) { return routeStorageFailure(error, 'write'); }
    routeStorageErrors[mode] = null;
    return { ok: true };
}

function updateRouteListUI(mode) {
    const list = document.getElementById(`route-list-${mode}`);
    const routes = getRouteList(mode);
    if (!list) return;
    list.innerHTML = '';
    routes.forEach((r, i) => {
        if (!r || !r.geojson) return;
        let option = document.createElement('option');
        option.value = i;
        option.textContent = r.name;
        list.appendChild(option);
    });
}

window.currentRouteIndex = { uk: null, world: null };

function loadRouteByIndex(mode, idx) {
    if (typeof window.clearRouteComparison === 'function') window.clearRouteComparison();
    const routes = getRouteList(mode);
    if (!routes[idx] || !routes[idx].geojson || !hasValidRouteCoordinates(routes[idx].geojson)) return false;
    const route = routes[idx];
    let layer = L.geoJSON(route.geojson, { style: getRouteStyle(mode, route) });
    if (typeof window.clearSteepnessDisplay === 'function') window.clearSteepnessDisplay(mode);
    const isMobileLayout = typeof window.isMobileRouteLayout === 'function' && window.isMobileRouteLayout();
    const padding = typeof window.getRouteFitOptions === 'function'
        ? window.getRouteFitOptions()
        : { paddingBottomRight: [0, 216], paddingTopLeft: [0, 24] };

    if (mode === 'uk') {
        window.routeLayerUK.clearLayers();
        layer.eachLayer(l => window.routeLayerUK.addLayer(l));
        if (!isMobileLayout && layer.getBounds().isValid()) mapUK.fitBounds(layer.getBounds(), padding);
        window.currentRouteIndex.uk = Number(idx);
    } else {
        window.routeLayerWorld.clearLayers();
        layer.eachLayer(l => window.routeLayerWorld.addLayer(l));
        if (!isMobileLayout && layer.getBounds().isValid()) mapWorld.fitBounds(layer.getBounds(), padding);
        window.currentRouteIndex.world = Number(idx);
    }
    if (typeof window.renderRouteAnnotations === 'function') window.renderRouteAnnotations(mode, route);
    return true;
}

window.getRouteList = getRouteList;
window.readRouteStorage = readRouteStorage;
window.getRouteStorageError = mode => routeStorageErrors[mode];
window.resetDamagedRouteStorage = resetDamagedRouteStorage;
window.saveRouteToList = saveRouteToList;
window.updateRouteInList = updateRouteInList;
window.fetchRouteElevation = fetchRouteElevation;
window.replaceRouteGeometryInList = replaceRouteGeometryInList;
window.restoreRouteRecordInList = restoreRouteRecordInList;
window.renameRouteInList = renameRouteInList;
window.updateRouteColorInList = updateRouteColorInList;
window.updateRouteAnnotationsInList = updateRouteAnnotationsInList;
window.getRouteAnnotations = getRouteAnnotations;
window.saveRouteAnnotation = saveRouteAnnotation;
window.deleteRouteAnnotation = deleteRouteAnnotation;
window.deleteRouteFromList = deleteRouteFromList;
window.updateRouteListUI = updateRouteListUI;
window.loadRouteByIndex = loadRouteByIndex;
window.getRouteColor = getRouteColor;
window.getRouteStyle = getRouteStyle;
window.applyRouteStyle = applyRouteStyle;
window.ROUTE_BACKUP_MAX_BYTES = ROUTE_BACKUP_MAX_BYTES;
window.exportRouteBackup = exportRouteBackup;
window.validateRouteBackup = validateRouteBackup;
window.applyRouteBackup = applyRouteBackup;
window.ensureRouteId = ensureRouteId;
window.ensureRouteListIds = ensureRouteListIds;

// Legacy lists are updated once at startup. Later reads are deliberately pure,
// so normal route operations never regenerate or churn stored IDs.
migrateStoredRouteIds();
