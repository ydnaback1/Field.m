// js/routes.js

// -------- Data Helpers --------
function getRouteList(mode) {
    const key = 'routeList_' + mode;
    let arr = [];
    try {
        arr = JSON.parse(localStorage.getItem(key) || "[]");
    } catch(e) {}
    return arr;
}

function saveRouteToList(mode, name, layer) {
    const geojson = layer.toGeoJSON();
    let arr = getRouteList(mode);
    arr.push({ name, geojson });
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
}

function deleteRouteFromList(mode, index) {
    let arr = getRouteList(mode);
    arr.splice(index, 1);
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
}

// -------- UI Management --------
function updateRouteListUI(mode) {
    const list = document.getElementById('route-list');
    const routes = getRouteList(mode);
    list.innerHTML = '';
    routes.forEach((r, i) => {
        let option = document.createElement('option');
        option.value = i;
        option.textContent = r.name;
        list.appendChild(option);
    });
}

// -------- Loading & Fitting --------
function loadRouteByIndex(mode, idx) {
    const routes = getRouteList(mode);
    if (!routes[idx]) return;
    const geojson = routes[idx].geojson;
    let layer = L.geoJSON(geojson, {
        style: mode === 'uk'
            ? { color: "#FF9500", weight: 5 }
            : { color: "#3388ff", weight: 5 }
    });
    if (mode === 'uk') {
        window.routeLayerUK.clearLayers();
        layer.eachLayer(l => window.routeLayerUK.addLayer(l));
        if (layer.getBounds().isValid()) mapUK.fitBounds(layer.getBounds());
    } else {
        window.routeLayerWorld.clearLayers();
        layer.eachLayer(l => window.routeLayerWorld.addLayer(l));
        if (layer.getBounds().isValid()) mapWorld.fitBounds(layer.getBounds());
    }
}

// -------- Event Setup --------
function setupRouteUI() {
    // On Load
    updateRouteListUI(window.currentMode);

    document.getElementById('load-route').onclick = function() {
        const idx = document.getElementById('route-list').value;
        if (idx === '' || idx === null) return;
        loadRouteByIndex(window.currentMode, idx);
    };
    document.getElementById('delete-route').onclick = function() {
        const idx = document.getElementById('route-list').value;
        if (idx === '' || idx === null) return;
        deleteRouteFromList(window.currentMode, idx);
        updateRouteListUI(window.currentMode);
        if (window.currentMode === 'uk') window.routeLayerUK.clearLayers();
        else window.routeLayerWorld.clearLayers();
    };
}

// Expose for use elsewhere
window.getRouteList = getRouteList;
window.saveRouteToList = saveRouteToList;
window.updateRouteListUI = updateRouteListUI;
window.setupRouteUI = setupRouteUI;
