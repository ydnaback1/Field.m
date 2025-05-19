// ... all your existing setup code ...

// For mobile: only finish polyline when clicking the checkmark
const ukDrawOpts = {
    draw: {
        polyline: {
            shapeOptions: { color: "#FF9500", weight: 5 },
            touchExtend: false,
            finishOnDoubleClick: false // disables finish on double tap/click
        },
        polygon: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false
    }
};
const worldDrawOpts = {
    draw: {
        polyline: {
            shapeOptions: { color: "#3388ff", weight: 5 },
            touchExtend: false,
            finishOnDoubleClick: false
        },
        polygon: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false
    }
};

// ... create routeLayerUK/routeLayerWorld as before ...

// Add controls (NO DRAW here)
addUKControls(mapUK, ukBaseLayers);
addWorldControls(mapWorld);

// Add RouteControl (stacked as a Leaflet control)
mapUK.addControl(new window.makeRouteControl(mapUK, 'uk', window.routeLayerUK, ukDrawOpts));
mapWorld.addControl(new window.makeRouteControl(mapWorld, 'world', window.routeLayerWorld, worldDrawOpts));

// Drawing event listeners for saving routes
mapUK.on(L.Draw.Event.CREATED, function (e) {
    if (e.layerType === 'polyline') {
        let name = prompt("Name this route:");
        if (!name) return;
        window.saveRouteToList('uk', name, e.layer);
        window.routeLayerUK.clearLayers();
        window.routeLayerUK.addLayer(e.layer);
        window.updateRouteListUI('uk');
    }
});
mapWorld.on(L.Draw.Event.CREATED, function (e) {
    if (e.layerType === 'polyline') {
        let name = prompt("Name this route:");
        if (!name) return;
        window.saveRouteToList('world', name, e.layer);
        window.routeLayerWorld.clearLayers();
        window.routeLayerWorld.addLayer(e.layer);
        window.updateRouteListUI('world');
    }
});

// ---- NEW: When editing, update the route in storage ----
mapUK.on(L.Draw.Event.EDITED, function (e) {
    let idx = window.currentRouteIndex.uk;
    if (idx == null) return;
    e.layers.eachLayer(function(layer) {
        let geojson = layer.toGeoJSON();
        window.updateRouteInList('uk', idx, geojson);
    });
});
mapWorld.on(L.Draw.Event.EDITED, function (e) {
    let idx = window.currentRouteIndex.world;
    if (idx == null) return;
    e.layers.eachLayer(function(layer) {
        let geojson = layer.toGeoJSON();
        window.updateRouteInList('world', idx, geojson);
    });
});

// --- Map mode switching ---
window.switchMap = function(mode) {
    var center, zoom;
    if (currentMode === 'uk') {
        center = mapUK.getCenter();
        zoom = mapUK.getZoom();
        if (mode === 'world') {
            zoom = getEquivalentWorldZoom(zoom);
        }
    } else {
        center = mapWorld.getCenter();
        zoom = mapWorld.getZoom();
        if (mode === 'uk') {
            zoom = getEquivalentUKZoom(zoom);
        }
    }

    if (mode === 'world') {
        document.getElementById('map-uk').style.display = 'none';
        document.getElementById('map-world').style.display = 'block';
        mapWorld.setView([center.lat, center.lng], zoom);
        mapWorld.invalidateSize();
        currentMode = 'world';
    } else {
        document.getElementById('map-uk').style.display = 'block';
        document.getElementById('map-world').style.display = 'none';
        mapUK.setView([center.lat, center.lng], zoom);
        mapUK.invalidateSize();
        currentMode = 'uk';
    }
    updateGlobeIcon();
};
