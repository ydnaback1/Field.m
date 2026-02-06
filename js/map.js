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
var worldInitialCenter = ukInitialCenter;
var worldInitialZoom = getEquivalentWorldZoom(ukInitialZoom);

// Restore last map state if available
let savedMode = localStorage.getItem('lastMode');
let savedCenter = localStorage.getItem('lastCenter');
let savedZoom = localStorage.getItem('lastZoom');
if (savedCenter && savedZoom) {
  try {
    savedCenter = JSON.parse(savedCenter);
    savedZoom = Number(savedZoom);
    if (savedMode === 'world') {
      worldInitialCenter = savedCenter;
      worldInitialZoom = savedZoom;
    } else {
      ukInitialCenter = savedCenter;
      ukInitialZoom = savedZoom;
    }
  } catch (e) {}
}
var currentMode = savedMode || 'uk';

const serviceUrl = CONFIG.serviceUrl;
const apiKey = CONFIG.apiKey;

var bngcrs = new L.Proj.CRS('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
  '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs', {
    resolutions: [896, 448, 224, 112, 56, 28, 14, 7, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
    origin: [-238375, 1376256],
    bounds: L.bounds([0, 0], [700000, 1300000])
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
  center: worldInitialCenter,
  zoom: worldInitialZoom,
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

if (L.Draw.Polyline) {
  L.Draw.Polyline.include({
    _onTouch: function(e) {
      // Only allow double-tap to finish if more than 2 points (i.e., after 3rd point)
      if (this._markers.length < 2) {
        // Prevent default Leaflet Draw double-tap behavior when only one segment
        e.preventDefault();
        return false;
      }
      // Otherwise, fallback to default (which allows finish)
      return L.Handler.prototype._onTouch.call(this, e);
    }
  });
}


// --- Panel, FAB, and Draw Control State ---
const fab = document.getElementById('fab-route');
const panel = document.getElementById('bottom-panel');
const fabIcon = fab.querySelector('i');
const drawToolbarContainer = document.getElementById('draw-toolbar-container');
const panelContent = document.getElementById('panel-content');
let activeDrawControl = null;

let drawingMode = false;
let editingMode = false;

// --- Panel Main Function ---
function getDefaultRouteName(mode) {
  const routes = window.getRouteList(mode);
  const baseName = 'Route';
  let nextIndex = routes.length + 1;
  while (routes.some(route => route.name === `${baseName} ${nextIndex}`)) {
    nextIndex += 1;
  }
  return `${baseName} ${nextIndex}`;
}

function getRouteMetrics(geojson) {
  if (!geojson) return { km: "", mi: "", timeStr: "" };
  const layer = L.geoJSON(geojson);
  let totalMeters = 0;
  layer.eachLayer(l => {
    if (l instanceof L.Polyline) {
      const latlngs = l.getLatLngs();
      for (let i = 1; i < latlngs.length; i++) {
        totalMeters += latlngs[i - 1].distanceTo(latlngs[i]);
      }
    }
  });
  if (!totalMeters) return { km: "", mi: "", timeStr: "" };
  const km = (totalMeters / 1000).toFixed(2);
  const mi = (totalMeters / 1609.344).toFixed(2);
  let timeStr = "";
  let totalMin = Math.round((km / 5) * 60);
  if (totalMin >= 60) {
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    timeStr = `${hours}h ${mins > 0 ? `${mins}m` : ""}`;
  } else {
    timeStr = `${totalMin}m`;
  }
  return { km, mi, timeStr };
}

function getShareableRouteName(route) {
  return route && route.name ? route.name : 'Shared Route';
}

function encodeRoutePayload(route) {
  const payload = {
    name: getShareableRouteName(route),
    geojson: route.geojson
  };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeRoutePayload(encoded) {
  const json = decodeURIComponent(escape(atob(encoded)));
  return JSON.parse(json);
}

function getSharedRouteFromUrl() {
  const url = new URL(window.location.href);
  const routeParam = url.searchParams.get('route');
  if (!routeParam) return null;
  try {
    return decodeRoutePayload(routeParam);
  } catch (e) {
    return null;
  }
}

function clearSharedRouteParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('route')) return;
  url.searchParams.delete('route');
  window.history.replaceState({}, document.title, url.toString());
}

function routeGeojsonToGpx(routeName, geojson) {
  const layer = L.geoJSON(geojson);
  let points = [];
  layer.eachLayer(l => {
    if (l instanceof L.Polyline) {
      l.getLatLngs().forEach(latlng => {
        points.push(latlng);
      });
    }
  });
  const safeName = routeName.replace(/[<>]/g, '');
  const gpxPoints = points
    .map(p => `    <trkpt lat="${p.lat}" lon="${p.lng}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Field Maps" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n` +
    `    <name>${safeName}</name>\n` +
    `    <trkseg>\n` +
    `${gpxPoints}\n` +
    `    </trkseg>\n` +
    `  </trk>\n` +
    `</gpx>`;
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showRoutePanelContent() {
  const mode = window.currentMode || 'uk';
  const routes = window.getRouteList(mode);
  const idx = window.currentRouteIndex[mode];
  const hasRoutes = routes.length > 0;
  const activeIndex = (typeof idx === "number" && routes[idx]) ? idx : (hasRoutes ? 0 : null);
  const currentRoute = activeIndex !== null ? routes[activeIndex] : null;
  if (hasRoutes && activeIndex !== idx) {
    window.currentRouteIndex[mode] = activeIndex;
  }
  const name = currentRoute ? currentRoute.name : 'No routes saved';
  const { km, mi, timeStr } = getRouteMetrics(currentRoute?.geojson);

  // --- Action Buttons as Icons ---
  let actionButtonHtml = '';
  if (drawingMode) {
    actionButtonHtml = `<button id="save-route-panel" class="primary-action" aria-label="Save"><i class="fa-solid fa-check"></i></button>`;
  } else if (editingMode) {
    actionButtonHtml = `<button id="save-edit-route-panel" class="primary-action" aria-label="Save"><i class="fa-solid fa-check"></i></button>`;
  } else {
    actionButtonHtml = `<button id="add-route-panel" class="primary-action" aria-label="Draw New Route"><i class="fa-solid fa-plus"></i></button>`;
    if (currentRoute && currentRoute.geojson) {
      actionButtonHtml += `<button id="edit-route-panel" class="primary-action" aria-label="Edit Route"><i class="fa-solid fa-pen-to-square"></i></button>`;
      actionButtonHtml += `<button id="delete-route-panel" class="primary-action" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>`;
    }
  }

  // --- Panel HTML ---
  const shareControls = currentRoute && currentRoute.geojson ? `
    <div class="secondary-actions-row">
      <button class="secondary-action" id="share-route-panel">
        <i class="fa-solid fa-link"></i> Share
      </button>
      <button class="secondary-action" id="export-geojson-panel">
        <i class="fa-solid fa-file-code"></i> GeoJSON
      </button>
      <button class="secondary-action" id="export-gpx-panel">
        <i class="fa-solid fa-file-arrow-down"></i> GPX
      </button>
    </div>
    <div class="panel-status" id="share-status" aria-live="polite"></div>
  ` : "";

  panelContent.innerHTML = `
    <div class="route-title" style="font-size: 1.15em; font-weight: bold; margin-bottom: 10px;">${name}</div>
    <div class="metric-row" style="font-size:1em;">
      ${km ? `<span class="metric-pill"><i class="fa-solid fa-person-walking"></i> ${km} km / ${mi} mi</span>` : ""}
      ${timeStr ? `<span class="metric-pill"><i class="fa-solid fa-stopwatch"></i> ${timeStr}</span>` : ""}
    </div>
    <div>
      <select id="route-list-panel" ${hasRoutes ? "" : "disabled"}></select>
    </div>
    ${hasRoutes ? "" : `<div class="panel-empty">No routes saved yet. Tap + to draw your first route.</div>`}
    <div class="route-actions-row">
      ${actionButtonHtml}
    </div>
    ${shareControls}
  `;

  // --- Fill Dropdown ---
  const sel = panelContent.querySelector('#route-list-panel');
  if (hasRoutes) {
    routes.forEach((r, i) => {
      let opt = document.createElement('option');
      opt.value = i;
      opt.textContent = r.name;
      sel.appendChild(opt);
    });
    if (activeIndex !== null) sel.value = activeIndex;
  } else {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No routes yet';
    sel.appendChild(opt);
  }

  // --- Onchange: load route on selection ---
  sel.onchange = function() {
    const idx = sel.value;
    if (idx === '' || idx === null) return;
    window.loadRouteByIndex(mode, idx);
    drawingMode = false;
    editingMode = false;
    showRoutePanelContent();
  };

  // --- Draw New Route ---
  const addBtn = panelContent.querySelector('#add-route-panel');
  if (addBtn) {
    addBtn.onclick = function() {
      drawingMode = true;
      editingMode = false;
      showRoutePanelContent();
      const map = (mode === 'uk') ? mapUK : mapWorld;
      const drawControl = activeDrawControl;
      if (drawControl && drawControl._toolbars && drawControl._toolbars.draw) {
        drawControl._toolbars.draw._modes.polyline.handler.enable();
      }
    };
  }

  // --- Edit ---
  const editBtn = panelContent.querySelector('#edit-route-panel');
  if (editBtn) {
    editBtn.onclick = function() {
      editingMode = true;
      drawingMode = false;
      showRoutePanelContent();
      const drawControl = activeDrawControl;
      if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        drawControl._toolbars.edit._modes.edit.handler.enable();
      }
    };
  }

  // --- Delete ---
  const delBtn = panelContent.querySelector('#delete-route-panel');
  if (delBtn) {
    delBtn.onclick = function() {
      const idx = sel.value;
      if (idx === '' || idx === null) return;
      window.deleteRouteFromList(mode, idx);
      window.updateRouteListUI(mode);
      if (mode === 'uk') window.routeLayerUK.clearLayers();
      else window.routeLayerWorld.clearLayers();
      drawingMode = false;
      editingMode = false;
      showRoutePanelContent();
    };
  }

  // --- Save (drawing mode) ---
  const saveBtn = panelContent.querySelector('#save-route-panel');
  if (saveBtn) {
    saveBtn.onclick = function() {
      const map = (mode === 'uk') ? mapUK : mapWorld;
      const drawControl = activeDrawControl;
      if (drawControl && drawControl._toolbars && drawControl._toolbars.draw) {
        drawControl._toolbars.draw._modes.polyline.handler.completeShape();
        drawControl._toolbars.draw._modes.polyline.handler.disable();
      }
      drawingMode = false;
      showRoutePanelContent();
    };
  }

  // --- Save Edit ---
  const saveEditBtn = panelContent.querySelector('#save-edit-route-panel');
  if (saveEditBtn) {
    saveEditBtn.onclick = function() {
      const drawControl = activeDrawControl;
      if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        drawControl._toolbars.edit._modes.edit.handler.save();
        drawControl._toolbars.edit._modes.edit.handler.disable();
      }
      editingMode = false;
      showRoutePanelContent();
    };
  }

  // --- Share + Export ---
  const shareBtn = panelContent.querySelector('#share-route-panel');
  const exportGeoBtn = panelContent.querySelector('#export-geojson-panel');
  const exportGpxBtn = panelContent.querySelector('#export-gpx-panel');
  const shareStatus = panelContent.querySelector('#share-status');

  if (shareBtn && currentRoute) {
    shareBtn.onclick = async function() {
      const url = new URL(window.location.href);
      const encoded = encodeRoutePayload(currentRoute);
      url.searchParams.set('route', encoded);
      const shareUrl = url.toString();
      let message = "Share link copied!";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
        } else {
          prompt("Copy this link to share:", shareUrl);
          message = "Share link ready.";
        }
      } catch (e) {
        prompt("Copy this link to share:", shareUrl);
        message = "Share link ready.";
      }
      if (shareStatus) {
        shareStatus.textContent = message;
        setTimeout(() => {
          if (shareStatus) shareStatus.textContent = "";
        }, 3000);
      }
    };
  }

  if (exportGeoBtn && currentRoute) {
    exportGeoBtn.onclick = function() {
      const fileName = `${currentRoute.name || 'route'}.geojson`;
      const content = JSON.stringify(currentRoute.geojson, null, 2);
      downloadTextFile(fileName, content, 'application/geo+json');
    };
  }

  if (exportGpxBtn && currentRoute) {
    exportGpxBtn.onclick = function() {
      const fileName = `${currentRoute.name || 'route'}.gpx`;
      const gpx = routeGeojsonToGpx(currentRoute.name || 'Route', currentRoute.geojson);
      downloadTextFile(fileName, gpx, 'application/gpx+xml');
    };
  }
}

