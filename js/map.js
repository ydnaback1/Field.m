// js/map.js

// EPSG:27700 for Proj4js coordinate transforms
proj4.defs("EPSG:27700", "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");

// Zoom Lookup Table
function getEquivalentWorldZoom(bngZoom) {
  const match = {
    0: 7, 1: 8, 2: 9, 3: 10, 4: 11, 5: 12,
    6: 13, 7: 14, 8: 15, 9: 16, 10: 17, 11: 18, 12: 18
  };
  return match[bngZoom] || 9;
}
function getEquivalentUKZoom(osmZoom) {
  const match = {
    7: 0, 8: 1, 9: 2, 10: 3, 11: 4, 12: 5,
    13: 6, 14: 7, 15: 8, 16: 9, 17: 10, 18: 11
  };
  return match[osmZoom] || 7;
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
  } catch (e) {}
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

// Add other controls (layers, globe, etc) via controls.js
addUKControls(mapUK, ukBaseLayers);
addWorldControls(mapWorld);

// Draw options for both maps
const ukDrawOpts = {
  draw: {
    polyline: {
      shapeOptions: { color: "#ff00f7", weight: 5 },
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

const fab = document.getElementById('fab-route');
const panel = document.getElementById('bottom-panel');
const fabIcon = fab.querySelector('i');
const drawToolbarContainer = document.getElementById('draw-toolbar-container');
const panelContent = document.getElementById('panel-content');
let activeDrawControl = null;

fab.onclick = function() {
  const isOpen = panel.classList.toggle('open');
  fab.classList.toggle('panel-open', isOpen);
  fabIcon.className = isOpen ? 'fas fa-xmark' : 'fas fa-route';
  if (isOpen) {
    showRoutePanelContent();
    addDrawToolbar();
  } else {
    panelContent.innerHTML = '';
    removeDrawToolbar();
  }
};


function showRoutePanelContent() {
  const mode = window.currentMode || 'uk';
  const routes = window.getRouteList(mode);
  const idx = window.currentRouteIndex[mode];
  const currentRoute = (typeof idx === "number" && routes[idx]) ? routes[idx] : {};
  const name = currentRoute.name || 'No route selected';
  let km = "", mi = "";
  if (currentRoute.geojson) {
    const layer = L.geoJSON(currentRoute.geojson);
    let totalMeters = 0;
    layer.eachLayer(l => {
      if (l instanceof L.Polyline) {
        const latlngs = l.getLatLngs();
        for (let i = 1; i < latlngs.length; i++) {
          totalMeters += latlngs[i-1].distanceTo(latlngs[i]);
        }
      }
    });
    km = (totalMeters / 1000).toFixed(2);
    mi = (totalMeters / 1609.344).toFixed(2);
  }
  let timeStr = "";
  if (km) {
    let totalMin = Math.round((km / 5) * 60);
    if (totalMin >= 60) {
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      timeStr = `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
    } else {
      timeStr = `${totalMin}m`;
    }
  }

panelContent.innerHTML = `
  <div style="font-size: 1.28em; font-weight: bold; margin-bottom: 10px;">${name}</div>
  <div class="metric-row">
    ${km ? `<span class="metric-pill"><i class="fa-solid fa-person-walking"></i> ${km} km / ${mi} mi</span>` : ""}
    ${timeStr ? `<span class="metric-pill"><i class="fa-solid fa-stopwatch"></i> ${timeStr}</span>` : ""}
  </div>
  <div>
    <select id="route-list-panel"></select>
  </div>
  <button id="add-route-panel">Draw New Route</button>
  <div class="route-actions-row">
    <button id="load-route-panel" style="margin-right:8px;">Load</button>
    <button id="delete-route-panel" style="margin-left:8px;">Delete</button>
  </div>
`;

  const sel = panelContent.querySelector('#route-list-panel');
  routes.forEach((r, i) => {
    let opt = document.createElement('option');
    opt.value = i;
    opt.textContent = r.name;
    sel.appendChild(opt);
  });
  panelContent.querySelector('#load-route-panel').onclick = function() {
    const idx = sel.value;
    if (idx === '' || idx === null) return;
    window.loadRouteByIndex(mode, idx);
    showRoutePanelContent();
  };
  panelContent.querySelector('#delete-route-panel').onclick = function() {
    const idx = sel.value;
    if (idx === '' || idx === null) return;
    window.deleteRouteFromList(mode, idx);
    window.updateRouteListUI(mode);
    if (mode === 'uk') window.routeLayerUK.clearLayers();
    else window.routeLayerWorld.clearLayers();
    showRoutePanelContent();
  };
  // New route draw button
  panelContent.querySelector('#add-route-panel').onclick = function() {
    document.querySelector('.leaflet-draw-draw-polyline').click();
  };
}


function addDrawToolbar() {
  if (activeDrawControl) return;
  removeDrawToolbar();
  const mode = window.currentMode || 'uk';
  const fg = (mode === 'uk') ? window.routeLayerUK : window.routeLayerWorld;
  activeDrawControl = new L.Control.Draw({
    position: 'topright',
    edit: { featureGroup: fg },
    draw: {
      polyline: {
        shapeOptions: { color: "#FF9500", weight: 5 },
        touchExtend: false,
        finishOnDoubleClick: false
      },
      polygon: false, rectangle: false, circle: false, marker: false, circlemarker: false
    }
  });
  (mode === 'uk' ? mapUK : mapWorld).addControl(activeDrawControl);
  setTimeout(() => {
    const toolbar = document.querySelector('.leaflet-draw-toolbar');
    if (toolbar && drawToolbarContainer) drawToolbarContainer.appendChild(toolbar);
  }, 100);
}

function removeDrawToolbar() {
  if (activeDrawControl) {
    const mode = window.currentMode || 'uk';
    (mode === 'uk' ? mapUK : mapWorld).removeControl(activeDrawControl);
    activeDrawControl = null;
  }
  if (drawToolbarContainer.firstChild) {
    drawToolbarContainer.innerHTML = '';
  }
}


// Route event handlers
mapUK.on(L.Draw.Event.CREATED, function (e) {
  if (e.layerType === 'polyline') {
    let name = prompt("Name this route:");
    window.routeLayerUK.clearLayers();
    if (name) {
      window.saveRouteToList('uk', name, e.layer);
      window.routeLayerUK.addLayer(e.layer);
      window.updateRouteListUI('uk');
    }
  }
});
mapWorld.on(L.Draw.Event.CREATED, function (e) {
  if (e.layerType === 'polyline') {
    let name = prompt("Name this route:");
    window.routeLayerWorld.clearLayers();
    if (name) {
      window.saveRouteToList('world', name, e.layer);
      window.routeLayerWorld.addLayer(e.layer);
      window.updateRouteListUI('world');
    }
  }
});
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

// Update globe icon color based on currentMode
function updateGlobeIcon() {
  var globeControl = document.querySelector('.globe-btn');
  if (!globeControl) return;
  var svg = globeControl.querySelector('svg, i.fas.fa-globe');
  if (!svg) return;
  if (currentMode === 'world') {
    globeControl.classList.add('active');
    if (svg.tagName === 'svg') svg.style.stroke = '#FF9500';
    else svg.style.color = '#FF9500';
  } else {
    globeControl.classList.remove('active');
    if (svg.tagName === 'svg') svg.style.stroke = '#000000';
    else svg.style.color = '#000000';
  }
}

// Initial state
updateGlobeIcon();
