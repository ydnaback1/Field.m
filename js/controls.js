// js/controls.js

function GlobeSwitcherControl() {}
GlobeSwitcherControl.prototype = Object.create(L.Control.prototype);
GlobeSwitcherControl.prototype.onAdd = function(map) {
  var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom globe-btn');
  container.title = 'Switch between UK and Worldwide';
  container.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <ellipse cx="12" cy="12" rx="6" ry="10"/>
      <ellipse cx="12" cy="12" rx="10" ry="6"/>
    </svg>
  `;
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
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map); // Basemap selector (top)
    // Globe control handled in map.js so it's never duplicated
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
    // No need to duplicate Globe or layers here; handled in map.js
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