// --- Draw Toolbar Logic ---
function addDrawToolbar() {
  if (activeDrawControl) return;
  removeDrawToolbar();
  const mode = window.currentMode || 'uk';
  const fg = (mode === 'uk') ? window.routeLayerUK : window.routeLayerWorld;
  activeDrawControl = new L.Control.Draw({
    position: 'topright',
    edit: { featureGroup: fg },
    draw: (mode === 'uk') ? ukDrawOpts.draw : worldDrawOpts.draw
  });
  (mode === 'uk' ? mapUK : mapWorld).addControl(activeDrawControl);
  setTimeout(() => {
    // Move only the latest toolbar to the custom panel
    const toolbar = document.querySelector('.leaflet-draw-toolbar');
    if (toolbar && drawToolbarContainer) drawToolbarContainer.appendChild(toolbar);
    // Remove any floating toolbar
    document.querySelectorAll('.leaflet-draw-toolbar').forEach(tb => {
      if (!drawToolbarContainer.contains(tb)) tb.remove();
    });
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
  document.querySelectorAll('.leaflet-draw-toolbar').forEach(tb => {
    if (!drawToolbarContainer.contains(tb)) tb.remove();
  });
}

// --- FAB/panel toggle ---
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
    drawingMode = false;
    editingMode = false;
  }
};

