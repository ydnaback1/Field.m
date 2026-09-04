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
window.routeNotesLayerUK = new L.FeatureGroup().addTo(mapUK);
window.routeNotesLayerWorld = new L.FeatureGroup().addTo(mapWorld);
window.routeDraftLayerUK = new L.FeatureGroup().addTo(mapUK);
window.routeDraftLayerWorld = new L.FeatureGroup().addTo(mapWorld);

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
let routeCreationMode = 'free';
let pathDraft = null;
let panelView = 'library';
let routeLibraryQuery = '';
let routeLibrarySort = 'recent';
let routeLibraryFilter = 'all';
let renamingRoute = false;
let confirmingDelete = false;
let routePanelNotice = '';
let notePlacementMode = false;
let noteDraft = null;
let selectedAnnotationId = null;
const ROUTE_COLOR_CHOICES = [
  { value: '#ff33da', label: 'Magenta' },
  { value: '#3388ff', label: 'Blue' },
  { value: '#009e73', label: 'Green' },
  { value: '#e69f00', label: 'Orange' },
  { value: '#cc79a7', label: 'Purple' },
  { value: '#c73e3a', label: 'Red' },
  { value: '#007c91', label: 'Teal' },
  { value: '#5b4b9a', label: 'Indigo' },
  { value: '#d55e00', label: 'Vermilion' },
  { value: '#3b6ea5', label: 'Slate blue' },
  { value: '#4d7c0f', label: 'Forest green' }
];

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

function getRouteNotesLayer(mode) {
  return mode === 'uk' ? window.routeNotesLayerUK : window.routeNotesLayerWorld;
}

function getAnnotationById(route, id) {
  return window.getRouteAnnotations(route).find(annotation => annotation && annotation.id === id) || null;
}

