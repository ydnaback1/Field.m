// js/map.js

// UK Projection
const serviceUrl = CONFIG.serviceUrl;
const apiKey = CONFIG.apiKey;

var bngcrs = new L.Proj.CRS('EPSG:27700',
    '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs', {
        resolutions: [896, 448, 224, 112, 56, 28, 14, 7, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
        origin: [-238375, 1376256]
    }
);

// Map Containers
var mapUK = L.map('map-uk', {
    crs: bngcrs,
    center: [51.5, -0.12],
    zoom: 7,
    attributionControl: false
});
var mapWorld = L.map('map-world', {
    center: [51.5, -0.12],
    zoom: 4,
    attributionControl: false
});

// Basemaps
var ukBaseLayers = getUKBaseLayers(serviceUrl, apiKey);
ukBaseLayers['OS Road'].addTo(mapUK); // Default
var worldBaseLayer = getWorldBaseLayer();
worldBaseLayer.addTo(mapWorld); // Default

// Controls
addUKControls(mapUK, ukBaseLayers);
addWorldControls(mapWorld);

// Initialize sidebar
var sidebar = L.control.sidebar({
  container: 'sidebar',
  position: 'left'
}).addTo(mapUK); // Attach to UK map by default

sidebar.open('home');

// Dynamically build sidebar content
function buildSidebarContent() {
  var html = `
    <div class="sidebar-buttons">
      <h3>UK Basemaps</h3>
      <button onclick="setUKBaseLayer('OS Road')">OS Road</button>
      <button onclick="setUKBaseLayer('OS Outdoor')">OS Outdoor</button>
      <button onclick="setUKBaseLayer('OS Leisure')">OS Leisure</button>
      <hr>
      <h3>Map Mode</h3>
      <button onclick="switchMap('uk')">UK</button>
      <button onclick="switchMap('world')">Worldwide</button>
    </div>
  `;
  document.getElementById('sidebar-content').innerHTML = html;
}

// Base layer switch for UK
window.setUKBaseLayer = function(name) {
  Object.values(ukBaseLayers).forEach(layer => mapUK.removeLayer(layer));
  ukBaseLayers[name].addTo(mapUK);
};

// Map mode switch
window.switchMap = function(mode) {
  if (mode === 'uk') {
    document.getElementById('map-uk').style.display = 'block';
    document.getElementById('map-world').style.display = 'none';
    sidebar.addTo(mapUK);
    mapUK.invalidateSize();
  } else {
    document.getElementById('map-uk').style.display = 'none';
    document.getElementById('map-world').style.display = 'block';
    sidebar.addTo(mapWorld);
    mapWorld.invalidateSize();
  }
};

buildSidebarContent();