// --- Draw event handlers ---
mapUK.on(L.Draw.Event.CREATED, function (e) {
  drawingMode = false;
  editingMode = false;
  if (e.layerType === 'polyline') {
    const defaultName = getDefaultRouteName('uk');
    let name = prompt("Name this route:", defaultName);
    if (name !== null) {
      name = name.trim() || defaultName;
      window.routeLayerUK.clearLayers();
      // Save to storage
      window.saveRouteToList('uk', name, e.layer);

      // Find index of this new route
      const routes = window.getRouteList('uk');
      const idx = routes.length - 1;
      window.currentRouteIndex.uk = idx;

      // Add to map
      window.routeLayerUK.addLayer(e.layer);
      window.updateRouteListUI('uk');

      // Zoom to new route (with bottom panel padding)
      if (e.layer.getBounds().isValid()) {
        const panelHeight = 300; // or match your CSS panel height
        mapUK.fitBounds(e.layer.getBounds(), {
          paddingBottomRight: [0, panelHeight + 16],
          paddingTopLeft: [0, 24]
        });
      }
    }
  }
  showRoutePanelContent();
});

mapWorld.on(L.Draw.Event.CREATED, function (e) {
  drawingMode = false;
  editingMode = false;
  if (e.layerType === 'polyline') {
    const defaultName = getDefaultRouteName('world');
    let name = prompt("Name this route:", defaultName);
    if (name !== null) {
      name = name.trim() || defaultName;
      window.routeLayerWorld.clearLayers();
      window.saveRouteToList('world', name, e.layer);
      const routes = window.getRouteList('world');
      const idx = routes.length - 1;
      window.currentRouteIndex.world = idx;
      window.routeLayerWorld.addLayer(e.layer);
      window.updateRouteListUI('world');
      if (e.layer.getBounds().isValid()) {
        const panelHeight = 300;
        mapWorld.fitBounds(e.layer.getBounds(), {
          paddingBottomRight: [0, panelHeight + 16],
          paddingTopLeft: [0, 24]
        });
      }
    }
  }
  showRoutePanelContent();
});

