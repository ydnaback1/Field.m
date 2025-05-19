// js/controls.js

function GlobeSwitcherControl() {}
GlobeSwitcherControl.prototype = Object.create(L.Control.prototype);
GlobeSwitcherControl.prototype.onAdd = function(map) {
  var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom globe-btn');
  container.title = 'Switch between UK and Worldwide';
  container.style.width = '34px';
  container.style.height = '34px';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.innerHTML = `<i class="fas fa-globe"></i>`;
  container.onclick = function(e) {
    e.preventDefault();
    if (window.currentMode === 'uk') {
      window.switchMap('world');
    } else {
      window.switchMap('uk');
    }
  };
  return container;
};

function addUKControls(map, baseLayers) {
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
    map.addControl(new GlobeSwitcherControl({ position: 'topright' }));
    // Route control is handled separately in map.js
    L.control.locate().addTo(map);
    L.control.measure({
        position: 'topleft',
        collapsed: true,
        color: '#FF0080'
    }).addTo(map);
    L.control.scale({
        position: 'bottomleft',
        imperial: false,
        metric: true,
        maxWidth: 200
    }).addTo(map);
}
function addWorldControls(map) {
    map.addControl(new GlobeSwitcherControl({ position: 'topright' }));
    // Route control is handled separately in map.js
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
}
