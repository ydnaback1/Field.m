// js/routes.js

function readRouteList(mode) {
    const key = 'routeList_' + mode;
    let arr = [];
    try {
        arr = JSON.parse(localStorage.getItem(key) || "[]");
    } catch(e) {}
    return Array.isArray(arr) ? arr : [];
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
    const lists = { uk: readRouteList('uk'), world: readRouteList('world') };
    const usedIds = new Set();
    ['uk', 'world'].forEach(mode => {
        if (ensureRouteListIds(lists[mode], usedIds)) {
            try { localStorage.setItem(`routeList_${mode}`, JSON.stringify(lists[mode])); }
            catch (_) { /* A full/blocked store must not prevent the map from starting. */ }
        }
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
    ['uk', 'world'].forEach(mode => {
        routes[mode] = getRouteList(mode)
            .filter(validateBackupRoute)
            .map(copySupportedRouteRecord);
    });
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
    const previous = { uk: localStorage.getItem('routeList_uk'), world: localStorage.getItem('routeList_world') };
    const serialized = { uk: JSON.stringify(nextLists.uk), world: JSON.stringify(nextLists.world) };
    try {
        localStorage.setItem('routeList_uk', serialized.uk);
        localStorage.setItem('routeList_world', serialized.world);
        return { valid: true };
    } catch (error) {
        try {
            ['uk', 'world'].forEach(mode => {
                if (previous[mode] === null) localStorage.removeItem(`routeList_${mode}`);
                else localStorage.setItem(`routeList_${mode}`, previous[mode]);
            });
        } catch (restoreError) {}
        return { valid: false, error: 'There was not enough local storage space to import this backup.' };
    }
}

function applyRouteBackup(backup, strategy) {
    const result = validateRouteBackup(backup);
    if (!result.valid) return result;
    if (strategy !== 'merge' && strategy !== 'replace') return { valid: false, error: 'Choose how to import this backup.' };
    const current = { uk: getRouteList('uk'), world: getRouteList('world') };
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
    let arr = getRouteList(mode);
    const now = new Date().toISOString();
    const route = { name, geojson, createdAt: now, updatedAt: now };
    if (routing) route.routing = routing;
    if (metadata && typeof metadata.sourceRouteId === 'string' && metadata.sourceRouteId) route.sourceRouteId = metadata.sourceRouteId;
    if (metadata && isPlainRouteObject(metadata.activity)) route.activity = metadata.activity;
    ensureRouteId(route, getAllRouteIds());
    arr.push(route);
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    return arr.length - 1;
}

function updateRouteInList(mode, idx, geojson) {
    let arr = getRouteList(mode);
    if (arr[idx]) {
        arr[idx].geojson = geojson;
        // Elevation belongs to this exact displayed line. Any geometry replacement
        // (including editing or future route snapping) makes it stale.
        delete arr[idx].elevation;
        if (typeof window.clearSteepnessDisplay === 'function') window.clearSteepnessDisplay(mode);
        arr[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
        return true;
    }
    return false;
}

function updateRouteElevationInList(mode, idx, elevation) {
    const arr = getRouteList(mode);
    if (!arr[idx]) return false;
    arr[idx].elevation = elevation;
    arr[idx].updatedAt = new Date().toISOString();
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    return true;
}

function replaceRouteGeometryInList(mode, idx, geojson, routing) {
    let arr = getRouteList(mode);
    if (!arr[idx] || !geojson) return false;
    arr[idx].geojson = geojson;
    if (routing) arr[idx].routing = routing;
    else delete arr[idx].routing;
    // Geometry-derived data must never survive a geometry replacement.
    delete arr[idx].elevation;
    delete arr[idx].elevationData;
    delete arr[idx].cachedElevation;
    if (typeof window.clearSteepnessDisplay === 'function') window.clearSteepnessDisplay(mode);
    arr[idx].updatedAt = new Date().toISOString();
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    return true;
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
    let arr = getRouteList(mode);
    if (arr[idx]) {
        arr[idx].name = name;
        arr[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
        return true;
    }
    return false;
}

function updateRouteColorInList(mode, idx, color) {
    let arr = getRouteList(mode);
    if (arr[idx]) {
        arr[idx].color = color;
        arr[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
        return true;
    }
    return false;
}

function getRouteAnnotations(route) {
    return Array.isArray(route && route.annotations) ? route.annotations : [];
}

function updateRouteAnnotationsInList(mode, idx, annotations) {
    let arr = getRouteList(mode);
    if (arr[idx]) {
        arr[idx].annotations = annotations;
        arr[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
        return true;
    }
    return false;
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
    let arr = getRouteList(mode);
    if (!arr[index]) return false;
    arr.splice(index, 1);
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    return true;
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
window.saveRouteToList = saveRouteToList;
window.updateRouteInList = updateRouteInList;
window.fetchRouteElevation = fetchRouteElevation;
window.replaceRouteGeometryInList = replaceRouteGeometryInList;
window.renameRouteInList = renameRouteInList;
window.updateRouteColorInList = updateRouteColorInList;
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
