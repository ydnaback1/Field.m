// js/routes.js

function getRouteList(mode) {
    const key = 'routeList_' + mode;
    let arr = [];
    try {
        arr = JSON.parse(localStorage.getItem(key) || "[]");
    } catch(e) {}
    return Array.isArray(arr) ? arr : [];
}

const DEFAULT_ROUTE_COLORS = {
    uk: '#ff33da',
    world: '#3388ff'
};

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

function saveRouteToList(mode, name, layer, routing) {
    const geojson = layer.toGeoJSON();
    let arr = getRouteList(mode);
    const now = new Date().toISOString();
    const route = { name, geojson, createdAt: now, updatedAt: now };
    if (routing) route.routing = routing;
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
    const response = await fetch('https://api.heigit.org/openelevationservice/v0/line', {
        method: 'POST',
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
    if (JSON.stringify(getRouteList(mode)[idx]?.geojson) !== geometryAtRequest) throw new Error('Route geometry changed while elevation was loading');
    if (!updateRouteElevationInList(mode, idx, elevation)) throw new Error('Route was changed while elevation was loading');
    return elevation;
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
    const routes = getRouteList(mode);
    if (!routes[idx] || !routes[idx].geojson) return false;
    const route = routes[idx];
    let layer = L.geoJSON(route.geojson, { style: getRouteStyle(mode, route) });
    const isMobileLayout = typeof window.isMobileRouteLayout === 'function' && window.isMobileRouteLayout();
    const padding = { paddingBottomRight: [0, 216], paddingTopLeft: [0, 24] };

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
