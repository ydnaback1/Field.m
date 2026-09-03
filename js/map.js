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
const panelClose = document.getElementById('panel-close');
const drawToolbarContainer = document.getElementById('draw-toolbar-container');
const panelContent = document.getElementById('panel-content');
let activeDrawControl = null;

let drawingMode = false;
let editingMode = false;
let panelView = 'library';
let routeLibraryQuery = '';
let routeLibrarySort = 'recent';
let routeLibraryFilter = 'all';
let renamingRoute = false;
let confirmingDelete = false;
let routePanelNotice = '';

// --- Panel Main Function ---
function getDefaultRouteName(mode) {
  const routes = window.getRouteList(mode);
  const baseName = 'Route';
  let nextIndex = routes.length + 1;
  while (routes.some(route => route && route.name === `${baseName} ${nextIndex}`)) {
    nextIndex += 1;
  }
  return `${baseName} ${nextIndex}`;
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getModeLabel(mode) {
  return mode === 'uk' ? 'UK' : 'Worldwide';
}

function getActiveRouteContext() {
  const mode = window.currentMode || 'uk';
  const index = window.currentRouteIndex[mode];
  const routes = window.getRouteList(mode);
  if (typeof index !== 'number' || !routes[index] || !routes[index].geojson) return null;
  return { mode, index, route: routes[index] };
}

function getRouteTimestamp(route, index) {
  const timestamp = Date.parse(route.updatedAt || route.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : index;
}

function formatRouteDate(route) {
  const timestamp = Date.parse(route.updatedAt || route.createdAt || '');
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  }).format(new Date(timestamp));
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

function getRouteLibraryItems() {
  return ['uk', 'world'].flatMap(mode => window.getRouteList(mode)
    .map((route, index) => ({ route, index }))
    .filter(item => item.route && item.route.geojson)
    .map(item => ({
      mode,
      index: item.index,
      route: item.route
    })));
}

function getVisibleRouteLibraryItems() {
  const query = routeLibraryQuery.trim().toLocaleLowerCase();
  return getRouteLibraryItems()
    .filter(item => routeLibraryFilter === 'all' || item.mode === routeLibraryFilter)
    .filter(item => !query || String(item.route.name || '').toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (routeLibrarySort === 'name') {
        return String(a.route.name || '').localeCompare(String(b.route.name || ''), undefined, { sensitivity: 'base' });
      }
      return getRouteTimestamp(b.route, b.index) - getRouteTimestamp(a.route, a.index);
    });
}