function getRouteMarkerTextColor(color) {
  const hex = String(color || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#fff';
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = channels.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.42 ? '#18202a' : '#fff';
}

function renderRouteAnnotations(mode, route) {
  const notesLayer = getRouteNotesLayer(mode);
  const routeColor = window.getRouteColor(mode, route);
  const markerTextColor = getRouteMarkerTextColor(routeColor);
  notesLayer.clearLayers();
  window.getRouteAnnotations(route).forEach(annotation => {
    if (!Number.isFinite(Number(annotation.lat)) || !Number.isFinite(Number(annotation.lng))) return;
    const marker = L.marker([annotation.lat, annotation.lng], {
      icon: L.divIcon({
        className: 'route-note-marker',
        html: `<span class="route-note-marker-inner" style="--route-color: ${escapeAttribute(routeColor)}; --route-note-icon-color: ${markerTextColor}"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      })
    });
    const tooltip = document.createElement('span');
    tooltip.textContent = annotation.title || 'Route note';
    marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -22] });
    marker.on('click', function() {
      selectedAnnotationId = annotation.id;
      notePlacementMode = false;
      noteDraft = null;
      panelView = 'details';
      setRoutePanelOpen(true);
      showRoutePanelContent();
    });
    notesLayer.addLayer(marker);
  });
}

window.renderRouteAnnotations = renderRouteAnnotations;

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
  notePlacementMode = false;
  noteDraft = null;
  selectedAnnotationId = null;
  routePanelNotice = '';
  setRoutePanelOpen(true);
  scheduleRouteFitToVisibleMap(mode);
  updateRouteFabLabel();
}

function isMobileRouteLayout() {
  return window.matchMedia('(max-width: 700px)').matches;
}

function scheduleRouteFitToVisibleMap(mode) {
  if (!isMobileRouteLayout()) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const context = getActiveRouteContext();
    if (!context || context.mode !== mode || !panel.classList.contains('open')) return;
    const routeLayer = mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
    const bounds = routeLayer.getBounds();
    if (!bounds.isValid()) return;
    const panelHeight = Math.ceil(panel.getBoundingClientRect().height);
    const map = mode === 'uk' ? mapUK : mapWorld;
    map.fitBounds(bounds, {
      paddingTopLeft: [18, 20],
      paddingBottomRight: [18, panelHeight + 20]
    });
  }));
}

window.isMobileRouteLayout = isMobileRouteLayout;

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
      <span class="route-row-icon" style="--route-color: ${escapeAttribute(window.getRouteColor(item.mode, item.route))}" aria-hidden="true"><i class="fa-solid fa-route"></i></span>
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
  drawingMode = true;
  editingMode = false;
  panelView = 'details';
  renamingRoute = false;
  confirmingDelete = false;
  routePanelNotice = '';
  showRoutePanelContent();
  setRouteCreationMode(routeCreationMode);
}

function getDraftLayer(mode) {
  return mode === 'uk' ? window.routeDraftLayerUK : window.routeDraftLayerWorld;
}

function clearPathDraft() {
  window.routeDraftLayerUK.clearLayers();
  window.routeDraftLayerWorld.clearLayers();
  pathDraft = null;
}

function createPathDraft(mode) {
  clearPathDraft();
  pathDraft = { mode, waypoints: [], geojson: null, requestId: 0, waiting: false, error: '' };
  return pathDraft;
}

function renderPathDraft() {
  if (!pathDraft) return;
  const layer = getDraftLayer(pathDraft.mode);
  layer.clearLayers();
  if (pathDraft.geojson) {
    L.geoJSON(pathDraft.geojson, { style: { color: '#FF9500', weight: 5 } }).eachLayer(item => layer.addLayer(item));
  }
  pathDraft.waypoints.forEach(function(waypoint, index) {
    layer.addLayer(L.marker([waypoint[1], waypoint[0]], {
      interactive: false,
      icon: L.divIcon({
        className: 'route-waypoint-marker',
        html: `<span>${index + 1}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    }));
  });
}

async function requestPathRoute() {
  if (!pathDraft || pathDraft.waypoints.length < 2) return;
  if (!CONFIG.orsApiKey) {
    pathDraft.error = 'Path routing is unavailable because the ORS key is missing.';
    showRoutePanelContent();
    return;
  }
  const requestId = ++pathDraft.requestId;
  pathDraft.waiting = true;
  pathDraft.error = '';
  showRoutePanelContent();
  try {
    const response = await fetch('https://api.heigit.org/openrouteservice/v2/directions/foot-hiking/geojson', {
      method: 'POST',
      headers: { Authorization: CONFIG.orsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: pathDraft.waypoints })
    });
    if (!response.ok) throw new Error('Routing request failed');
    const geojson = await response.json();
    if (!geojson || !geojson.features || !geojson.features.length) throw new Error('No route returned');
    if (!pathDraft || requestId !== pathDraft.requestId) return;
    pathDraft.geojson = geojson;
    pathDraft.error = '';
    renderPathDraft();
  } catch (error) {
    if (!pathDraft || requestId !== pathDraft.requestId) return;
    pathDraft.error = 'Could not follow paths. Your waypoints are still available; try again or add another point.';
  } finally {
    if (pathDraft && requestId === pathDraft.requestId) {
      pathDraft.waiting = false;
      showRoutePanelContent();
    }
  }
}

function handlePathClick(mode, event) {
  if (!drawingMode || routeCreationMode !== 'paths' || !pathDraft || pathDraft.mode !== mode) return;
  pathDraft.waypoints.push([event.latlng.lng, event.latlng.lat]);
  pathDraft.geojson = null;
  pathDraft.error = '';
  renderPathDraft();
  if (pathDraft.waypoints.length > 1) requestPathRoute();
  else showRoutePanelContent();
}

function setRouteCreationMode(nextMode) {
  routeCreationMode = nextMode;
  const mode = window.currentMode || 'uk';
  const handler = activeDrawControl?._toolbars?.draw?._modes.polyline.handler;
  if (nextMode === 'paths') {
    if (handler) handler.disable();
    if (!pathDraft || pathDraft.mode !== mode) createPathDraft(mode);
  } else {
    clearPathDraft();
    if (handler) handler.enable();
  }
  if (drawingMode) showRoutePanelContent();
}

function startNotePlacement() {
  notePlacementMode = true;
  noteDraft = null;
  selectedAnnotationId = null;
  routePanelNotice = '';
  showRoutePanelContent();
}

function showNotePlacement(context) {
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', 'Place route note');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `
    <div class="panel-heading workflow-heading">
      <div class="panel-eyebrow">${getModeLabel(context.mode)} route</div>
      <h2 class="route-title">Place a note</h2>
      <p class="panel-hint">Tap the map where you want to remember something.</p>
    </div>
    <div class="workflow-tip"><span>1</span>Choose a point on the map</div>
    <div class="route-actions-row">
      <button id="cancel-note-placement" class="panel-action" type="button">Cancel</button>
    </div>`;
  panelContent.querySelector('#cancel-note-placement').onclick = function() {
    notePlacementMode = false;
    showRoutePanelContent();
  };
}

function showNoteForm(context) {
  const isEditing = Boolean(noteDraft.id);
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', isEditing ? 'Edit route note' : 'Add route note');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `
    <div class="panel-navigation">
      <button id="cancel-note-form" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Cancel</button>
      <span class="route-mode-badge">${getModeLabel(context.mode)} map</span>
    </div>
    <form id="route-note-form" class="route-note-form">
      <div class="panel-heading workflow-heading">
        <div class="panel-eyebrow">Route note</div>
        <h2 class="route-title">${isEditing ? 'Edit note' : 'Add note'}</h2>
      </div>
      <label for="route-note-title">Title</label>
      <input id="route-note-title" name="title" maxlength="60" required value="${escapeAttribute(noteDraft.title || '')}">
      <label for="route-note-text">Note <span>Optional</span></label>
      <textarea id="route-note-text" name="note" maxlength="280" rows="4">${escapeHtml(noteDraft.note || '')}</textarea>
      <div class="route-actions-row">
        <button class="primary-action" type="submit">Save note</button>
        <button id="cancel-note-form-action" class="panel-action" type="button">Cancel</button>
      </div>
    </form>`;

  const cancel = function() {
    noteDraft = null;
    selectedAnnotationId = null;
    showRoutePanelContent();
  };
  panelContent.querySelector('#cancel-note-form').onclick = cancel;
  panelContent.querySelector('#cancel-note-form-action').onclick = cancel;
  panelContent.querySelector('#route-note-form').onsubmit = function(event) {
    event.preventDefault();
    const title = panelContent.querySelector('#route-note-title').value.trim();
    const note = panelContent.querySelector('#route-note-text').value.trim();
    if (!title) return;
    const annotation = {
      id: noteDraft.id || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      lat: noteDraft.lat,
      lng: noteDraft.lng,
      title,
      note
    };
    if (!window.saveRouteAnnotation(context.mode, context.index, annotation)) return;
    selectedAnnotationId = annotation.id;
    noteDraft = null;
    const updatedRoute = window.getRouteList(context.mode)[context.index];
    renderRouteAnnotations(context.mode, updatedRoute);
    routePanelNotice = 'Note saved.';
    showRoutePanelContent();
  };
  window.requestAnimationFrame(() => panelContent.querySelector('#route-note-title').focus({ preventScroll: true }));
}

function showNoteDetails(context, annotation) {
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', 'Route note');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `
    <div class="panel-navigation">
      <button id="back-to-route-details" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Route details</button>
      <span class="route-mode-badge">Note</span>
    </div>
    <div class="panel-heading active-route-heading">
      <div class="panel-eyebrow"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i> On route</div>
      <h2 class="route-title">${escapeHtml(annotation.title)}</h2>
      ${annotation.note ? `<p class="route-note-copy">${escapeHtml(annotation.note).replace(/\n/g, '<br>')}</p>` : '<p class="panel-hint">No additional note.</p>'}
    </div>
    <div class="route-actions-row active-route-actions">
      <button id="edit-note-panel" class="primary-action" type="button"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Edit note</span></button>
      <button id="delete-note-panel" class="panel-action danger-action" type="button"><i class="fa-solid fa-trash" aria-hidden="true"></i><span>Delete</span></button>
    </div>`;
  panelContent.querySelector('#back-to-route-details').onclick = function() {
    selectedAnnotationId = null;
    showRoutePanelContent();
  };
  panelContent.querySelector('#edit-note-panel').onclick = function() {
    noteDraft = { ...annotation };
    selectedAnnotationId = null;
    showRoutePanelContent();
  };
  panelContent.querySelector('#delete-note-panel').onclick = function() {
    if (!window.deleteRouteAnnotation(context.mode, context.index, annotation.id)) return;
    selectedAnnotationId = null;
    const updatedRoute = window.getRouteList(context.mode)[context.index];
    renderRouteAnnotations(context.mode, updatedRoute);
    routePanelNotice = 'Note deleted.';
    showRoutePanelContent();
  };
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
      <h2 class="route-title">${drawingMode ? (routeCreationMode === 'paths' ? 'Follow paths' : 'Draw your route') : `Edit ${escapeHtml(context?.route.name || 'route')}`}</h2>
      <p class="panel-hint">${drawingMode ? (routeCreationMode === 'paths' ? 'Tap control waypoints on the map. The route follows hiking paths between them.' : 'Tap the map to add points. Use the map while this sheet stays open.') : 'Move route points on the map, then save or discard your changes.'}</p>
    </div>
    ${drawingMode ? `<div class="route-creation-mode" role="group" aria-label="Route creation mode">
      <button id="follow-paths-mode" class="${routeCreationMode === 'paths' ? 'selected' : ''}" type="button" aria-pressed="${routeCreationMode === 'paths'}">Follow paths</button>
      <button id="draw-freely-mode" class="${routeCreationMode === 'free' ? 'selected' : ''}" type="button" aria-pressed="${routeCreationMode === 'free'}">Draw freely</button>
    </div>` : ''}
    <div class="workflow-tip"><span>1</span>${drawingMode ? (routeCreationMode === 'paths' ? `${pathDraft?.waypoints.length || 0} waypoint${(pathDraft?.waypoints.length || 0) === 1 ? '' : 's'}${pathDraft?.waiting ? ' · Finding paths…' : ''}` : 'Add at least two points on the map') : 'Drag any point to adjust the route'}</div>
    ${drawingMode && routeCreationMode === 'paths' && pathDraft?.error ? `<p class="route-workflow-error" role="alert">${escapeHtml(pathDraft.error)}</p>` : ''}
    <div class="route-actions-row">
      <button id="${drawingMode ? 'save-route-panel' : 'save-edit-route-panel'}" class="primary-action primary-action-wide" type="button">
        <i class="fa-solid fa-check" aria-hidden="true"></i><span>${drawingMode ? 'Finish route' : 'Save changes'}</span>
      </button>
      <button id="cancel-route-workflow" class="panel-action" type="button">Cancel</button>
    </div>`;

  if (drawingMode) {
    panelContent.querySelector('#follow-paths-mode').onclick = function() { setRouteCreationMode('paths'); };
    panelContent.querySelector('#draw-freely-mode').onclick = function() { setRouteCreationMode('free'); };
  }
  const finishButton = panelContent.querySelector(drawingMode ? '#save-route-panel' : '#save-edit-route-panel');
  finishButton.onclick = function() {
    if (!activeDrawControl) return;
    if (drawingMode && routeCreationMode === 'paths') {
      if (!pathDraft?.geojson || pathDraft.waiting) {
        if (pathDraft) {
          pathDraft.error = pathDraft.waiting ? 'Still finding paths. Please wait before finishing.' : 'Add at least two waypoints and wait for a route.';
          showRoutePanelContent();
        }
        return;
      }
      const routeLayer = L.geoJSON(pathDraft.geojson);
      const defaultName = getDefaultRouteName(mode);
      const targetLayer = mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
      const notesLayer = mode === 'uk' ? window.routeNotesLayerUK : window.routeNotesLayerWorld;
      targetLayer.clearLayers();
      notesLayer.clearLayers();
      window.currentRouteIndex[mode] = window.saveRouteToList(mode, defaultName, routeLayer, {
        provider: 'ors', profile: 'foot-hiking', waypoints: pathDraft.waypoints.slice()
      });
      window.applyRouteStyle(routeLayer, mode, window.getRouteList(mode)[window.currentRouteIndex[mode]]);
      routeLayer.eachLayer(item => targetLayer.addLayer(item));
      clearPathDraft();
      drawingMode = false;
      panelView = 'details';
      renamingRoute = true;
      window.updateRouteListUI(mode);
      showRoutePanelContent();
      updateRouteFabLabel();
    } else if (drawingMode && activeDrawControl._toolbars?.draw) {
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
    if (drawingMode && routeCreationMode === 'paths') clearPathDraft();
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
  const annotations = window.getRouteAnnotations(currentRoute);
  const selectedAnnotation = selectedAnnotationId && getAnnotationById(currentRoute, selectedAnnotationId);
  if (selectedAnnotation) {
    showNoteDetails(context, selectedAnnotation);
    return;
  }
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
      <button id="edit-route-panel" class="primary-action primary-action-wide" type="button"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Edit route</span></button>
    </div>
    ${confirmingDelete ? `<div class="route-delete-confirm" role="alert">
      <div><strong>Delete this route?</strong><span>This removes it from this device.</span></div>
      <div class="route-actions-row">
        <button id="confirm-delete-route" class="danger-solid" type="button">Delete</button>
        <button id="cancel-delete-route" class="panel-action" type="button">Keep route</button>
      </div>
    </div>` : `<details class="route-disclosure route-notes">
      <summary><span><i class="fa-solid fa-note-sticky" aria-hidden="true"></i> Notes <em>${annotations.length}</em></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
      <div class="route-disclosure-body">
        ${annotations.length ? `<div class="route-note-list">${annotations.map(annotation => `<button type="button" class="route-note-row" data-open-note="${escapeAttribute(annotation.id)}"><span class="route-note-row-icon" style="--route-color: ${escapeAttribute(window.getRouteColor(context.mode, currentRoute))}"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i></span><span>${escapeHtml(annotation.title || 'Untitled note')}</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`).join('')}</div>` : '<p class="route-disclosure-empty">No notes yet. Add one to mark a useful point on the map.</p>'}
        <button id="add-note-panel" class="panel-action route-disclosure-action" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>Add note on map</span></button>
      </div>
    </details>
    <details class="route-disclosure route-customisation">
      <summary><span><i class="fa-solid fa-palette" aria-hidden="true"></i> Appearance</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
      <div class="route-disclosure-body">
        <div class="route-color-control" role="group" aria-label="Route colour">
          <span class="route-color-label">Route colour</span>
          <div class="route-color-options">
            ${ROUTE_COLOR_CHOICES.map(choice => `<button type="button" class="route-color-option${window.getRouteColor(context.mode, currentRoute).toLowerCase() === choice.value ? ' is-selected' : ''}" data-route-color="${choice.value}" aria-label="${choice.label}" aria-pressed="${window.getRouteColor(context.mode, currentRoute).toLowerCase() === choice.value}" title="${choice.label}" style="--route-color: ${choice.value}"></button>`).join('')}
          </div>
        </div>
      </div>
    </details>
    <details class="route-more-actions">
      <summary>More actions <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
      <div class="secondary-actions-row">
        <button class="secondary-action" id="add-route-panel" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i> New route</button>
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

  const addRouteButton = panelContent.querySelector('#add-route-panel');
  const addNoteButton = panelContent.querySelector('#add-note-panel');
  if (addRouteButton) addRouteButton.onclick = startRouteDrawing;
  if (addNoteButton) addNoteButton.onclick = startNotePlacement;
  panelContent.querySelectorAll('[data-open-note]').forEach(button => {
    button.onclick = function() {
      selectedAnnotationId = button.dataset.openNote;
      showRoutePanelContent();
    };
  });
  panelContent.querySelectorAll('[data-route-color]').forEach(button => {
    button.onclick = function() {
      const color = button.dataset.routeColor;
      if (!window.updateRouteColorInList(context.mode, context.index, color)) return;
      const routeLayer = context.mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
      window.applyRouteStyle(routeLayer, context.mode, { color });
      renderRouteAnnotations(context.mode, window.getRouteList(context.mode)[context.index]);
      routePanelNotice = 'Route colour updated.';
      showRoutePanelContent();
    };
  });
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
      if (context.mode === 'uk') {
        window.routeLayerUK.clearLayers();
        window.routeNotesLayerUK.clearLayers();
      } else {
        window.routeLayerWorld.clearLayers();
        window.routeNotesLayerWorld.clearLayers();
      }
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
  panel.classList.toggle('route-workflow-view', drawingMode || editingMode || notePlacementMode);
  if (drawingMode || editingMode) {
    showRouteWorkflow();
    return;
  }
  const context = getActiveRouteContext();
  if (notePlacementMode && context) {
    showNotePlacement(context);
    return;
  }
  if (noteDraft && context) {
    showNoteForm(context);
    return;
  }
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
    window.routeNotesLayerUK.clearLayers();
    window.currentRouteIndex.uk = window.saveRouteToList('uk', defaultName, e.layer);
    window.applyRouteStyle(e.layer, 'uk', window.getRouteList('uk')[window.currentRouteIndex.uk]);
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
    window.routeNotesLayerWorld.clearLayers();
    window.currentRouteIndex.world = window.saveRouteToList('world', defaultName, e.layer);
    window.applyRouteStyle(e.layer, 'world', window.getRouteList('world')[window.currentRouteIndex.world]);
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

function handleNotePlacement(mode, event) {
  if (!notePlacementMode || (window.currentMode || 'uk') !== mode) return;
  const context = getActiveRouteContext();
  if (!context || context.mode !== mode) return;
  notePlacementMode = false;
  noteDraft = { lat: event.latlng.lat, lng: event.latlng.lng, title: '', note: '' };
  showRoutePanelContent();
}

mapUK.on('click', function(event) { handleNotePlacement('uk', event); });
mapWorld.on('click', function(event) { handleNotePlacement('world', event); });
mapUK.on('click', function(event) { handlePathClick('uk', event); });
mapWorld.on('click', function(event) { handlePathClick('world', event); });

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
  const layer = L.geoJSON(sharedRoute.geojson, { style: window.getRouteStyle(sharedMode, sharedRoute) });
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
