// js/routes.js

function getRouteList(mode) {
    const key = 'routeList_' + mode;
    let arr = [];
    try {
        arr = JSON.parse(localStorage.getItem(key) || "[]");
    } catch(e) {}
    return Array.isArray(arr) ? arr : [];
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
    const geojson = routes[idx].geojson;
    let layer = L.geoJSON(geojson, {
        style: mode === 'uk'
            ? { color: "#ff33da", weight: 5 }
            : { color: "#3388ff", weight: 5 }
    });
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
window.deleteRouteFromList = deleteRouteFromList;
window.updateRouteListUI = updateRouteListUI;
window.loadRouteByIndex = loadRouteByIndex;