function formatLibraryDistance(km) {
  const value = Number(km);
  if (!Number.isFinite(value)) return '';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 })} km`;
}

function openRouteFromLibrary(mode, index) {
  if ((window.currentMode || 'uk') !== mode) window.switchMap(mode);
  if (!window.loadRouteByIndex(mode, index)) return;
  panelView = 'details';
  drawingMode = false;
  editingMode = false;
  renamingRoute = false;
  confirmingDelete = false;
  routePanelNotice = '';
  setRoutePanelOpen(true);
  updateRouteFabLabel();
}

function renderRouteLibraryResults() {
  const results = panelContent.querySelector('#route-library-results');
  const summary = panelContent.querySelector('#route-library-summary');
  if (!results || !summary) return;

  const items = getVisibleRouteLibraryItems();
  const total = getRouteLibraryItems().length;
  summary.textContent = `${items.length} ${items.length === 1 ? 'route' : 'routes'} shown`;
  results.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty route-library-empty';
    if (!total) {
      empty.innerHTML = `<i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>
        <div><strong>No saved routes yet</strong><span>Draw your first walk and it will be stored on this device.</span></div>`;
    } else {
      empty.innerHTML = `<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <div><strong>No routes found</strong><span>Try another name or map filter.</span></div>
        <button type="button" class="text-action" id="clear-route-filters">Clear filters</button>`;
    }
    results.appendChild(empty);
    const clearButton = empty.querySelector('#clear-route-filters');
    if (clearButton) {
      clearButton.onclick = function() {
        routeLibraryQuery = '';
        routeLibraryFilter = 'all';
        showRoutePanelContent();
      };
    }
    return;
  }

  const list = document.createElement('ul');
  list.className = 'route-library-list';

  items.forEach(item => {
    const routeName = item.route.name || 'Untitled route';
    const metrics = getRouteMetrics(item.route.geojson);
    const distance = formatLibraryDistance(metrics.km);
    const date = formatRouteDate(item.route);
    const isActive = item.mode === (window.currentMode || 'uk') && window.currentRouteIndex[item.mode] === item.index;
    const meta = [distance, metrics.timeStr, date ? `Updated ${date}` : 'Saved route'].filter(Boolean);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `route-library-row${isActive ? ' active-route' : ''}`;
    button.setAttribute('aria-label', `Open ${routeName}, ${getModeLabel(item.mode)}${distance ? `, ${distance}` : ''}`);
    if (isActive) button.setAttribute('aria-current', 'true');
    button.innerHTML = `
      <span class="route-row-icon" aria-hidden="true"><i class="fa-solid fa-route"></i></span>
      <span class="route-row-copy">
        <span class="route-row-title">${escapeHtml(routeName)}</span>
        <span class="route-row-meta">${meta.map(value => `<span>${escapeHtml(value)}</span>`).join('<span aria-hidden="true">·</span>')}</span>
      </span>
      <span class="route-row-side">
        <span class="route-mode-badge">${getModeLabel(item.mode)}</span>
        ${isActive ? '<span class="active-route-label">On map</span>' : '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>'}
      </span>`;
    button.onclick = function() { openRouteFromLibrary(item.mode, item.index); };
    const listItem = document.createElement('li');
    listItem.appendChild(button);
    list.appendChild(listItem);
  });

  results.appendChild(list);
}

function startRouteDrawing() {
  const mode = window.currentMode || 'uk';
  drawingMode = true;
  editingMode = false;
  panelView = 'details';
  renamingRoute = false;
  confirmingDelete = false;
  routePanelNotice = '';
  showRoutePanelContent();
  const drawControl = activeDrawControl;
  if (drawControl && drawControl._toolbars && drawControl._toolbars.draw) {
    drawControl._toolbars.draw._modes.polyline.handler.enable();
  }
}

function showRouteLibrary() {
  const items = getRouteLibraryItems();
  const counts = {
    all: items.length,
    uk: items.filter(item => item.mode === 'uk').length,
    world: items.filter(item => item.mode === 'world').length
  };
  panel.classList.add('library-view');
  panel.classList.toggle('library-scroll-view', counts.all > 4);
  panel.setAttribute('aria-label', 'Saved routes');
  panelContent.className = 'library-content';
  panelContent.innerHTML = `
    <div class="panel-heading library-heading">
      <div class="panel-eyebrow">Your walks</div>
      <div class="panel-title-row">
        <h2 class="route-title">Saved routes</h2>
        <span class="library-count">${counts.all}</span>
      </div>
      <p class="panel-hint">Stored locally on this device. Choose a route to put it on the map.</p>
    </div>
    ${counts.all ? `<div class="route-library-tools">
      <label class="route-search-field">
        <span class="sr-only">Search saved routes</span>
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input id="route-search" type="search" placeholder="Search routes" autocomplete="off" value="${escapeAttribute(routeLibraryQuery)}">
      </label>
      <label class="route-sort-field">
        <span class="sr-only">Sort saved routes</span>
        <select id="route-sort" aria-label="Sort saved routes">
          <option value="recent"${routeLibrarySort === 'recent' ? ' selected' : ''}>Recent</option>
          <option value="name"${routeLibrarySort === 'name' ? ' selected' : ''}>Name</option>
        </select>
      </label>
    </div>
    <div class="route-library-filters" role="group" aria-label="Filter routes by map">
      <button type="button" aria-pressed="${routeLibraryFilter === 'all'}" data-filter="all">All <span>${counts.all}</span></button>
      <button type="button" aria-pressed="${routeLibraryFilter === 'uk'}" data-filter="uk">UK <span>${counts.uk}</span></button>
      <button type="button" aria-pressed="${routeLibraryFilter === 'world'}" data-filter="world">Worldwide <span>${counts.world}</span></button>
    </div>` : ''}
    <div id="route-library-summary" class="sr-only" aria-live="polite"></div>
    <div id="route-library-results"></div>
    <div class="library-footer">
      <button id="add-route-panel" class="primary-action primary-action-wide" type="button">
        <i class="fa-solid fa-plus" aria-hidden="true"></i><span>New ${getModeLabel(window.currentMode || 'uk')} route</span>
      </button>
    </div>`;

  const search = panelContent.querySelector('#route-search');
  if (search) {
    search.oninput = function() {
      routeLibraryQuery = search.value;
      renderRouteLibraryResults();
    };
  }
  const sort = panelContent.querySelector('#route-sort');
  if (sort) {
    sort.onchange = function() {
      routeLibrarySort = sort.value;
      renderRouteLibraryResults();
    };
  }
  panelContent.querySelectorAll('[data-filter]').forEach(button => {
    button.onclick = function() {
      routeLibraryFilter = button.dataset.filter;
      showRoutePanelContent();
    };
  });
  panelContent.querySelector('#add-route-panel').onclick = startRouteDrawing;
  renderRouteLibraryResults();
}

function showRouteWorkflow() {
  const mode = window.currentMode || 'uk';
  const context = getActiveRouteContext();
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', drawingMode ? 'Draw route' : 'Edit route');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `
    <div class="panel-heading workflow-heading">
      <div class="panel-eyebrow">${drawingMode ? `New ${getModeLabel(mode)} route` : 'Editing route'}</div>
      <h2 class="route-title">${drawingMode ? 'Draw your route' : `Edit ${escapeHtml(context?.route.name || 'route')}`}</h2>
      <p class="panel-hint">${drawingMode ? 'Tap the map to add points. Use the map while this sheet stays open.' : 'Move route points on the map, then save or discard your changes.'}</p>
    </div>
    <div class="workflow-tip"><span>1</span>${drawingMode ? 'Add at least two points on the map' : 'Drag any point to adjust the route'}</div>
    <div class="route-actions-row">
      <button id="${drawingMode ? 'save-route-panel' : 'save-edit-route-panel'}" class="primary-action primary-action-wide" type="button">
        <i class="fa-solid fa-check" aria-hidden="true"></i><span>${drawingMode ? 'Finish route' : 'Save changes'}</span>
      </button>
      <button id="cancel-route-workflow" class="panel-action" type="button">Cancel</button>
    </div>`;

  const finishButton = panelContent.querySelector(drawingMode ? '#save-route-panel' : '#save-edit-route-panel');
  finishButton.onclick = function() {
    if (!activeDrawControl) return;
    if (drawingMode && activeDrawControl._toolbars?.draw) {
      activeDrawControl._toolbars.draw._modes.polyline.handler.completeShape();
    } else if (editingMode && activeDrawControl._toolbars?.edit) {
      const handler = activeDrawControl._toolbars.edit._modes.edit.handler;
      handler.save();
      handler.disable();
    }
  };

  panelContent.querySelector('#cancel-route-workflow').onclick = function() {
    if (activeDrawControl && drawingMode && activeDrawControl._toolbars?.draw) {
      activeDrawControl._toolbars.draw._modes.polyline.handler.disable();
    }
    if (activeDrawControl && editingMode && activeDrawControl._toolbars?.edit) {
      const handler = activeDrawControl._toolbars.edit._modes.edit.handler;
      if (typeof handler.revertLayers === 'function') handler.revertLayers();
      handler.disable();
    }
    drawingMode = false;
    editingMode = false;
    panelView = context ? 'details' : 'library';
    showRoutePanelContent();
  };
}

function bindRouteShareAndExport(currentRoute) {
  const shareBtn = panelContent.querySelector('#share-route-panel');
  const exportGeoBtn = panelContent.querySelector('#export-geojson-panel');
  const exportGpxBtn = panelContent.querySelector('#export-gpx-panel');
  const shareStatus = panelContent.querySelector('#share-status');

  if (shareBtn) {
    shareBtn.onclick = async function() {
      const url = new URL(window.location.href);
      url.searchParams.set('route', encodeRoutePayload(currentRoute));
      const shareUrl = url.toString();
      let message = 'Share link copied.';
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
        } else {
          prompt('Copy this link to share:', shareUrl);
          message = 'Share link ready.';
        }
      } catch (e) {
        prompt('Copy this link to share:', shareUrl);
        message = 'Share link ready.';
      }
      if (shareStatus) {
        shareStatus.textContent = message;
        setTimeout(() => { shareStatus.textContent = ''; }, 3000);
      }
    };
  }

  if (exportGeoBtn) {
    exportGeoBtn.onclick = function() {
      downloadTextFile(`${currentRoute.name || 'route'}.geojson`, JSON.stringify(currentRoute.geojson, null, 2), 'application/geo+json');
    };
  }
  if (exportGpxBtn) {
    exportGpxBtn.onclick = function() {
      downloadTextFile(`${currentRoute.name || 'route'}.gpx`, routeGeojsonToGpx(currentRoute.name || 'Route', currentRoute.geojson), 'application/gpx+xml');
    };
  }
}

function showActiveRouteDetails(context) {
  const currentRoute = context.route;
  const { km, mi, timeStr } = getRouteMetrics(currentRoute.geojson);
  const date = formatRouteDate(currentRoute);
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', 'Active route details');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `
    <div class="panel-navigation">
      <button id="back-to-library" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Saved routes</button>
      <span class="route-mode-badge">${getModeLabel(context.mode)} map</span>
    </div>
    ${renamingRoute ? `<form id="rename-route-form" class="rename-route-form">
      <label for="route-name-input">Route name</label>
      <input id="route-name-input" name="routeName" maxlength="100" required value="${escapeAttribute(currentRoute.name || '')}">
      <div class="route-actions-row">
        <button class="primary-action" type="submit">Save name</button>
        <button class="panel-action" id="cancel-rename-route" type="button">Cancel</button>
      </div>
    </form>` : `<div class="panel-heading active-route-heading">
      <div class="panel-eyebrow"><i class="fa-solid fa-circle" aria-hidden="true"></i> On map</div>
      <h2 class="route-title">${escapeHtml(currentRoute.name || 'Untitled route')}</h2>
      ${date ? `<p class="panel-hint">Updated ${escapeHtml(date)}</p>` : ''}
    </div>`}
    ${!renamingRoute ? `<div class="metric-row">
      ${km ? `<span class="metric-pill"><i class="fa-solid fa-person-walking" aria-hidden="true"></i><span><strong>${km}</strong> km <span class="metric-secondary">${mi} mi</span></span></span>` : ''}
      ${timeStr ? `<span class="metric-pill"><i class="fa-solid fa-stopwatch" aria-hidden="true"></i><strong>${timeStr}</strong></span>` : ''}
    </div>
    ${routePanelNotice ? `<div class="panel-notice" role="status">${escapeHtml(routePanelNotice)}</div>` : ''}
    <div class="route-actions-row active-route-actions">
      <button id="edit-route-panel" class="primary-action" type="button"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Edit route</span></button>
      <button id="add-route-panel" class="panel-action" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>New route</span></button>
    </div>
    ${confirmingDelete ? `<div class="route-delete-confirm" role="alert">
      <div><strong>Delete this route?</strong><span>This removes it from this device.</span></div>
      <div class="route-actions-row">
        <button id="confirm-delete-route" class="danger-solid" type="button">Delete</button>
        <button id="cancel-delete-route" class="panel-action" type="button">Keep route</button>
      </div>
    </div>` : `<details class="route-more-actions">
      <summary>More actions <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
      <div class="secondary-actions-row">
        <button class="secondary-action" id="rename-route-panel" type="button"><i class="fa-solid fa-i-cursor" aria-hidden="true"></i> Rename</button>
        <button class="secondary-action" id="share-route-panel" type="button"><i class="fa-solid fa-link" aria-hidden="true"></i> Share</button>
        <button class="secondary-action" id="export-geojson-panel" type="button"><i class="fa-solid fa-file-code" aria-hidden="true"></i> GeoJSON</button>
        <button class="secondary-action" id="export-gpx-panel" type="button"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> GPX</button>
        <button class="secondary-action danger-action" id="delete-route-panel" type="button"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>
      </div>
      <div class="panel-status" id="share-status" aria-live="polite"></div>
    </details>`}` : ''}`;

  panelContent.querySelector('#back-to-library').onclick = function() {
    panelView = 'library';
    renamingRoute = false;
    confirmingDelete = false;
    routePanelNotice = '';
    showRoutePanelContent();
  };

  if (renamingRoute) {
    const form = panelContent.querySelector('#rename-route-form');
    const input = panelContent.querySelector('#route-name-input');
    form.onsubmit = function(event) {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      window.renameRouteInList(context.mode, context.index, name);
      renamingRoute = false;
      routePanelNotice = 'Route name updated.';
      showRoutePanelContent();
      updateRouteFabLabel();
    };
    panelContent.querySelector('#cancel-rename-route').onclick = function() {
      renamingRoute = false;
      routePanelNotice = '';
      showRoutePanelContent();
    };
    window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
    return;
  }

  panelContent.querySelector('#add-route-panel').onclick = startRouteDrawing;
  panelContent.querySelector('#edit-route-panel').onclick = function() {
    editingMode = true;
    drawingMode = false;
    routePanelNotice = '';
    showRoutePanelContent();
    if (activeDrawControl && activeDrawControl._toolbars?.edit) {
      activeDrawControl._toolbars.edit._modes.edit.handler.enable();
    }
  };

  if (confirmingDelete) {
    panelContent.querySelector('#cancel-delete-route').onclick = function() {
      confirmingDelete = false;
      showRoutePanelContent();
    };
    panelContent.querySelector('#confirm-delete-route').onclick = function() {
      window.deleteRouteFromList(context.mode, context.index);
      if (context.mode === 'uk') window.routeLayerUK.clearLayers();
      else window.routeLayerWorld.clearLayers();
      window.currentRouteIndex[context.mode] = null;
      confirmingDelete = false;
      panelView = 'library';
      routePanelNotice = '';
      showRoutePanelContent();
      updateRouteFabLabel();
    };
  } else {
    panelContent.querySelector('#rename-route-panel').onclick = function() {
      renamingRoute = true;
      routePanelNotice = '';
      showRoutePanelContent();
    };
    panelContent.querySelector('#delete-route-panel').onclick = function() {
      confirmingDelete = true;
      showRoutePanelContent();
    };
    bindRouteShareAndExport(currentRoute);
  }
}

function updateRouteFabLabel() {
  const context = getActiveRouteContext();
  const label = context ? `Open route details for ${context.route.name || 'Untitled route'}` : 'Open saved routes';
  fab.setAttribute('aria-label', label);
  fab.title = label;
}

function showRoutePanelContent() {
  panel.classList.toggle('route-workflow-view', drawingMode || editingMode);
  if (drawingMode || editingMode) {
    showRouteWorkflow();
    return;
  }
  const context = getActiveRouteContext();
  if (panelView === 'details' && context) {
    showActiveRouteDetails(context);
  } else {
    panelView = 'library';
    showRouteLibrary();
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
function setRoutePanelOpen(isOpen, restoreFocus = false) {
  panel.classList.toggle('open', isOpen);
  fab.classList.toggle('panel-open', isOpen);
  fabIcon.className = 'fas fa-route';
  fab.setAttribute('aria-expanded', String(isOpen));
  panel.setAttribute('aria-hidden', String(!isOpen));
  panel.inert = !isOpen;
  if (isOpen) {
    showRoutePanelContent();
    addDrawToolbar();
    window.requestAnimationFrame(() => panelClose.focus({ preventScroll: true }));
  } else {
    panelContent.innerHTML = '';
    removeDrawToolbar();
    drawingMode = false;
    editingMode = false;
    if (restoreFocus) fab.focus({ preventScroll: true });
  }
}

fab.onclick = function() {
  setRoutePanelOpen(!panel.classList.contains('open'));
};

panelClose.onclick = function() {
  setRoutePanelOpen(false, true);
};

document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape' && panel.classList.contains('open')) {
    setRoutePanelOpen(false, true);
  }
});

// --- Draw event handlers ---
mapUK.on(L.Draw.Event.CREATED, function (e) {
  drawingMode = false;
  editingMode = false;
  if (e.layerType === 'polyline') {
    const defaultName = getDefaultRouteName('uk');
    window.routeLayerUK.clearLayers();
    window.currentRouteIndex.uk = window.saveRouteToList('uk', defaultName, e.layer);
    window.routeLayerUK.addLayer(e.layer);
    window.updateRouteListUI('uk');
    panelView = 'details';
    renamingRoute = true;
    routePanelNotice = '';
    if (e.layer.getBounds().isValid()) {
      const panelHeight = 300;
      mapUK.fitBounds(e.layer.getBounds(), {
        paddingBottomRight: [0, panelHeight + 16],
        paddingTopLeft: [0, 24]
      });
    }
  }
  showRoutePanelContent();
  updateRouteFabLabel();
});

mapWorld.on(L.Draw.Event.CREATED, function (e) {
  drawingMode = false;
  editingMode = false;
  if (e.layerType === 'polyline') {
    const defaultName = getDefaultRouteName('world');
    window.routeLayerWorld.clearLayers();
    window.currentRouteIndex.world = window.saveRouteToList('world', defaultName, e.layer);
    window.routeLayerWorld.addLayer(e.layer);
    window.updateRouteListUI('world');
    panelView = 'details';
    renamingRoute = true;
    routePanelNotice = '';
    if (e.layer.getBounds().isValid()) {
      const panelHeight = 300;
      mapWorld.fitBounds(e.layer.getBounds(), {
        paddingBottomRight: [0, panelHeight + 16],
        paddingTopLeft: [0, 24]
      });
    }
  }
  showRoutePanelContent();
  updateRouteFabLabel();
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
  panelView = 'details';
  routePanelNotice = 'Route changes saved.';
  showRoutePanelContent();
  updateRouteFabLabel();
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
  panelView = 'details';
  routePanelNotice = 'Route changes saved.';
  showRoutePanelContent();
  updateRouteFabLabel();
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
  panelView = 'details';
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
    fab.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
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
  updateRouteFabLabel();
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
updateRouteFabLabel();
