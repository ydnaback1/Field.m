// js/map.js

// Add EPSG:27700 to Proj4js for coordinate transforms
proj4.defs("EPSG:27700", "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");

// Helper to transform BNG -> WGS84 (for true initial UK center)
function transformCoords(arr) {
    return proj4('EPSG:27700', 'EPSG:4326', arr).reverse();
}
var ukInitialCenter = transformCoords([374288, 442016]);
var ukInitialZoom = 7;

// === [REMEMBER: Restore last map state if available] ===
let savedMode = localStorage.getItem('lastMode');
let savedCenter = localStorage.getItem('lastCenter');
let savedZoom = localStorage.getItem('lastZoom');

if (savedCenter && savedZoom) {
    try {
        savedCenter = JSON.parse(savedCenter);
        // Overwrite initial center/zoom
        ukInitialCenter = savedCenter;
        ukInitialZoom = Number(savedZoom);
    } catch(e) {
        // fallback: do nothing
    }
}
var currentMode = savedMode || 'uk';

// Standard config
const serviceUrl = CONFIG.serviceUrl;
const apiKey = CONFIG.apiKey;

var bngcrs = new L.Proj.CRS('EPSG:27700',
    '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs', {
        resolutions: [896, 448, 224, 112, 56, 28, 14, 7, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
        origin: [-238375, 1376256]
    }
);

// Initialize both maps (only one visible at a time)
var mapUK = L.map('map-uk', {
    crs: bngcrs,
    center: ukInitialCenter,
    zoom: ukInitialZoom,
    attributionControl: false
});
var mapWorld = L.map('map-world', {
    center: ukInitialCenter,
    zoom: getEquivalentWorldZoom(ukInitialZoom),
    attributionControl: false
});

// Add route feature groups (for drawn routes)
window.routeLayerUK = new L.FeatureGroup().addTo(mapUK);
window.routeLayerWorld = new L.FeatureGroup().addTo(mapWorld);

// Add base layers
var ukBaseLayers = getUKBaseLayers(serviceUrl, apiKey);
ukBaseLayers['OS Road'].addTo(mapUK); // Default
var worldBaseLayer = getWorldBaseLayer();
worldBaseLayer.addTo(mapWorld); // Default

// Add controls
addUKControls(mapUK, ukBaseLayers);
addWorldControls(mapWorld);

// Zoom level lookup tables for smooth switching
function getEquivalentWorldZoom(bngZoom) {
  const match = {
    0: 7,
    1: 8,
    2: 9,
    3: 10,
    4: 11,
    5: 12,
    6: 13,
    7: 14,
    8: 15,
    9: 16,
    10: 17,
    11: 18,
    12: 18 // Cap at OSM max
  };
  return match[bngZoom] || 9; // Fallback
}
function getEquivalentUKZoom(osmZoom) {
  const match = {
    7: 0,
    8: 1,
    9: 2,
    10: 3,
    11: 4,
    12: 5,
    13: 6,
    14: 7,
    15: 8,
    16: 9,
    17: 10,
    18: 11
  };
  return match[osmZoom] || 7; // Fallback
}

// Track globe button
var globeButton;

// Custom Globe Control
var GlobeControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function (map) {
    var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    container.title = 'Switch between UK/Worldwide';
    container.innerHTML = `
      <svg id="globe-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <ellipse cx="12" cy="12" rx="6" ry="10" />
        <ellipse cx="12" cy="12" rx="10" ry="6" />
      </svg>
    `;
    container.onclick = function () {
      if (currentMode === 'uk') {
        switchMap('world');
      } else {
        switchMap('uk');
      }
    };
    globeButton = container;
    updateGlobeIcon();
    return container;
  }
});

// Add GlobeControl to both maps
mapUK.addControl(new GlobeControl());
mapWorld.addControl(new GlobeControl());

function updateGlobeIcon() {
  if (!globeButton) return;
  var svg = globeButton.querySelector('svg');
  if (currentMode === 'world') {
    svg.style.stroke = '#FF9500';
    globeButton.classList.add('active');
  } else {
    svg.style.stroke = '#000000';
    globeButton.classList.remove('active');
  }
}

// === [REMEMBER: Save state on move/zoom] ===
function saveMapState() {
    let map, mode = currentMode;
    if (mode === 'uk') map = mapUK;
    else map = mapWorld;
    const center = map.getCenter();
    const zoom = map.getZoom();
    localStorage.setItem('lastMode', mode);
    localStorage.setItem('lastCenter', JSON.stringify([center.lat, center.lng]));
    localStorage.setItem('lastZoom', zoom);
}
mapUK.on('moveend zoomend', saveMapState);
mapWorld.on('moveend zoomend', saveMapState);

// ------- [Drawing Event Listeners for Routes] -------
mapUK.on(L.Draw.Event.CREATED, function (e) {
    if (e.layerType === 'polyline') {
        let name = prompt("Name this route:");
        if (!name) return; // cancel if not named
        saveRouteToList('uk', name, e.layer);
        window.routeLayerUK.clearLayers();
        window.routeLayerUK.addLayer(e.layer);
        updateRouteListUI('uk');
    }
});
mapWorld.on(L.Draw.Event.CREATED, function (e) {
    if (e.layerType === 'polyline') {
        let name = prompt("Name this route:");
        if (!name) return;
        saveRouteToList('world', name, e.layer);
        window.routeLayerWorld.clearLayers();
        window.routeLayerWorld.addLayer(e.layer);
        updateRouteListUI('world');
    }
});

// You may optionally add EDITED handlers for route updating
mapUK.on(L.Draw.Event.EDITED, function (e) {
    // Add logic if you want to allow renaming or re-saving edited routes
});
mapWorld.on(L.Draw.Event.EDITED, function (e) {
    // Add logic here too if needed
});

// ------- [Update Route UI when switching maps] -------
let origSwitchMap = window.switchMap;
window.switchMap = function(mode) {
    origSwitchMap(mode); // call existing
    updateRouteListUI(mode);
};

// ------- [Setup Route UI on page load] -------
setupRouteUI();

// --- Route UI Toggle Logic ---
const toggleBtn = document.getElementById('toggle-route-ui');
const routeUI = document.getElementById('route-ui');
let routeUIVisible = false;
toggleBtn.onclick = function() {
    routeUIVisible = !routeUIVisible;
    routeUI.style.display = routeUIVisible ? "flex" : "none";
};

// === [REMEMBER: Set initial mode on load] ===
if (currentMode === 'world') {
    document.getElementById('map-uk').style.display = 'none';
    document.getElementById('map-world').style.display = 'block';
    mapWorld.setView(mapUK.getCenter(), mapWorld.getZoom());
    mapWorld.invalidateSize();
    updateGlobeIcon();
}

updateGlobeIcon();
