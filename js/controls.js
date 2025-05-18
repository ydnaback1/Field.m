// js/controls.js

function addUKControls(map, baseLayers) {
    L.control.locate().addTo(map);
    L.control.measure({
        position: 'topleft',
        collapsed: true,
        color: '#FF0080'
    }).addTo(map);
    L.control.layers(baseLayers).addTo(map);
}
function addWorldControls(map) {
    L.control.locate().addTo(map);
    L.control.measure({
        position: 'topleft',
        collapsed: true,
        color: '#3388ff'
    }).addTo(map);
}
