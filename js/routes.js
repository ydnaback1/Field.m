// js/routes.js

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

function updateRouteInList(mode, idx, geojson) {
    let arr = getRouteList(mode);
    if (arr[idx]) {
        arr[idx].geojson = geojson;
        localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    }
}

function deleteRouteFromList(mode, index) {
    let arr = getRouteList(mode);
    arr.splice(index, 1);
    localStorage.setItem('routeList_' + mode, JSON.stringify(arr));
    hideRouteInfo(); // Hide info box on delete
}

function updateRouteListUI(mode) {
    const list = document.getElementById(`route-list-${mode}`);
    const routes = getRouteList(mode);
    if (!list) return;
    list.innerHTML = '';
    routes.forEach((r, i) => {
        let option = document.createElement('option');
        option.value = i;
        option.textContent = r.name;
        list.appendChild(option);
    });
}

window.currentRouteIndex = { uk: null, world: null };

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
        window.currentRouteIndex.uk = Number(idx);
    } else {
        window.routeLayerWorld.clearLayers();
        layer.eachLayer(l => window.routeLayerWorld.addLayer(l));
        if (layer.getBounds().isValid()) mapWorld.fitBounds(layer.getBounds());
        window.currentRouteIndex.world = Number(idx);
    }
    showRouteInfo(routes[idx].name, layer);
}

window.getRouteList = getRouteList;
window.saveRouteToList = saveRouteToList;
window.updateRouteInList = updateRouteInList;
window.deleteRouteFromList = deleteRouteFromList;
window.updateRouteListUI = updateRouteListUI;
window.loadRouteByIndex = loadRouteByIndex;

// --- Route Info Box Logic ---
function showRouteInfo(name, layer) {
    let totalMeters = 0;
    if (layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs();
        for (let i = 1; i < latlngs.length; i++) {
            totalMeters += latlngs[i-1].distanceTo(latlngs[i]);
        }
    } else if (layer instanceof L.FeatureGroup || layer instanceof L.GeoJSON) {
        layer.eachLayer(l => {
            if (l instanceof L.Polyline) {
                const latlngs = l.getLatLngs();
                for (let i = 1; i < latlngs.length; i++) {
                    totalMeters += latlngs[i-1].distanceTo(latlngs[i]);
                }
            }
        });
    }
    const km = (totalMeters / 1000).toFixed(2);
    const mi = (totalMeters / 1609.344).toFixed(2);
    let info = `<strong>${name}</strong><br>${km} km / ${mi} mi`;
    let box = document.getElementById('route-info');
    if (box) {
        box.innerHTML = info;
        box.style.display = 'block';
    }
}

function hideRouteInfo() {
    let box = document.getElementById('route-info');
    if (box) box.style.display = 'none';
}
