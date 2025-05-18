// js/map.js

// Add EPSG:27700 to Proj4js for coordinate transforms
proj4.defs("EPSG:27700", "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");

// Helper to transform BNG -> WGS84 (for true initial UK center)
function transformCoords(arr) {
    return proj4('EPSG:27700', 'EPSG:4326', arr).reverse();
}
var ukInitialCenter = transformCoords([374288, 442016]);

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
    zoom: 7,
    attributionControl: false
});
var mapWorld = L.map('map-world', {
    center: ukInitialCenter,
    zoom: 5, // best match for UK zoom 7; tweak if needed
    attributionControl: false
});

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
    7: 5,
    8: 6,
    9: 7,
    10: 8,
    11: 9,
    12: 10,
    13: 11
  };
  return match[bngZoom] || 5; // fallback
}
function getEquivalentUKZoom(osmZoom) {
  const match = {
    5: 7,
    6: 8,
    7: 9,
    8: 10,
    9: 11,
    10: 12,
    11: 13
  };
  return match[osmZoom] || 7; // fallback
}

// Track current map mode
var currentMode = 'uk';
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

// Map mode switch, preserving center/zoom with equivalent zoom conversion
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

// Ensure globe icon color is correct on initial load
updateGlobeIcon();
