function addUKControls(map, baseLayers) {
    L.control.locate().addTo(map);
    L.control.measure({
        position: 'topleft',
        collapsed: true,
        color: '#FF0080'
    }).addTo(map);
    L.control.layers(baseLayers).addTo(map);
    L.control.scale({
        position: 'bottomleft',
        imperial: false,
        metric: true,
        maxWidth: 200
    }).addTo(map);

    // Draw control for polylines (walking routes) - top right
    var drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polyline: { shapeOptions: { color: "#FF9500", weight: 5 } },
            polygon: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false
        },
        edit: { featureGroup: window.routeLayerUK }
    });
    map.addControl(drawControl);
}

function addWorldControls(map) {
    L.control.locate().addTo(map);
    L.control.measure({
        position: 'topleft',
        collapsed: true,
        color: '#3388ff'
    }).addTo(map);
    L.control.scale({
        position: 'bottomleft',
        imperial: true,
        metric: true,
        maxWidth: 200
    }).addTo(map);

    var drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polyline: { shapeOptions: { color: "#3388ff", weight: 5 } },
            polygon: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false
        },
        edit: { featureGroup: window.routeLayerWorld }
    });
    map.addControl(drawControl);
}