mapUK.on(L.Draw.Event.EDITED, function (e) {
  editingMode = false;
  drawingMode = false;
  let idx = window.currentRouteIndex.uk;
  if (idx == null) return;
  e.layers.eachLayer(function(layer) {
    let geojson = layer.toGeoJSON();
    window.updateRouteInList('uk', idx, geojson);
  });
  showRoutePanelContent();
});
mapWorld.on(L.Draw.Event.EDITED, function (e) {
  editingMode = false;
  drawingMode = false;
  let idx = window.currentRouteIndex.world;
  if (idx == null) return;
  e.layers.eachLayer(function(layer) {
    let geojson = layer.toGeoJSON();
    window.updateRouteInList('world', idx, geojson);
  });
  showRoutePanelContent();
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

// --- Load shared route if present in URL ---
const sharedRoute = getSharedRouteFromUrl();
if (sharedRoute && sharedRoute.geojson) {
  const sharedMode = currentMode || 'uk';
  const layer = L.geoJSON(sharedRoute.geojson);
  const targetLayer = sharedMode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
  targetLayer.clearLayers();
  layer.eachLayer(l => targetLayer.addLayer(l));
  window.saveRouteToList(sharedMode, sharedRoute.name || getDefaultRouteName(sharedMode), layer);
  const routes = window.getRouteList(sharedMode);
  window.currentRouteIndex[sharedMode] = routes.length - 1;
  if (layer.getBounds().isValid()) {
    const panelHeight = 300;
    const map = sharedMode === 'uk' ? mapUK : mapWorld;
    map.fitBounds(layer.getBounds(), {
      paddingBottomRight: [0, panelHeight + 16],
      paddingTopLeft: [0, 24]
    });
  }
  clearSharedRouteParam();
}

// --- Remove draw toolbar if open before switching maps ---
window.switchMap = function(mode) {
  let center, zoom;
  if (activeDrawControl) removeDrawToolbar();
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    fab.classList.remove('panel-open');
    fabIcon.className = 'fas fa-route';
    panelContent.innerHTML = '';
    drawingMode = false;
    editingMode = false;
  }

  if (currentMode === 'uk') {
    center = mapUK.getCenter();
    zoom = mapUK.getZoom();
    if (mode === 'world') zoom = getEquivalentWorldZoom(zoom);
  } else {
    center = mapWorld.getCenter();
    zoom = mapWorld.getZoom();
    if (mode === 'uk') zoom = getEquivalentUKZoom(zoom);
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

// Update globe icon color based on currentMode
function updateGlobeIcon() {
  var globeControl = document.querySelector('.globe-btn');
  if (!globeControl) return;
  var svg = globeControl.querySelector('svg, i.fas.fa-globe');
  if (!svg) return;
  if (currentMode === 'world') {
    globeControl.classList.add('active');
  } else {
    globeControl.classList.remove('active');
  }
}

// Initial state
updateGlobeIcon();
