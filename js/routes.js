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

function saveRouteToList(mode, name, layer) {
    const geojson = layer.toGeoJSON();
    let arr = getRouteList(mode);
    const now = new Date().toISOString();
    arr.push({ name, geojson, createdAt: now, updatedAt: now });
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    return arr.length - 1;
}

function updateRouteInList(mode, idx, geojson) {
    let arr = getRouteList(mode);
    if (arr[idx]) {
        arr[idx].geojson = geojson;
        arr[idx].updatedAt = new Date().toISOString();
        localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
        return true;
    }
    return false;
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
    const panelHeight = 200;
    const padding = { paddingBottomRight: [0, panelHeight + 16], paddingTopLeft: [0, 24] };

    if (mode === 'uk') {
        window.routeLayerUK.clearLayers();
        layer.eachLayer(l => window.routeLayerUK.addLayer(l));
        if (layer.getBounds().isValid()) mapUK.fitBounds(layer.getBounds(), padding);
        window.currentRouteIndex.uk = Number(idx);
    } else {
        window.routeLayerWorld.clearLayers();
        layer.eachLayer(l => window.routeLayerWorld.addLayer(l));
        if (layer.getBounds().isValid()) mapWorld.fitBounds(layer.getBounds(), padding);
        window.currentRouteIndex.world = Number(idx);
    }
    return true;
}

window.getRouteList = getRouteList;
window.saveRouteToList = saveRouteToList;
window.updateRouteInList = updateRouteInList;
window.renameRouteInList = renameRouteInList;
window.updateRouteColorInList = updateRouteColorInList;
window.deleteRouteFromList = deleteRouteFromList;
window.updateRouteListUI = updateRouteListUI;
window.loadRouteByIndex = loadRouteByIndex;
window.getRouteColor = getRouteColor;
window.getRouteStyle = getRouteStyle;
window.applyRouteStyle = applyRouteStyle;
