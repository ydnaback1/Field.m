// js/map.js

// EPSG:27700 for Proj4js coordinate transforms
proj4.defs("EPSG:27700", "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");

// Zoom Lookup Table
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

// Transform BNG to WGS84 for initial center
function transformCoords(arr) {
    return proj4('EPSG:27700', 'EPSG:4326', arr).reverse();
}
var ukInitialCenter = transformCoords([374288, 442016]);
var ukInitialZoom = 7;

// Restore last map state if available
let savedMode = localStorage.getItem('lastMode');
let savedCenter = localStorage.getItem('lastCenter');
let savedZoom = localStorage.getItem('lastZoom');

if (savedCenter && savedZoom) {
    try {
        savedCenter = JSON.parse(savedCenter);
        ukInitialCenter = savedCenter;
        ukInitialZoom = Number(savedZoom);
    } catch(e) {}
}
var currentMode = savedMode || 'uk';

const serviceUrl = CONFIG.serviceUrl;
const apiKey = CONFIG.apiKey;

var bngcrs = new L.Proj.CRS('EPSG:27700',
    '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs', {
        resolutions: [896, 448, 224, 112, 56, 28, 14, 7, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
        origin: [-238375, 1376256]
    }
);

// Initialize maps (one visible at a time)
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

// Feature groups for routes
window.routeLayerUK = new L.FeatureGroup().addTo(mapUK);
window.routeLayerWorld = new L.FeatureGroup().addTo(mapWorld);

// Base layers
var ukBaseLayers = getUKBaseLayers(serviceUrl, apiKey);
ukBaseLayers['OS Road'].addTo(mapUK);
var worldBaseLayer = getWorldBaseLayer();
worldBaseLayer.addTo(mapWorld);

// Add controls (NO DRAW here)
addUKControls(mapUK, ukBaseLayers);
addWorldControls(mapWorld);

// --- Leaflet.draw options (fix mobile: finishOnDoubleClick: false) ---
const ukDrawOpts = {
    draw: {
        polyline: {
            shapeOptions: { color: "#FF9500", weight: 5 },
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

// Add modular route controls (icon+panel+dynamic draw) to maps
const RouteControlUK = window.makeRouteControl(mapUK, 'uk', window.routeLayerUK, ukDrawOpts);
const RouteControlWorld = window.makeRouteControl(mapWorld, 'world', window.routeLayerWorld, worldDrawOpts);

mapUK.addControl(new RouteControlUK());
mapWorld.addControl(new RouteControlWorld());

// Save drawn routes
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

// --- When editing, update route in storage ---
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

// Save map state for persistence
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
    saveMapState();
};

// --- Globe button color update, no globeButton variable required ---
function updateGlobeIcon() {
  var svg = document.querySelector('.leaflet-control-custom svg');
  if (!svg) return;
  if (currentMode === 'world') {
    svg.style.stroke = '#FF9500';
    if(svg.parentElement) svg.parentElement.classList.add('active');
  } else {
    svg.style.stroke = '#000000';
    if(svg.parentElement) svg.parentElement.classList.remove('active');
  }
}

// --- Initial mode on load ---
if (currentMode === 'world') {
    document.getElementById('map-uk').style.display = 'none';
    document.getElementById('map-world').style.display = 'block';
    mapWorld.setView(mapUK.getCenter(), mapWorld.getZoom());
    mapWorld.invalidateSize();
    updateGlobeIcon();
}

updateGlobeIcon();
