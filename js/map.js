// js/map.js

// EPSG:27700 for Proj4js coordinate transforms
proj4.defs("EPSG:27700", "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs");

// Zoom Lookup Table
function getEquivalentWorldZoom(bngZoom) {
  const match = {
    0: 7, 1: 8, 2: 9, 3: 10, 4: 11, 5: 12,
    6: 13, 7: 14, 8: 15, 9: 16, 10: 17, 11: 18, 12: 18, 13: 19
  };
  return match[bngZoom] || 9;
}
function getEquivalentUKZoom(osmZoom) {
  const match = {
    7: 0, 8: 1, 9: 2, 10: 3, 11: 4, 12: 5,
    13: 6, 14: 7, 15: 8, 16: 9, 17: 10, 18: 11, 19: 12
  };
  return match[osmZoom] ?? (osmZoom < 7 ? 0 : 7);
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
let savedMode, savedCenter, savedZoom;
try {
  savedMode = localStorage.getItem('lastMode');
  savedCenter = localStorage.getItem('lastCenter');
  savedZoom = localStorage.getItem('lastZoom');
} catch (_) { /* Map preferences are optional when browser storage is blocked. */ }
if (savedCenter && savedZoom) {
  try {
    savedCenter = JSON.parse(savedCenter);
    savedZoom = Number(savedZoom);
    if (!Array.isArray(savedCenter) || savedCenter.length !== 2 ||
        !savedCenter.every(Number.isFinite) || Math.abs(savedCenter[0]) > 90 ||
        Math.abs(savedCenter[1]) > 180 || !Number.isFinite(savedZoom)) throw new Error('Invalid map state');
    if (savedMode === 'world') {
      worldInitialCenter = savedCenter;
      worldInitialZoom = Math.max(0, Math.min(19, savedZoom));
    } else {
      ukInitialCenter = savedCenter;
      ukInitialZoom = Math.max(0, Math.min(UK_BASE_MAX_ZOOM, savedZoom));
    }
  } catch (e) {}
}
var currentMode = savedMode === 'world' ? 'world' : 'uk';
document.getElementById('map-uk').style.display = currentMode === 'uk' ? 'block' : 'none';
document.getElementById('map-world').style.display = currentMode === 'world' ? 'block' : 'none';

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
// Display-only overlays; saved geometry and editing always use the route layers above.
const routeSteepnessLayerUK = new L.FeatureGroup().addTo(mapUK);
const routeSteepnessLayerWorld = new L.FeatureGroup().addTo(mapWorld);
window.routeNotesLayerUK = new L.FeatureGroup().addTo(mapUK);
window.routeNotesLayerWorld = new L.FeatureGroup().addTo(mapWorld);
window.routeDraftLayerUK = new L.FeatureGroup().addTo(mapUK);
window.routeDraftLayerWorld = new L.FeatureGroup().addTo(mapWorld);
// Ephemeral only: profile inspection must never become part of a saved route.
const routeProfileMarkerUK = new L.FeatureGroup().addTo(mapUK);
const routeProfileMarkerWorld = new L.FeatureGroup().addTo(mapWorld);
// Navigation-only overlays. These are deliberately separate from routeLayer so
// an in-progress walk can never change the saved planned route geometry.
const navigationLayerUK = new L.FeatureGroup().addTo(mapUK);
const navigationLayerWorld = new L.FeatureGroup().addTo(mapWorld);
// Comparison rendering is intentionally separate from saved route layers. It is
// a short-lived map view, never part of a route record or its GeoJSON.
const routeComparisonLayerUK = new L.FeatureGroup().addTo(mapUK);
const routeComparisonLayerWorld = new L.FeatureGroup().addTo(mapWorld);
// Search results are transient map-navigation state, intentionally outside all
// route, navigation and saved-data layers.
const searchResultLayerUK = new L.FeatureGroup().addTo(mapUK);
const searchResultLayerWorld = new L.FeatureGroup().addTo(mapWorld);

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

// Keep Leaflet.draw's own touch handler: L.Handler has no _onTouch method.


// --- Panel, FAB, and Draw Control State ---
const fab = document.getElementById('fab-route');
const panel = document.getElementById('bottom-panel');
const fabIcon = fab.querySelector('i');
const panelClose = document.getElementById('panel-close');
const panelTopbar = document.getElementById('panel-topbar');
const panelRouteToggle = document.getElementById('panel-route-toggle');
const panelSettings = document.getElementById('panel-settings');
const drawToolbarContainer = document.getElementById('draw-toolbar-container');
const panelContent = document.getElementById('panel-content');
let activeDrawControl = null;

let drawingMode = false;
let editingMode = false;
let routeCreationMode = 'free';
let pathDraft = null;
let snapPreview = null;
// Routed editing is deliberately separate from the detailed line geometry. The
// saved route remains the last valid route until a full reroute succeeds.
let routedEdit = null;
let sharedRouteImport = null;
let panelView = 'library';
let routePanelViewBeforeSettings = 'library';
let routeLibraryQuery = '';
let routeLibrarySort = 'recent';
let routeLibraryFilter = 'all';
const expandedWalkHistoryRouteIds = new Set();
let routeBackupCandidate = null;
let routeBackupNotice = '';
let renamingRoute = false;
let confirmingDelete = false;
let routePanelNotice = '';
let mapSwitchNoticeTimeout = null;
let elevationRequesting = null;
let elevationDisclosureOpen = false;
let notePlacementMode = false;
let noteDraft = null;
let selectedAnnotationId = null;
let navigation = null;
let navigationSummary = null;
let trackRecording = null;
window.FieldMapsHasLiveSession = () => Boolean(navigation || trackRecording || navigationSummary || trackSummary || drawingMode || editingMode);
let trackSummary = null;
let confirmingTrackDiscard = false;
let navigationWakeLock = null;
let navigationWakeLockRequest = null;
let navigationElevationOpen = false;
let routeComparison = null;
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

const STEEPNESS_BANDS = [
  { id: 'strong-descent', label: 'Strong descent', range: '\u2264 -10%', color: '#2b6cb0', max: -10 },
  { id: 'moderate-descent', label: 'Moderate descent', range: '-10% to -5%', color: '#4c9ad4', max: -5 },
  { id: 'gentle-descent', label: 'Gentle descent', range: '-5% to -2%', color: '#76b7c5', max: -2 },
  { id: 'flat', label: 'Approximately flat', range: '-2% to 2%', color: '#8a929b', max: 2 },
  { id: 'gentle-ascent', label: 'Gentle ascent', range: '2% to 5%', color: '#c89b52', max: 5 },
  { id: 'moderate-ascent', label: 'Moderate ascent', range: '5% to 10%', color: '#d66a45', max: 10 },
  { id: 'strong-ascent', label: 'Strong ascent', range: '\u2265 10%', color: '#a93d3d', max: Infinity }
];
// Route-relative only: these colours express low-to-high elevation, not absolute altitude.
const ELEVATION_BANDS = [
  { id: 'low', color: '#2b6cb0' },
  { id: 'lower', color: '#3f7eb8' },
  { id: 'low-mid', color: '#4f9295' },
  { id: 'mid', color: '#71965d' },
  { id: 'high-mid', color: '#a38b4d' },
  { id: 'higher', color: '#bf7144' },
  { id: 'high', color: '#a94f3d' }
];
const routeDisplayMode = { uk: 'solid', world: 'solid' };

function getRouteLayer(mode) { return mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld; }
function getRouteSteepnessLayer(mode) { return mode === 'uk' ? routeSteepnessLayerUK : routeSteepnessLayerWorld; }
function getRouteComparisonLayer(mode) { return mode === 'uk' ? routeComparisonLayerUK : routeComparisonLayerWorld; }

function setSolidRouteVisibility(mode, route, visible) {
  const style = { ...window.getRouteStyle(mode, route), opacity: visible ? 1 : 0 };
  getRouteLayer(mode).eachLayer(child => {
    if (typeof child.setStyle === 'function') child.setStyle(style);
  });
}

function medianElevation(samples, index) {
  const values = samples.slice(Math.max(0, index - 1), Math.min(samples.length, index + 2))
    .map(sample => sample.elevation).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function getSteepnessBand(gradient) {
  return STEEPNESS_BANDS.find(band => gradient <= band.max) || STEEPNESS_BANDS[3];
}

function buildSteepnessSections(route) {
  const samples = getRouteElevationSamples(route);
  if (samples.length < 2) return [];
  const sections = [];
  for (let index = 0; index < samples.length - 1; index++) {
    // Median smoothing and a 3-sample look-around suppress short DEM noise only
    // for the display; cached elevations and profile data stay untouched.
    const start = Math.max(0, index - 1);
    const end = Math.min(samples.length - 1, index + 2);
    const horizontalDistance = samples[end].distance - samples[start].distance;
    if (!Number.isFinite(horizontalDistance) || horizontalDistance < 30) continue;
    const elevationChange = medianElevation(samples, end) - medianElevation(samples, start);
    const gradient = Math.abs(elevationChange) < 1.5 ? 0 : (elevationChange / horizontalDistance) * 100;
    const band = getSteepnessBand(gradient);
    const startPoint = [samples[index].lat, samples[index].lng];
    const endPoint = [samples[index + 1].lat, samples[index + 1].lng];
    const previous = sections[sections.length - 1];
    if (previous && previous.band.id === band.id) previous.latlngs.push(endPoint);
    else sections.push({ band, latlngs: [startPoint, endPoint] });
  }
  return sections;
}

function getElevationBand(elevation, minimum, maximum) {
  if (maximum <= minimum) return ELEVATION_BANDS[Math.floor(ELEVATION_BANDS.length / 2)];
  const proportion = Math.max(0, Math.min(1, (elevation - minimum) / (maximum - minimum)));
  return ELEVATION_BANDS[Math.min(ELEVATION_BANDS.length - 1, Math.floor(proportion * ELEVATION_BANDS.length))];
}

function buildElevationSections(route) {
  const samples = getRouteElevationSamples(route);
  if (samples.length < 2) return [];
  const elevations = samples.map(sample => sample.elevation);
  const minimum = Math.min(...elevations);
  const maximum = Math.max(...elevations);
  const sections = [];
  for (let index = 0; index < samples.length - 1; index++) {
    // A section represents the elevation at its midpoint, using only cached samples.
    const band = getElevationBand((samples[index].elevation + samples[index + 1].elevation) / 2, minimum, maximum);
    const startPoint = [samples[index].lat, samples[index].lng];
    const endPoint = [samples[index + 1].lat, samples[index + 1].lng];
    const previous = sections[sections.length - 1];
    if (previous && previous.band.id === band.id) previous.latlngs.push(endPoint);
    else sections.push({ band, latlngs: [startPoint, endPoint] });
  }
  return sections;
}

function clearSteepnessDisplay(mode) {
  getRouteSteepnessLayer(mode).clearLayers();
  routeDisplayMode[mode] = 'solid';
  const index = window.currentRouteIndex[mode];
  const route = Number.isInteger(index) ? window.getRouteList(mode)[index] : null;
  if (route) setSolidRouteVisibility(mode, route, true);
}

function showSteepnessDisplay(mode, route) {
  return showRouteVisualisation(mode, route, 'steepness', buildSteepnessSections(route));
}

function showElevationDisplay(mode, route) {
  return showRouteVisualisation(mode, route, 'elevation', buildElevationSections(route));
}

function showRouteVisualisation(mode, route, display, sections) {
  if (!sections.length) return false;
  const overlay = getRouteSteepnessLayer(mode);
  overlay.clearLayers();
  sections.forEach(section => overlay.addLayer(L.polyline(section.latlngs, {
    color: section.band.color, weight: 5, opacity: 0.95,
    lineCap: 'round', lineJoin: 'round', interactive: false
  })));
  setSolidRouteVisibility(mode, route, false);
  routeDisplayMode[mode] = display;
  return true;
}

function buildElevationLegend(route) {
  const elevations = getRouteElevationSamples(route).map(sample => sample.elevation);
  const minimum = Math.min(...elevations);
  const maximum = Math.max(...elevations);
  const midpoint = minimum + ((maximum - minimum) / 2);
  const label = `Elevation colour legend for this route: low ${Math.round(minimum)} metres, midpoint ${Math.round(midpoint)} metres, high ${Math.round(maximum)} metres.`;
  return `<div class="elevation-legend" role="img" aria-label="${label}">
    <div class="elevation-legend-labels"><span>Low elevation</span><span>High elevation</span></div>
    <div class="elevation-legend-bar" aria-hidden="true">${ELEVATION_BANDS.map(band => `<i style="--elevation-colour: ${band.color}"></i>`).join('')}</div>
    <div class="elevation-legend-values"><span>${Math.round(minimum)} m</span><span>${Math.round(midpoint)} m</span><span>${Math.round(maximum)} m</span></div>
  </div>`;
}

window.clearSteepnessDisplay = clearSteepnessDisplay;

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

function calculateRouteWalkingTime(distanceKm, elevationSummary) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return { totalMinutes: 0, timeStr: '', usesAscent: false };
  const ascent = Number(elevationSummary?.ascent);
  const usesAscent = Number.isFinite(ascent) && ascent >= 0;
  const minutes = (distanceKm / 5) * 60 + (usesAscent ? (ascent / 600) * 60 : 0);
  const totalMinutes = Math.round(minutes / 5) * 5;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return {
    totalMinutes,
    timeStr: hours ? `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''}` : `${totalMinutes}m`,
    usesAscent
  };
}

function getRouteMetrics(routeOrGeojson) {
  // Accepting geometry keeps this helper compatible with any legacy callers;
  // passing a route enables the cached-ascent allowance.
  const route = routeOrGeojson?.geojson ? routeOrGeojson : null;
  const geojson = route?.geojson || routeOrGeojson;
  if (!geojson) return { km: "", mi: "", timeStr: "" };
  let totalMeters = 0;
  const measure = geometry => {
    if (geometry.type === 'Feature') return measure(geometry.geometry);
    if (geometry.type === 'FeatureCollection') return geometry.features.forEach(measure);
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    lines.forEach(line => {
      for (let index = 1; index < line.length; index++) {
        totalMeters += distanceBetweenCoordinates(line[index - 1], line[index]);
      }
    });
  };
  if (!hasValidRouteCoordinates(geojson)) return { km: '', mi: '', timeStr: '' };
  measure(geojson);
  if (!totalMeters) return { km: "", mi: "", timeStr: "" };
  const km = (totalMeters / 1000).toFixed(2);
  const mi = (totalMeters / 1609.344).toFixed(2);
  const walkingTime = calculateRouteWalkingTime(totalMeters / 1000, getRouteElevationSummary(route));
  return { km, mi, ...walkingTime };
}

function getRouteElevationSummary(route) {
  const summary = route?.elevation?.summary;
  if (!summary || !['ascent', 'descent', 'min', 'max'].every(key => Number.isFinite(summary[key]))) return null;
  return summary;
}

function getRouteElevationSamples(route) {
  const samples = route?.elevation?.samples;
  if (!Array.isArray(samples) || samples.length < 2) return [];
  return samples.filter(sample => Number.isFinite(sample?.distance) && Number.isFinite(sample?.elevation) && Number.isFinite(sample?.lat) && Number.isFinite(sample?.lng));
}

function formatProfileDistance(distance) {
  if (distance < 1000) return `${Math.round(distance)} m`;
  const km = distance / 1000;
  return `${km.toLocaleString(undefined, { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

function clearRouteProfileMarker() {
  routeProfileMarkerUK.clearLayers();
  routeProfileMarkerWorld.clearLayers();
}

function showRouteProfileMarker(mode, sample) {
  const layer = mode === 'uk' ? routeProfileMarkerUK : routeProfileMarkerWorld;
  const otherLayer = mode === 'uk' ? routeProfileMarkerWorld : routeProfileMarkerUK;
  otherLayer.clearLayers();
  layer.clearLayers();
  layer.addLayer(L.circleMarker([sample.lat, sample.lng], {
    radius: 7,
    color: '#ffffff',
    weight: 3,
    fillColor: '#c94f08',
    fillOpacity: 1,
    interactive: false
  }));
}

function buildElevationProfile(samples) {
  const width = 1000, height = 220, left = 54, right = 16, top = 14, bottom = 32;
  const innerWidth = width - left - right, innerHeight = height - top - bottom;
  const totalDistance = samples[samples.length - 1].distance;
  const elevations = samples.map(sample => sample.elevation);
  const rawMin = Math.min(...elevations), rawMax = Math.max(...elevations);
  const padding = Math.max(8, (rawMax - rawMin) * 0.12);
  const min = Math.floor((rawMin - padding) / 5) * 5;
  const max = Math.ceil((rawMax + padding) / 5) * 5;
  const xFor = sample => left + (sample.distance / totalDistance) * innerWidth;
  const yFor = sample => top + ((max - sample.elevation) / (max - min || 1)) * innerHeight;
  const line = samples.map((sample, index) => `${index ? 'L' : 'M'} ${xFor(sample).toFixed(1)} ${yFor(sample).toFixed(1)}`).join(' ');
  const area = `${line} L ${xFor(samples[samples.length - 1]).toFixed(1)} ${(height - bottom).toFixed(1)} L ${left} ${(height - bottom).toFixed(1)} Z`;
  return {
    totalDistance,
    markup: `<div class="elevation-profile" tabindex="0" role="group" aria-label="Interactive elevation profile. Use left and right arrow keys to inspect samples.">
      <svg class="elevation-profile-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line class="elevation-profile-grid" x1="${left}" x2="${width - right}" y1="${top}" y2="${top}" />
        <line class="elevation-profile-grid" x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" />
        <path class="elevation-profile-area" d="${area}" />
        <path class="elevation-profile-line" d="${line}" />
        <line class="elevation-profile-cursor" x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" />
        <circle class="elevation-profile-point" cx="${left}" cy="${yFor(samples[0]).toFixed(1)}" r="6" />
        <text class="elevation-profile-y-label" x="${left - 8}" y="${top + 4}" text-anchor="end">${Math.round(max)} m</text>
        <text class="elevation-profile-y-label" x="${left - 8}" y="${height - bottom + 4}" text-anchor="end">${Math.round(min)} m</text>
        <text class="elevation-profile-x-label" x="${left}" y="${height - 8}">0 km</text>
        <text class="elevation-profile-x-label" x="${width - right}" y="${height - 8}" text-anchor="end">${formatProfileDistance(totalDistance)}</text>
      </svg>
      <p class="elevation-profile-readout" id="elevation-profile-readout" aria-live="polite">Start: ${formatProfileDistance(samples[0].distance)}, ${Math.round(samples[0].elevation)} m</p>
    </div>`
  };
}

function bindElevationProfile(context, samples) {
  const profile = panelContent.querySelector('.elevation-profile');
  if (!profile || samples.length < 2) return;
  const chart = profile.querySelector('.elevation-profile-chart');
  const cursor = profile.querySelector('.elevation-profile-cursor');
  const point = profile.querySelector('.elevation-profile-point');
  const readout = profile.querySelector('.elevation-profile-readout');
  const totalDistance = samples[samples.length - 1].distance;
  const xFor = sample => 54 + (sample.distance / totalDistance) * 930;
  const yRange = (() => {
    const values = samples.map(sample => sample.elevation);
    const padding = Math.max(8, (Math.max(...values) - Math.min(...values)) * 0.12);
    return { min: Math.floor((Math.min(...values) - padding) / 5) * 5, max: Math.ceil((Math.max(...values) + padding) / 5) * 5 };
  })();
  const yFor = sample => 14 + ((yRange.max - sample.elevation) / (yRange.max - yRange.min || 1)) * 174;
  let activeIndex = 0;
  let pointerDown = false;
  const clear = () => {
    cursor.classList.remove('is-visible');
    point.classList.remove('is-visible');
    clearRouteProfileMarker();
  };
  const setSample = index => {
    activeIndex = Math.max(0, Math.min(samples.length - 1, index));
    const sample = samples[activeIndex];
    const x = xFor(sample).toFixed(1), y = yFor(sample).toFixed(1);
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
    point.setAttribute('cx', x); point.setAttribute('cy', y);
    cursor.classList.add('is-visible'); point.classList.add('is-visible');
    readout.textContent = `${formatProfileDistance(sample.distance)} along route — ${Math.round(sample.elevation)} m elevation`;
    showRouteProfileMarker(context.mode, sample);
  };
  const indexAtEvent = event => {
    const rect = chart.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const distance = fraction * totalDistance;
    let nearest = 0;
    for (let index = 1; index < samples.length; index++) {
      if (Math.abs(samples[index].distance - distance) < Math.abs(samples[nearest].distance - distance)) nearest = index;
    }
    return nearest;
  };
  profile.addEventListener('pointerdown', event => {
    pointerDown = true;
    profile.setPointerCapture?.(event.pointerId);
    setSample(indexAtEvent(event));
    event.preventDefault();
  });
  profile.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse' || pointerDown) setSample(indexAtEvent(event));
  });
  profile.addEventListener('pointerup', () => { pointerDown = false; clear(); });
  profile.addEventListener('pointercancel', () => { pointerDown = false; clear(); });
  profile.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !pointerDown) clear(); });
  profile.addEventListener('blur', clear);
  profile.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') setSample(0);
    else if (event.key === 'End') setSample(samples.length - 1);
    else setSample(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
  });
}

function getNavigationLayer(mode) { return mode === 'uk' ? navigationLayerUK : navigationLayerWorld; }
function getNavigationMap(mode) { return mode === 'uk' ? mapUK : mapWorld; }

function formatNavigationDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) return '—';
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toLocaleString(undefined, { maximumFractionDigits: distance < 10000 ? 1 : 0 })} km`;
}

function formatNavigationElapsed(milliseconds) {
  const minutes = Math.max(0, Math.floor((Number(milliseconds) || 0) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}

function formatNavigationClock(milliseconds) {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function activityFromRecording(recording) {
  const startedAt = Number(recording?.startTime);
  const endedAt = Number(recording?.endTime);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return {
    type: 'walked',
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    // This uses the same whole-second value displayed in the session summary.
    durationSeconds: Math.max(0, Math.floor((Number(recording.elapsed) || 0) / 1000))
  };
}

function clearNavigationOverlays() {
  navigationLayerUK.clearLayers();
  navigationLayerWorld.clearLayers();
  panelContent.querySelectorAll('.elevation-profile-navigation').forEach(item => item.remove());
}

function getLiveLocationSession() { return navigation || trackRecording; }
window.hasFieldMapsLiveLocation = () => Boolean(getLiveLocationSession());

function stopNormalLocateControls() {
  [mapUK, mapWorld].forEach(map => map._fieldMapsLocateControl?.stop?.());
}

function clearLiveLocationViewport(live) {
  if (!live) return;
  live.follow = false;
  // A finished session must not leave an in-flight map movement behind for the
  // saved-route view that follows it.
  getNavigationMap(live.mode).stop();
}

function renderLiveLocationOverlays(live) {
  if (!live) return;
  const layer = getNavigationLayer(live.mode);
  layer.clearLayers();
  const state = live.session.getState();
  const recording = live.session.getRecording();
  const points = recording && recording.points || [];
  if (points.length > 1) {
    layer.addLayer(L.polyline(points.map(point => [point.lat, point.lng]), {
      color: '#386a93', weight: 4, opacity: 0.55, lineCap: 'round', lineJoin: 'round', interactive: false,
      className: 'navigation-walked-trail'
    }));
  }
  if (state.latestPosition) {
    layer.addLayer(L.marker([state.latestPosition.lat, state.latestPosition.lng], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'navigation-position-marker',
        html: '<span class="navigation-position-halo"></span><span class="navigation-position-dot"></span>',
        iconSize: [24, 24], iconAnchor: [12, 12]
      })
    }));
  }
}

function renderNavigationOverlays() { renderLiveLocationOverlays(navigation); }

function updateNavigationProfileIndicator() {
  if (!navigation || !navigation.match?.elevation) return;
  const line = panelContent.querySelector('.elevation-profile-navigation');
  if (!line) return;
  const fraction = Math.max(0, Math.min(1, navigation.match.elevation.profileProgress || 0));
  const x = (54 + fraction * 930).toFixed(1);
  line.setAttribute('x1', x); line.setAttribute('x2', x);
}

async function requestNavigationWakeLock() {
  const live = getLiveLocationSession();
  if (!live || !navigator.wakeLock?.request || navigationWakeLock || navigationWakeLockRequest) return;
  const request = {};
  navigationWakeLockRequest = request;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (navigationWakeLockRequest !== request || getLiveLocationSession() !== live) {
      await lock.release();
      return;
    }
    navigationWakeLock = lock;
    lock.addEventListener?.('release', () => { if (navigationWakeLock === lock) navigationWakeLock = null; });
  } catch (error) {
    // Navigation is intentionally usable when wake lock is unavailable.
  } finally {
    if (navigationWakeLockRequest === request) navigationWakeLockRequest = null;
  }
}

function releaseNavigationWakeLock() {
  const lock = navigationWakeLock;
  navigationWakeLock = null;
  navigationWakeLockRequest = null;
  if (lock) lock.release().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (getLiveLocationSession() && document.visibilityState === 'visible') requestNavigationWakeLock();
});

function updateNavigationPeek() {
  if (trackRecording) {
    const recording = trackRecording.session.getRecording();
    const status = recording?.status === 'paused' ? 'Paused' : (trackRecording.ready ? 'Recording' : 'Locating');
    panelRouteToggle.innerHTML = `<i class="fas fa-person-walking" aria-hidden="true"></i><span class="navigation-peek-copy"><span>${escapeHtml(`${status} · ${formatNavigationDistance(recording?.distance || 0)}`)}</span><small>⏱ ${formatNavigationClock(recording?.elapsed || 0)}</small></span>`;
    return;
  }
  if (!navigation) {
    panelRouteToggle.innerHTML = '<i class="fas fa-route" aria-hidden="true"></i><span>Routes</span>';
    return;
  }
  const remaining = navigation.match ? formatNavigationDistance(navigation.match.stabilised.distanceRemaining) : 'Locating…';
  const time = navigation.match?.remainingTime?.timeStr ? ` · ~${navigation.match.remainingTime.timeStr}` : '';
  const elapsed = formatNavigationClock(navigation.session.getRecording()?.elapsed || 0);
  panelRouteToggle.innerHTML = `<i class="fas fa-person-walking" aria-hidden="true"></i><span class="navigation-peek-copy"><span>${escapeHtml(remaining + time)}</span><small>⏱ ${elapsed}</small></span>`;
}

function navigationMetricsMarkup() {
  const recording = navigation && navigation.session.getRecording();
  const match = navigation && navigation.match;
  if (!navigation) return '';
  if (!match) {
    const error = navigation.session.getState().error;
    return `<p class="navigation-waiting" role="status">${escapeHtml(trackErrorMessage(error))}</p>`;
  }
  const routeTotal = formatNavigationDistance(match.stabilised.totalDistance);
  const completed = formatNavigationDistance(match.stabilised.distanceAlong);
  const remaining = formatNavigationDistance(match.stabilised.distanceRemaining);
  const time = match.remainingTime?.timeStr ? `~${match.remainingTime.timeStr}` : '—';
  const elevation = match.elevation;
  return `<div class="navigation-primary"><strong>${remaining} remaining</strong><span>${time}</span></div>
    <p class="navigation-progress">${completed} of ${routeTotal} · ${Math.round(match.stabilised.progress * 100)}%</p>
    <dl class="navigation-session-metrics">
      <div><dt>Walked</dt><dd>${formatNavigationDistance(recording?.distance || 0)}</dd></div>
      <div><dt>Elapsed</dt><dd class="navigation-elapsed-value">${formatNavigationClock(recording?.elapsed || 0)}</dd></div>
      ${elevation ? `<div><dt>Matched elevation</dt><dd>${Math.round(elevation.elevation)} m</dd></div><div><dt>Ascent remaining</dt><dd>${Math.round(elevation.remainingAscent)} m</dd></div>` : ''}
    </dl>
    ${match.raw.distanceFromRoute >= 25 ? `<p class="navigation-off-route">${formatNavigationDistance(match.raw.distanceFromRoute)} from route</p>` : ''}`;
}

function refreshNavigationUI() {
  if (!navigation) return;
  const metrics = panelContent.querySelector('#navigation-metrics');
  if (metrics) metrics.innerHTML = navigationMetricsMarkup();
  const follow = panelContent.querySelector('#navigation-recenter');
  if (follow) {
    follow.hidden = navigation.follow;
    follow.textContent = navigation.follow ? 'Following' : 'Recenter';
  }
  renderNavigationOverlays();
  updateNavigationProfileIndicator();
  updateNavigationPeek();
}

function trackErrorMessage(error) {
  if (!error) return 'Waiting for a usable GPS position…';
  if (error.type === 'permission-denied') return 'Location permission was denied. Allow location access and try again.';
  if (error.type === 'timeout') return 'Location timed out. Keep this screen open and try again.';
  if (error.type === 'position-unavailable') return 'Location is currently unavailable. Try again when GPS is available.';
  return error.message || 'Location is unavailable in this browser.';
}

function trackMetricsMarkup() {
  const recording = trackRecording?.session.getRecording();
  const state = trackRecording?.session.getState();
  if (!trackRecording || !recording) return '';
  if (!trackRecording.ready) return `<p class="navigation-waiting" role="status">${escapeHtml(trackErrorMessage(state?.error))}</p>`;
  const stateLabel = recording.status === 'paused' ? 'Paused' : 'Recording';
  return `<div class="navigation-primary"><strong>${formatNavigationDistance(recording.distance)} recorded</strong><span>${stateLabel}</span></div>
    <dl class="navigation-session-metrics"><div><dt>Active time</dt><dd class="navigation-elapsed-value">${formatNavigationClock(recording.elapsed)}</dd></div><div><dt>GPS accuracy</dt><dd>${state?.accuracy ? `±${Math.round(state.accuracy)} m` : '—'}</dd></div></dl>`;
}

function refreshTrackUI() {
  if (!trackRecording) return;
  const metrics = panelContent.querySelector('#track-metrics');
  if (metrics) metrics.innerHTML = trackMetricsMarkup();
  const recenter = panelContent.querySelector('#track-recenter');
  if (recenter) recenter.hidden = trackRecording.follow;
  const paused = trackRecording.session.getRecording()?.status === 'paused';
  const pause = panelContent.querySelector('#track-pause');
  if (pause) pause.textContent = paused ? 'Resume' : 'Pause';
  const title = panelContent.querySelector('.route-title');
  if (title) title.textContent = paused ? 'Recording paused' : (trackRecording.ready ? 'Recording' : 'Starting recording');
  renderLiveLocationOverlays(trackRecording);
  updateNavigationPeek();
}

function refreshTrackTimer() {
  if (!trackRecording) return;
  const elapsed = formatNavigationClock(trackRecording.session.getRecording()?.elapsed || 0);
  panelContent.querySelectorAll('.navigation-elapsed-value').forEach(item => { item.textContent = elapsed; });
  updateNavigationPeek();
}

function showTrackPrestart() {
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Track my route');
  panelContent.className = 'route-detail-content navigation-mode-content';
  panelContent.innerHTML = `<div class="panel-navigation"><button id="back-to-library-from-track" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Saved routes</button></div>
    <div class="panel-heading workflow-heading"><div class="panel-eyebrow">New route</div><h2 class="route-title">Track my route</h2><p class="panel-hint">Record a walk directly from your GPS location. Nothing is saved until you finish and save it.</p></div>
    <div class="route-actions-row navigation-actions"><button id="start-track-recording" class="primary-action" type="button"><i class="fa-solid fa-play" aria-hidden="true"></i> Start recording</button></div>`;
  panelContent.querySelector('#back-to-library-from-track').onclick = () => { panelView = 'library'; showRoutePanelContent(); };
  panelContent.querySelector('#start-track-recording').onclick = startTrackRecording;
}

function startTrackRecording() {
  if (trackRecording || navigation || !window.FieldMapsLiveLocation) {
    routePanelNotice = navigation ? 'Finish or discard the active walk before starting a tracked route.' : 'A recording is already active.';
    panelView = 'library';
    showRoutePanelContent();
    return;
  }
  clearRouteComparison();
  stopNormalLocateControls();
  const session = FieldMapsLiveLocation.createSession();
  const receive = session.onLocation;
  session.onLocation = function(position) {
    receive.call(session, position);
    if (!trackRecording) return;
    trackRecording.ready = true;
    followNavigationPosition();
    refreshTrackUI();
  };
  const receiveError = session.onLocationError;
  session.onLocationError = function(error) {
    receiveError.call(session, error);
    refreshTrackUI();
  };
  trackRecording = { mode: window.currentMode || 'uk', session, follow: true, ready: false, timerId: null };
  session.startRecording();
  requestNavigationWakeLock();
  startNavigationTimerFor(trackRecording, refreshTrackTimer);
  panelView = 'track-recording';
  setRoutePanelOpen(true);
  refreshTrackUI();
}

function startNavigationTimerFor(live, refresh) {
  if (!live || live.timerId) return;
  live.timerId = window.setInterval(refresh, 1000);
  refresh();
}

function pauseTrackRecording() { if (trackRecording) { trackRecording.session.pauseRecording(); refreshTrackUI(); } }
function resumeTrackRecording() { if (trackRecording) { trackRecording.session.resumeRecording(); requestNavigationWakeLock(); refreshTrackUI(); } }

function finishTrackRecording() {
  if (!trackRecording) return;
  const ending = trackRecording;
  stopNavigationTimer(ending);
  clearLiveLocationViewport(ending);
  const recording = ending.session.finishRecording();
  trackSummary = { mode: ending.mode, session: ending.session, recording };
  confirmingTrackDiscard = false;
  trackRecording = null;
  releaseNavigationWakeLock();
  clearNavigationOverlays();
  panelView = 'track-summary';
  updateNavigationPeek();
  showRoutePanelContent();
}

function resumeTrackSummary() {
  if (!trackSummary) return;
  const summary = trackSummary;
  trackSummary = null;
  confirmingTrackDiscard = false;
  trackRecording = { mode: summary.mode, session: summary.session, follow: true, ready: Boolean(summary.session.getState().latestPosition), timerId: null };
  summary.session.resumeFinishedRecording();
  requestNavigationWakeLock();
  startNavigationTimerFor(trackRecording, refreshTrackTimer);
  panelView = 'track-recording';
  showRoutePanelContent();
}

function discardTrackSummary() {
  if (!trackSummary) return;
  trackSummary.session.cancelRecording();
  trackSummary = null;
  confirmingTrackDiscard = false;
  clearNavigationOverlays();
  releaseNavigationWakeLock();
  panelView = 'library';
  showRoutePanelContent();
}

function saveTrackedRoute() {
  const summary = trackSummary;
  if (!summary || summary.recording.pointCount < 2) return;
  const geojson = FieldMapsLiveLocation.recordingGeoJSON(summary.recording.points);
  if (!geojson) {
    routePanelNotice = 'This recording contains invalid GPS coordinates and cannot be saved.';
    showRoutePanelContent();
    return;
  }
  const layer = L.geoJSON(geojson);
  const targetLayer = summary.mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
  const notesLayer = summary.mode === 'uk' ? window.routeNotesLayerUK : window.routeNotesLayerWorld;
  try {
    window.currentRouteIndex[summary.mode] = window.saveRouteToList(summary.mode, 'Recorded walk', layer, null, {
      activity: activityFromRecording(summary.recording)
    });
  } catch (_) {
    showRecordingSaveError();
    return;
  }
  targetLayer.clearLayers(); notesLayer.clearLayers();
  window.applyRouteStyle(layer, summary.mode, window.getRouteList(summary.mode)[window.currentRouteIndex[summary.mode]]);
  layer.eachLayer(item => targetLayer.addLayer(item));
  summary.session.cancelRecording();
  trackSummary = null;
  renamingRoute = true;
  routePanelNotice = '';
  panelView = 'details';
  window.updateRouteListUI(summary.mode);
  showRoutePanelContent();
  updateRouteFabLabel();
}

function showTrackRecording() {
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Track my route');
  panelContent.className = 'route-detail-content navigation-mode-content';
  const recording = trackRecording.session.getRecording();
  panelContent.innerHTML = `<div class="panel-heading active-route-heading"><div class="panel-eyebrow"><i class="fa-solid fa-person-walking" aria-hidden="true"></i> Track my route</div><h2 class="route-title">${recording.status === 'paused' ? 'Recording paused' : (trackRecording.ready ? 'Recording' : 'Starting recording')}</h2></div><div id="track-metrics">${trackMetricsMarkup()}</div>
    <div class="route-actions-row navigation-actions"><button id="track-recenter" class="panel-action" type="button"${trackRecording.follow ? ' hidden' : ''}>Recenter</button><button id="track-pause" class="panel-action" type="button">${recording.status === 'paused' ? 'Resume' : 'Pause'}</button><button id="track-finish" class="danger-solid" type="button">Finish</button></div>`;
  panelContent.querySelector('#track-recenter').onclick = () => { trackRecording.follow = true; followNavigationPosition(); refreshTrackUI(); };
  panelContent.querySelector('#track-pause').onclick = () => trackRecording?.session.getRecording()?.status === 'paused' ? resumeTrackRecording() : pauseTrackRecording();
  panelContent.querySelector('#track-finish').onclick = finishTrackRecording;
}

function showTrackSummary() {
  const summary = trackSummary;
  if (!summary) { panelView = 'library'; showRoutePanelContent(); return; }
  const valid = summary.recording.pointCount >= 2;
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Recorded route summary');
  panelContent.className = 'route-detail-content navigation-summary-content';
  panelContent.innerHTML = `<div class="panel-heading"><div class="panel-eyebrow">Recording complete</div><h2 class="route-title">Route summary</h2></div><dl class="navigation-session-metrics navigation-summary-metrics"><div><dt>Recorded</dt><dd>${formatNavigationDistance(summary.recording.distance)}</dd></div><div><dt>Active time</dt><dd>${formatNavigationClock(summary.recording.elapsed)}</dd></div><div><dt>Recorded points</dt><dd>${summary.recording.pointCount}</dd></div></dl>${valid ? '' : '<p class="navigation-waiting" role="status">At least two accepted GPS positions are needed to save a route. Resume recording or discard it.</p>'}${confirmingTrackDiscard ? '<div class="route-delete-confirm" role="alert"><div><strong>Discard this recording?</strong><span>This cannot be recovered after leaving this screen.</span></div><div class="route-actions-row"><button id="confirm-discard-tracked-route" class="danger-solid" type="button">Discard recording</button><button id="cancel-discard-tracked-route" class="panel-action" type="button">Keep recording</button></div></div>' : '<div class="route-actions-row navigation-actions"><button id="save-tracked-route" class="primary-action" type="button"' + (valid ? '' : ' disabled') + '>Save route</button><button id="resume-tracked-route" class="panel-action" type="button">Resume recording</button><button id="discard-tracked-route" class="danger-solid" type="button">Discard</button></div>'}`;
  const save = panelContent.querySelector('#save-tracked-route');
  if (save) save.onclick = saveTrackedRoute;
  const resume = panelContent.querySelector('#resume-tracked-route');
  if (resume) resume.onclick = resumeTrackSummary;
  const discard = panelContent.querySelector('#discard-tracked-route');
  if (discard) discard.onclick = () => { confirmingTrackDiscard = true; showTrackSummary(); };
  const confirmDiscard = panelContent.querySelector('#confirm-discard-tracked-route');
  if (confirmDiscard) confirmDiscard.onclick = discardTrackSummary;
  const cancelDiscard = panelContent.querySelector('#cancel-discard-tracked-route');
  if (cancelDiscard) cancelDiscard.onclick = () => { confirmingTrackDiscard = false; showTrackSummary(); };
}

function refreshNavigationTimer() {
  if (!navigation) return;
  const elapsed = formatNavigationClock(navigation.session.getRecording()?.elapsed || 0);
  panelContent.querySelectorAll('.navigation-elapsed-value').forEach(item => { item.textContent = elapsed; });
  updateNavigationPeek();
}

function startNavigationTimer() {
  startNavigationTimerFor(navigation, refreshNavigationTimer);
}

function stopNavigationTimer(session) {
  if (session?.timerId) window.clearInterval(session.timerId);
  if (session) session.timerId = null;
}

function getNavigationUsableMapPoint(mode) {
  const map = getNavigationMap(mode);
  const container = map.getContainer();
  const mapRect = container.getBoundingClientRect();
  let visibleBottom = mapRect.bottom;
  let visibleRight = mapRect.right;
  if (isMobileDrawerLayout()) {
    const drawerRect = panel.getBoundingClientRect();
    if (drawerRect.top > mapRect.top && drawerRect.top < mapRect.bottom) visibleBottom = drawerRect.top;
  } else if (panel.classList.contains('open')) {
    const drawerRect = panel.getBoundingClientRect();
    if (drawerRect.left > mapRect.left && drawerRect.left < mapRect.right) visibleRight = drawerRect.left;
  }
  return L.point(
    Math.max(0, (visibleRight - mapRect.left) / 2),
    Math.max(0, (visibleBottom - mapRect.top) / 2)
  );
}

function getOfflineCurrentAreaBounds() {
  if ((window.currentMode || 'uk') !== 'uk') throw new Error('Switch to the UK map to download the current area.');
  const point = getNavigationUsableMapPoint('uk');
  const topLeft = mapUK.containerPointToLatLng([0, 0]);
  const bottomRight = mapUK.containerPointToLatLng([point.x * 2, point.y * 2]);
  return window.FieldMapsOfflineMaps.visibleAreaBounds(topLeft, bottomRight);
}

function viewOfflinePack(pack) {
  if ((window.currentMode || 'uk') !== 'uk' && !window.switchMap('uk')) return;
  const layer = { Road_27700: ukBaseLayers['OS Road'], Outdoor_27700: ukBaseLayers['OS Outdoor'],
    Leisure_27700: ukBaseLayers['OS Leisure'] }[pack.layer];
  if (!layer || !pack.bounds) return;
  Object.values(ukBaseLayers).forEach(base => mapUK.removeLayer(base));
  layer.addTo(mapUK);
  panelView = 'library';
  setRoutePanelOpen(false);
  mapUK.invalidateSize();
  mapUK.fitBounds([[pack.bounds.south, pack.bounds.west], [pack.bounds.north, pack.bounds.east]], getRouteFitOptions());
}

function followNavigationPosition() {
  const live = getLiveLocationSession();
  if (!live?.follow || !live.session.latestPosition) return;
  const map = getNavigationMap(live.mode);
  const zoom = map.getZoom();
  const current = map.latLngToContainerPoint([live.session.latestPosition.lat, live.session.latestPosition.lng]);
  const target = getNavigationUsableMapPoint(live.mode);
  const delta = current.subtract(target);
  if (Math.abs(delta.x) < 12 && Math.abs(delta.y) < 12) return;
  // panBy works in container pixels and therefore cannot alter Leaflet's zoom.
  // Keeping this non-animated also prevents rapid Android GPS callbacks from
  // queueing competing pan animations and flashing the viewport.
  map.panBy(delta, { animate: false, noMoveStart: true });
  console.assert(map.getZoom() === zoom, 'Live location follow must preserve zoom');
}

function refreshNavigationMapPosition() {
  if (!getLiveLocationSession()?.follow) return;
  window.requestAnimationFrame(followNavigationPosition);
  window.setTimeout(followNavigationPosition, 230);
}

function handleNavigationPosition(position) {
  if (!navigation) return;
  navigation.match = FieldMapsLiveLocation.matchRouteProgress(navigation.plannedRoute, position, navigation.progressState);
  navigation.progressState = navigation.match.progressState;
  followNavigationPosition();
  refreshNavigationUI();
}

function startNavigation(context) {
  if (navigation || !window.FieldMapsLiveLocation) return;
  if (trackRecording || trackSummary) {
    routePanelNotice = 'Finish, save, or discard the tracked route before starting Navigation Mode.';
    showRoutePanelContent();
    return;
  }
  clearRouteComparison();
  if (typeof routeLineCoordinates !== 'function' || routeLineCoordinates(context.route.geojson).length < 2) {
    routePanelNotice = 'This route needs at least two points before it can be walked.';
    showRoutePanelContent();
    return;
  }
  stopNormalLocateControls();
  const session = FieldMapsLiveLocation.createSession();
  const receive = session.onLocation;
  session.onLocation = function(position) {
    receive.call(session, position);
    handleNavigationPosition(position);
  };
  const receiveError = session.onLocationError;
  session.onLocationError = function(error) {
    receiveError.call(session, error);
    refreshNavigationUI();
  };
  navigation = {
    mode: context.mode, index: context.index, plannedRoute: context.route,
    session, progressState: null, match: null, follow: true, timerId: null
  };
  // This starts recording and the shared geolocation watcher exactly once.
  session.startRecording();
  requestNavigationWakeLock();
  navigationElevationOpen = false;
  if (session.getState().active) startNavigationTimer();
  panelView = 'navigation';
  setRoutePanelOpen(true);
  refreshNavigationUI();
}

function endNavigation() {
  if (!navigation) return;
  const ending = navigation;
  stopNavigationTimer(ending);
  clearLiveLocationViewport(ending);
  const recording = ending.session.finishRecording();
  navigationSummary = { mode: ending.mode, index: ending.index, plannedRoute: ending.plannedRoute, match: ending.match, recording };
  navigation = null;
  releaseNavigationWakeLock();
  clearNavigationOverlays();
  updateNavigationPeek();
  panelView = 'navigation-summary';
  showRoutePanelContent();
}

function discardNavigationSummary() {
  navigationSummary = null;
  panelView = 'details';
  showRoutePanelContent();
}

function saveNavigationTrack(name) {
  const summary = navigationSummary;
  const points = summary?.recording?.points || [];
  if (!summary || points.length < 2) return false;
  const geojson = FieldMapsLiveLocation.recordingGeoJSON(points);
  if (!geojson) return false;
  const layer = L.geoJSON(geojson);
  let index;
  try {
    index = window.saveRouteToList(summary.mode, name, layer, null, {
      sourceRouteId: summary.plannedRoute.id,
      activity: activityFromRecording(summary.recording)
    });
  } catch (_) {
    showRecordingSaveError();
    return false;
  }
  summary.recording = null;
  navigationSummary = null;
  routePanelNotice = 'Walked track saved as a new route.';
  panelView = 'details';
  showRoutePanelContent();
  updateRouteFabLabel();
  return Number.isInteger(index);
}

function showRecordingSaveError() {
  let notice = panelContent.querySelector('#recording-save-error');
  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'recording-save-error';
    notice.className = 'route-workflow-error';
    notice.setAttribute('role', 'alert');
    panelContent.appendChild(notice);
  }
  notice.textContent = 'Could not save this walk. Browser storage may be full or unavailable. Keep this page open; the recording is still here so you can retry.';
}

function showNavigationMode() {
  const route = navigation.plannedRoute;
  const samples = getRouteElevationSamples(route);
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Navigation mode');
  panelContent.className = 'route-detail-content navigation-mode-content';
  panelContent.innerHTML = `<div class="panel-heading active-route-heading"><div class="panel-eyebrow"><i class="fa-solid fa-person-walking" aria-hidden="true"></i> Navigation mode</div><h2 class="route-title">${escapeHtml(route.name || 'Untitled route')}</h2></div>
    <div id="navigation-metrics">${navigationMetricsMarkup()}</div>
    ${samples.length ? `<details class="navigation-elevation"${navigationElevationOpen ? ' open' : ''}><summary><span>Elevation</span><small>${navigation.match?.elevation ? `${Math.round(navigation.match.elevation.elevation)} m · ${Math.round(navigation.match.elevation.remainingAscent)} m up` : 'Available'}</small><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="navigation-profile">${buildElevationProfile(samples).markup}</div></details>` : ''}
    <div class="route-actions-row navigation-actions"><button id="navigation-recenter" class="panel-action" type="button"${navigation.follow ? ' hidden' : ''}>Recenter</button><button id="navigation-end" class="danger-solid" type="button">End walk</button></div>`;
  panelContent.querySelector('#navigation-recenter').onclick = () => { navigation.follow = true; followNavigationPosition(); refreshNavigationUI(); };
  panelContent.querySelector('#navigation-end').onclick = endNavigation;
  const elevationDisclosure = panelContent.querySelector('.navigation-elevation');
  if (elevationDisclosure) elevationDisclosure.ontoggle = () => { navigationElevationOpen = elevationDisclosure.open; refreshNavigationMapPosition(); };
  if (samples.length && navigationElevationOpen && navigation.match?.elevation) {
    const chart = panelContent.querySelector('.elevation-profile-chart');
    chart.insertAdjacentHTML('beforeend', '<line class="elevation-profile-navigation" x1="54" x2="54" y1="14" y2="188" />');
    updateNavigationProfileIndicator();
  }
}

function showNavigationSummary() {
  const summary = navigationSummary;
  if (!summary) { panelView = 'details'; showRoutePanelContent(); return; }
  const total = getRouteMetrics(summary.plannedRoute).km;
  const progress = summary.match ? `${Math.round(summary.match.stabilised.progress * 100)}%` : 'No matched progress';
  const suggestedName = `${summary.plannedRoute.name || 'Route'} — Walked`;
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Walk summary');
  panelContent.className = 'route-detail-content navigation-summary-content';
  panelContent.innerHTML = `<div class="panel-heading"><div class="panel-eyebrow">Walk complete</div><h2 class="route-title">Session summary</h2></div>
    <dl class="navigation-session-metrics navigation-summary-metrics"><div><dt>Planned route</dt><dd>${total ? `${total} km` : '—'}</dd></div><div><dt>Progress reached</dt><dd>${progress}</dd></div><div><dt>Walked</dt><dd>${formatNavigationDistance(summary.recording?.distance || 0)}</dd></div><div><dt>Elapsed</dt><dd>${formatNavigationClock(summary.recording?.elapsed || 0)}</dd></div><div><dt>Recorded points</dt><dd>${summary.recording?.pointCount || 0}</dd></div></dl>
    <label class="navigation-save-label" for="walked-track-name">Walked track name</label><input id="walked-track-name" maxlength="100" value="${escapeAttribute(suggestedName)}">
    <div class="route-actions-row navigation-actions"><button id="save-walked-track" class="primary-action" type="button"${summary.recording?.pointCount >= 2 ? '' : ' disabled'}>Save walked track</button><button id="discard-walked-track" class="panel-action" type="button">Discard walked track</button></div>`;
  panelContent.querySelector('#save-walked-track').onclick = () => {
    const name = panelContent.querySelector('#walked-track-name').value.trim();
    if (name) saveNavigationTrack(name);
  };
  panelContent.querySelector('#discard-walked-track').onclick = discardNavigationSummary;
}

function getShareableRouteName(route) {
  return route && route.name ? route.name : 'Shared Route';
}

function getRouteLineCoordinates(geojson) {
  const feature = geojson && geojson.type === 'FeatureCollection' ? geojson.features.find(item => item && item.geometry && item.geometry.type === 'LineString') : geojson;
  const geometry = feature && feature.type === 'Feature' ? feature.geometry : feature;
  return geometry && geometry.type === 'LineString' && Array.isArray(geometry.coordinates) ? geometry.coordinates.filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) : [];
}

function lineCoordinatesToGeojson(coordinates) {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] };
}

function encodePolyline(coordinates) {
  let previousLat = 0, previousLng = 0, encoded = '';
  const encodeValue = value => {
    let current = value < 0 ? ~(value << 1) : value << 1;
    while (current >= 0x20) { encoded += String.fromCharCode((0x20 | (current & 0x1f)) + 63); current >>= 5; }
    encoded += String.fromCharCode(current + 63);
  };
  coordinates.forEach(point => {
    const lat = Math.round(point[1] * 1e5), lng = Math.round(point[0] * 1e5);
    encodeValue(lat - previousLat); encodeValue(lng - previousLng);
    previousLat = lat; previousLng = lng;
  });
  return encoded;
}

function decodePolyline(encoded) {
  let index = 0, lat = 0, lng = 0; const coordinates = [];
  const decodeValue = () => {
    let result = 0, shift = 0, byte;
    do { if (index >= encoded.length) throw new Error('Invalid route geometry'); byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) { lat += decodeValue(); lng += decodeValue(); coordinates.push([lng / 1e5, lat / 1e5]); }
  return coordinates;
}

function pointSegmentDistanceMeters(point, start, end) {
  const latitude = (point[1] + start[1] + end[1]) / 3 * Math.PI / 180;
  const scaleX = 111320 * Math.cos(latitude), scaleY = 110540;
  const px = point[0] * scaleX, py = point[1] * scaleY, ax = start[0] * scaleX, ay = start[1] * scaleY, bx = end[0] * scaleX, by = end[1] * scaleY;
  const dx = bx - ax, dy = by - ay;
  const ratio = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

function simplifyRouteCoordinates(coordinates, toleranceMeters) {
  if (coordinates.length < 3) return coordinates.slice();
  const keep = new Uint8Array(coordinates.length); keep[0] = keep[coordinates.length - 1] = 1;
  const simplify = (first, last) => {
    let largest = toleranceMeters, largestIndex = -1;
    for (let i = first + 1; i < last; i++) { const distance = pointSegmentDistanceMeters(coordinates[i], coordinates[first], coordinates[last]); if (distance > largest) { largest = distance; largestIndex = i; } }
    if (largestIndex !== -1) { keep[largestIndex] = 1; simplify(first, largestIndex); simplify(largestIndex, last); }
  };
  simplify(0, coordinates.length - 1);
  return coordinates.filter((_, index) => keep[index]);
}

function getRoutingWaypoints(geojson) {
  const coordinates = getRouteLineCoordinates(geojson);
  if (coordinates.length < 2) return [];
  let tolerance = 12, simplified = simplifyRouteCoordinates(coordinates, tolerance);
  while (simplified.length > 40 && tolerance < 10000) { tolerance *= 1.8; simplified = simplifyRouteCoordinates(coordinates, tolerance); }
  if (simplified.length > 40) simplified = Array.from({ length: 40 }, (_, index) => coordinates[Math.round(index * (coordinates.length - 1) / 39)]);
  return simplified.map(point => [point[0], point[1]]);
}

function shareRouteMetadata(route) {
  const annotations = window.getRouteAnnotations(route).map(item => ({ id: item.id, lat: Number(item.lat), lng: Number(item.lng), title: item.title || '', note: item.note || '' })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  return { n: getShareableRouteName(route), c: route.color, a: annotations };
}

function encodeRoutePayload(route) {
  const metadata = shareRouteMetadata(route);
  const routing = route && route.routing;
  const payload = routing && routing.provider === 'ors' && routing.profile === 'foot-hiking' && Array.isArray(routing.waypoints) && routing.waypoints.length >= 2
    ? { v: 2, t: 'ors', ...metadata, p: routing.profile, w: routing.waypoints }
    : { v: 2, t: 'free', ...metadata, g: encodePolyline(simplifyRouteCoordinates(getRouteLineCoordinates(route.geojson), 5)) };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeRoutePayload(encoded) {
  const json = decodeURIComponent(escape(atob(encoded)));
  return JSON.parse(json);
}

function validateSharedRoute(route) {
  if (!isPlainRouteObject(route)) return null;
  if (route.routing) {
    if (!isOrsRoutedRoute(route)) return null;
    const geometry = lineCoordinatesToGeojson(route.routing.waypoints);
    return validateBackupRoute({ ...route, geojson: geometry }) ? route : null;
  }
  return validateBackupRoute(route) ? route : null;
}

function getSharedRouteFromUrl() {
  const url = new URL(window.location.href);
  const routeParam = url.searchParams.get('route');
  if (!routeParam) return null;
  try {
    const payload = decodeRoutePayload(routeParam);
    if (payload && payload.v === 2) {
      if (payload.t === 'free') {
        const coordinates = decodePolyline(String(payload.g || ''));
        if (coordinates.length < 2) return null;
        return validateSharedRoute({ name: payload.n, color: payload.c, annotations: Array.isArray(payload.a) ? payload.a : [], geojson: lineCoordinatesToGeojson(coordinates) });
      }
      if (payload.t === 'ors' && payload.p === 'foot-hiking' && Array.isArray(payload.w) && payload.w.length >= 2 && payload.w.every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))) return validateSharedRoute({ name: payload.n, color: payload.c, annotations: Array.isArray(payload.a) ? payload.a : [], routing: { provider: 'ors', profile: 'foot-hiking', waypoints: payload.w } });
      return null;
    }
    return validateSharedRoute(payload); // Legacy payloads stored full GeoJSON.
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
  const safeName = String(routeName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    .filter(item => item.route && hasValidRouteCoordinates(item.route.geojson))
    .map(item => ({
      mode,
      index: item.index,
      route: item.route
    })));
}

function getRecordedWalkTimestamp(route, index) {
  const activity = route?.activity;
  const timestamp = Date.parse(activity?.endedAt || activity?.startedAt || '');
  return Number.isFinite(timestamp) ? timestamp : getRouteTimestamp(route, index);
}

function formatRecordedWalkDate(route) {
  const activity = route?.activity;
  const timestamp = Date.parse(activity?.endedAt || activity?.startedAt || '');
  return Number.isFinite(timestamp) ? formatRouteDate({ updatedAt: new Date(timestamp).toISOString() }) : formatRouteDate(route);
}

function formatRecordedWalkDuration(route) {
  const seconds = Number(route?.activity?.durationSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''}` : `${minutes}m`;
}

function routeLibrarySearchText(item) {
  const route = item.route;
  return [
    route.name,
    formatRouteDate(route),
    route.activity?.startedAt,
    route.activity?.endedAt,
    formatRecordedWalkDate(route),
    formatRecordedWalkDuration(route)
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function getVisibleRouteLibraryGroups(items = getRouteLibraryItems()) {
  const query = routeLibraryQuery.trim().toLocaleLowerCase();
  const visibleItems = items
    .filter(item => routeLibraryFilter === 'all' || item.mode === routeLibraryFilter)
  const itemsById = new Map(visibleItems.map(item => [item.route.id, item]));
  const childrenByParentId = new Map();
  const topLevel = [];

  visibleItems.forEach(item => {
    const parent = item.route.sourceRouteId && itemsById.get(item.route.sourceRouteId);
    if (parent) {
      const children = childrenByParentId.get(parent.route.id) || [];
      children.push(item);
      childrenByParentId.set(parent.route.id, children);
    } else {
      topLevel.push(item);
    }
  });

  const sortItems = (a, b) => {
      if (routeLibrarySort === 'name') {
        return String(a.route.name || '').localeCompare(String(b.route.name || ''), undefined, { sensitivity: 'base' });
      }
      const aRecent = Math.max(getRouteTimestamp(a.route, a.index), ...(childrenByParentId.get(a.route.id) || []).map(child => getRecordedWalkTimestamp(child.route, child.index)));
      const bRecent = Math.max(getRouteTimestamp(b.route, b.index), ...(childrenByParentId.get(b.route.id) || []).map(child => getRecordedWalkTimestamp(child.route, child.index)));
      return bRecent - aRecent;
    };

  return topLevel.sort(sortItems).map(parent => {
    const children = (childrenByParentId.get(parent.route.id) || []).sort((a, b) => getRecordedWalkTimestamp(b.route, b.index) - getRecordedWalkTimestamp(a.route, a.index));
    const parentMatches = !query || routeLibrarySearchText(parent).includes(query);
    const matchingChildren = children.filter(child => !query || routeLibrarySearchText(child).includes(query));
    if (!parentMatches && !matchingChildren.length) return null;
    return { parent, children, parentMatches, matchingChildren };
  }).filter(Boolean);
}

function formatLibraryDistance(km) {
  const value = Number(km);
  if (!Number.isFinite(value)) return '';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 })} km`;
}

function getComparableWalkPair(planned, walked) {
  if (!planned || !walked || planned.mode !== walked.mode ||
      walked.route.sourceRouteId !== planned.route.id ||
      !hasValidRouteCoordinates(planned.route.geojson) ||
      !hasValidRouteCoordinates(walked.route.geojson)) return null;
  return { mode: planned.mode, planned, walked };
}

function canCompareWalk(planned, walked) {
  return Boolean(getComparableWalkPair(planned, walked) && !navigation && !trackRecording);
}

function clearRouteComparison() {
  routeComparison = null;
  routeComparisonLayerUK.clearLayers();
  routeComparisonLayerWorld.clearLayers();
}

function formatComparisonDifference(plannedKm, walkedKm) {
  const difference = Number(walkedKm) - Number(plannedKm);
  if (!Number.isFinite(difference)) return '';
  const magnitude = Math.abs(difference);
  return `${difference >= 0 ? '+' : '-'}${magnitude.toLocaleString(undefined, { maximumFractionDigits: magnitude < 10 ? 1 : 0 })} km`;
}

function beginRouteComparison(planned, walked) {
  const pair = getComparableWalkPair(planned, walked);
  if (!pair || navigation || trackRecording) return;

  clearRouteComparison();
  clearSteepnessDisplay(pair.mode);
  getRouteLayer(pair.mode).clearLayers();
  (pair.mode === 'uk' ? window.routeNotesLayerUK : window.routeNotesLayerWorld).clearLayers();
  window.currentRouteIndex[pair.mode] = null;

  const comparisonLayer = getRouteComparisonLayer(pair.mode);
  const plannedColor = window.getRouteColor(pair.mode, pair.planned.route);
  // A light casing keeps the dark dashed walked line legible on every base map;
  // the dash pattern and drawer key make the distinction independent of colour.
  L.geoJSON(pair.planned.route.geojson, { style: { color: plannedColor, weight: 5, opacity: 1 } })
    .eachLayer(layer => comparisonLayer.addLayer(layer));
  L.geoJSON(pair.walked.route.geojson, { style: { color: '#ffffff', weight: 5, opacity: 0.9, interactive: false } })
    .eachLayer(layer => comparisonLayer.addLayer(layer));
  L.geoJSON(pair.walked.route.geojson, { style: { color: '#18212b', weight: 3, opacity: 1, dashArray: '8 7', lineCap: 'butt', interactive: false } })
    .eachLayer(layer => comparisonLayer.addLayer(layer));

  const bounds = comparisonLayer.getBounds();
  if (!bounds.isValid()) {
    clearRouteComparison();
    return;
  }
  routeComparison = { ...pair, layers: comparisonLayer };
  panelView = 'comparison';
  setRoutePanelOpen(true);
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    if (routeComparison?.planned === pair.planned) fitRouteBoundsToVisibleMap(pair.mode, bounds);
  }));
}

function endRouteComparison() {
  if (!routeComparison) return;
  clearRouteComparison();
  panelView = 'library';
  routePanelNotice = '';
  showRoutePanelContent();
  updateRouteFabLabel();
}

function openComparisonRoute(item) {
  clearRouteComparison();
  openRouteFromLibrary(item.mode, item.index);
}

function showRouteComparison() {
  const comparison = routeComparison;
  if (!comparison) {
    panelView = 'library';
    showRoutePanelContent();
    return;
  }
  const plannedMetrics = getRouteMetrics(comparison.planned.route);
  const walkedMetrics = getRouteMetrics(comparison.walked.route);
  const plannedDistance = formatLibraryDistance(plannedMetrics.km);
  const walkedDistance = formatLibraryDistance(walkedMetrics.km);
  const walkedDate = Date.parse(comparison.walked.route.activity?.endedAt || comparison.walked.route.activity?.startedAt || '');
  const walkedDateLabel = Number.isFinite(walkedDate) ? formatRecordedWalkDate(comparison.walked.route) : '';
  const walkedDuration = formatRecordedWalkDuration(comparison.walked.route);
  const difference = formatComparisonDifference(plannedMetrics.km, walkedMetrics.km);
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Compare planned route and walked track');
  panelContent.className = 'route-detail-content route-comparison-content';
  panelContent.innerHTML = `
    <div class="panel-heading workflow-heading route-comparison-heading">
      <div class="panel-eyebrow">Compare walk</div>
      <h2 class="route-title">Planned vs walked</h2>
    </div>
    <section class="route-comparison-summary" aria-label="Comparison summary">
      <div><span>Planned</span><strong>${escapeHtml(comparison.planned.route.name || 'Untitled route')}</strong><small>${escapeHtml(plannedDistance || 'Distance unavailable')}</small></div>
      <div><span>Walked${walkedDateLabel ? ` · ${escapeHtml(walkedDateLabel)}` : ''}</span><strong>${escapeHtml(walkedDistance || 'Distance unavailable')}${walkedDuration ? ` · ${escapeHtml(walkedDuration)}` : ''}</strong></div>
      ${difference ? `<div class="route-comparison-difference"><span>Distance difference</span><strong>${escapeHtml(difference)}</strong></div>` : ''}
    </section>
    <div class="route-comparison-key" aria-label="Map key"><span><i class="route-comparison-key-planned" aria-hidden="true"></i>Planned</span><span><i class="route-comparison-key-walked" aria-hidden="true"></i>Walked</span></div>
    <div class="route-actions-row route-comparison-actions">
      <button id="open-comparison-planned" class="panel-action" type="button">Open planned</button>
      <button id="open-comparison-walked" class="panel-action" type="button">Open walked</button>
      <button id="end-route-comparison" class="secondary-action" type="button">End comparison</button>
    </div>`;
  panelContent.querySelector('#open-comparison-planned').onclick = () => openComparisonRoute(comparison.planned);
  panelContent.querySelector('#open-comparison-walked').onclick = () => openComparisonRoute(comparison.walked);
  panelContent.querySelector('#end-route-comparison').onclick = endRouteComparison;
}

window.clearRouteComparison = clearRouteComparison;

function openRouteFromLibrary(mode, index) {
  clearRouteComparison();
  if ((window.currentMode || 'uk') !== mode && !window.switchMap(mode)) return;
  if (!window.loadRouteByIndex(mode, index)) return;
  if (mode === 'uk' && navigator.onLine === false) {
    const routeId = window.getRouteList('uk')[index]?.id;
    if (routeId) window.FieldMapsOfflineMaps.preferredRoutePack(routeId).then(pack => {
      if (!pack || window.currentRouteIndex.uk !== index || (window.currentMode || 'uk') !== 'uk') return;
      const chosen = { Road_27700: 'OS Road', Outdoor_27700: 'OS Outdoor', Leisure_27700: 'OS Leisure' }[pack.layer];
      const layer = ukBaseLayers[chosen];
      if (layer && !mapUK.hasLayer(layer)) {
        Object.values(ukBaseLayers).forEach(base => mapUK.removeLayer(base));
        layer.addTo(mapUK);
      }
    }).catch(() => { /* Offline pack metadata may be unavailable; route opening still works. */ });
  }
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
  scheduleRouteFitToVisibleMap(mode, true);
  updateRouteFabLabel();
}

function isMobileRouteLayout() {
  return isMobileDrawerLayout();
}

function isMobileDrawerLayout() {
  return window.matchMedia('(max-width: 600px)').matches;
}

function getAppropriateRoutePanelView() {
  if (routeComparison) return 'comparison';
  return getActiveRouteContext() ? 'details' : 'library';
}

function openRoutesPanel() {
  if (!drawingMode && !editingMode && !notePlacementMode && !noteDraft && !snapPreview && !sharedRouteImport) {
    const context = getActiveRouteContext();
    panelView = routePanelViewBeforeSettings === 'details' && context
      ? 'details'
      : getAppropriateRoutePanelView();
  }
  setRoutePanelOpen(true);
}

function openSettingsPanel() {
  clearRouteComparison();
  if (panelView === 'details' || panelView === 'library') {
    routePanelViewBeforeSettings = panelView;
  } else {
    routePanelViewBeforeSettings = getAppropriateRoutePanelView();
  }
  panelView = 'settings';
  routeBackupNotice = '';
  setRoutePanelOpen(true);
}

function getRouteFitOptions() {
  if (isMobileDrawerLayout()) {
    const panelHeight = panel.classList.contains('open')
      ? Math.ceil(panel.getBoundingClientRect().height)
      : 0;
    return {
      paddingTopLeft: [18, 20],
      paddingBottomRight: [18, panelHeight + 20]
    };
  }

  if (panel.classList.contains('open')) {
    const drawerRect = panel.getBoundingClientRect();
    const rightInset = Math.max(0, window.innerWidth - drawerRect.right);
    return {
      paddingTopLeft: [24, 24],
      paddingBottomRight: [Math.ceil(drawerRect.width + rightInset + 20), 24]
    };
  }

  return { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24] };
}

function updateDesktopMapControlOffset() {
  const drawerRect = panel.getBoundingClientRect();
  const drawerRightInset = Number.parseFloat(getComputedStyle(panel).right) || 0;
  const offset = !isMobileDrawerLayout() && panel.classList.contains('open')
    ? Math.ceil(drawerRect.width + drawerRightInset + 14)
    : 0;
  document.querySelectorAll('#map-uk, #map-world').forEach(mapContainer => {
    mapContainer.style.setProperty('--desktop-drawer-control-offset', `${offset}px`);
  });
}

function fitRouteBoundsToVisibleMap(mode, bounds) {
  if (!bounds || !bounds.isValid()) return;
  const map = mode === 'uk' ? mapUK : mapWorld;
  map.fitBounds(bounds, getRouteFitOptions());
}

function scheduleRouteFitToVisibleMap(mode, includeDesktop = false) {
  if (!isMobileDrawerLayout() && !includeDesktop) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const context = getActiveRouteContext();
    if (!context || context.mode !== mode || !panel.classList.contains('open')) return;
    const routeLayer = mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
    const bounds = routeLayer.getBounds();
    if (!bounds.isValid()) return;
    fitRouteBoundsToVisibleMap(mode, bounds);
  }));
}

window.isMobileRouteLayout = isMobileRouteLayout;
window.getRouteFitOptions = getRouteFitOptions;

function renderRouteLibraryResults(items = getRouteLibraryItems()) {
  const results = panelContent.querySelector('#route-library-results');
  const summary = panelContent.querySelector('#route-library-summary');
  if (!results || !summary) return;

  const groups = getVisibleRouteLibraryGroups(items);
  const total = items.length;
  const shownCount = groups.reduce((count, group) => count + 1 + (group.parentMatches ? group.children.length : group.matchingChildren.length), 0);
  summary.textContent = `${shownCount} ${shownCount === 1 ? 'route' : 'routes'} shown`;
  results.replaceChildren();

  if (!groups.length) {
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

  groups.forEach(group => {
    const { parent: item, children, parentMatches, matchingChildren } = group;
    const routeName = item.route.name || 'Untitled route';
    const metrics = getRouteMetrics(item.route);
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
    if (children.length) {
      const showOnlyMatches = !parentMatches && routeLibraryQuery.trim();
      const visibleChildren = showOnlyMatches ? matchingChildren : children;
      const expanded = expandedWalkHistoryRouteIds.has(item.route.id) || Boolean(showOnlyMatches);
      const history = document.createElement('div');
      history.className = `route-walk-history${expanded ? ' is-expanded' : ''}`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'route-walk-history-toggle';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML = `<span>${children.length} recorded ${children.length === 1 ? 'walk' : 'walks'}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>`;
      toggle.onclick = function() {
        if (expandedWalkHistoryRouteIds.has(item.route.id)) expandedWalkHistoryRouteIds.delete(item.route.id);
        else expandedWalkHistoryRouteIds.add(item.route.id);
        renderRouteLibraryResults();
      };
      history.appendChild(toggle);
      if (expanded) {
        const childList = document.createElement('ul');
        childList.className = 'route-walk-history-list';
        visibleChildren.forEach(child => {
          const childMetrics = getRouteMetrics(child.route);
          const childDistance = formatLibraryDistance(childMetrics.km);
          const childDate = formatRecordedWalkDate(child.route);
          const childDuration = formatRecordedWalkDuration(child.route);
          const childButton = document.createElement('button');
          childButton.type = 'button';
          childButton.className = 'route-walk-history-row';
          childButton.setAttribute('aria-label', `Open recorded walk${childDate ? ` from ${childDate}` : ''}`);
          childButton.innerHTML = `<span class="route-walk-history-icon" style="--route-color: ${escapeAttribute(window.getRouteColor(child.mode, child.route))}" aria-hidden="true"><i class="fa-solid fa-person-walking"></i></span><span class="route-walk-history-copy"><span class="route-walk-history-title">${escapeHtml(childDate || child.route.name || 'Recorded walk')}</span><span class="route-walk-history-meta">${[childDistance, childDuration].filter(Boolean).map(value => escapeHtml(value)).join(' <span aria-hidden="true">·</span>')}</span></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>`;
          childButton.onclick = function() { openRouteFromLibrary(child.mode, child.index); };
          const childItem = document.createElement('li');
          childItem.appendChild(childButton);
          if (canCompareWalk(item, child)) {
            const compareButton = document.createElement('button');
            compareButton.type = 'button';
            compareButton.className = 'route-walk-history-compare';
            compareButton.textContent = 'Compare';
            compareButton.setAttribute('aria-label', `Compare recorded walk with ${routeName}`);
            compareButton.onclick = function() { beginRouteComparison(item, child); };
            childItem.appendChild(compareButton);
          }
          childList.appendChild(childItem);
        });
        history.appendChild(childList);
      }
      listItem.appendChild(history);
    } else if (item.route.activity) {
      const recorded = document.createElement('span');
      recorded.className = 'route-recorded-label';
      recorded.textContent = 'Recorded';
      listItem.appendChild(recorded);
    }
    list.appendChild(listItem);
  });

  results.appendChild(list);
}

function getRouteBackupFilename() {
  return `field-maps-route-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

function exportRouteBackupFile() {
  const backup = window.exportRouteBackup();
  downloadTextFile(getRouteBackupFilename(), JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  routeBackupNotice = `Exported ${backup.routes.uk.length} UK / ${backup.routes.world.length} Worldwide routes.`;
  showRouteBackup();
}

async function readRouteBackupFile(file) {
  routeBackupCandidate = null;
  routeBackupNotice = '';
  if (!file) return;
  if (file.size > window.ROUTE_BACKUP_MAX_BYTES) {
    routeBackupNotice = 'This backup is too large to import.';
    showRouteBackup();
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const result = window.validateRouteBackup(parsed);
    if (!result.valid) throw new Error(result.error);
    routeBackupCandidate = result.backup;
    routeBackupNotice = `Ready to import ${result.backup.routes.uk.length} UK / ${result.backup.routes.world.length} Worldwide routes.`;
  } catch (error) {
    routeBackupNotice = error && error.message ? error.message : 'This backup could not be read.';
  }
  showRouteBackup();
}

function clearActiveRoutesAfterBackupImport() {
  clearRouteComparison();
  clearSteepnessDisplay('uk');
  clearSteepnessDisplay('world');
  window.currentRouteIndex.uk = null;
  window.currentRouteIndex.world = null;
  window.routeLayerUK.clearLayers();
  window.routeLayerWorld.clearLayers();
  window.routeNotesLayerUK.clearLayers();
  window.routeNotesLayerWorld.clearLayers();
  window.updateRouteListUI('uk');
  window.updateRouteListUI('world');
}

function importRouteBackup(strategy) {
  if (!routeBackupCandidate) return;
  if (strategy === 'replace' && !window.confirm('Replace your saved route library with this backup? Your current saved routes will be removed.')) return;
  const result = window.applyRouteBackup(routeBackupCandidate, strategy);
  if (!result.valid) {
    routeBackupNotice = result.error || 'The backup could not be imported.';
    showRouteBackup();
    return;
  }
  clearActiveRoutesAfterBackupImport();
  const counts = routeBackupCandidate.routes;
  routeBackupCandidate = null;
  routeBackupNotice = `${strategy === 'replace' ? 'Replaced' : 'Merged'} ${counts.uk.length} UK / ${counts.world.length} Worldwide routes.`;
  panelView = 'library';
  showRoutePanelContent();
}

function showRouteBackup() {
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', 'Data and storage');
  panelContent.className = 'route-detail-content route-backup-content';
  const preview = routeBackupCandidate ? `${routeBackupCandidate.routes.uk.length} UK routes / ${routeBackupCandidate.routes.world.length} Worldwide routes` : '';
  panelContent.innerHTML = `
    <div class="panel-navigation">
      <button id="back-to-settings-from-backup" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Settings</button>
    </div>
    <div class="panel-heading workflow-heading">
      <div class="panel-eyebrow">Settings</div>
      <h2 class="route-title">Data &amp; storage</h2>
      <p class="panel-hint">Export only saved routes, or restore routes from a Field Maps backup file.</p>
    </div>
    <section class="route-backup-section" aria-labelledby="export-route-backup-title">
      <h3 id="export-route-backup-title">Export route backup</h3>
      <p>Download all UK and Worldwide saved routes as a portable JSON file.</p>
      <button id="export-route-backup" class="secondary-action" type="button"><i class="fa-solid fa-download" aria-hidden="true"></i> Export route backup</button>
    </section>
    <section class="route-backup-section" aria-labelledby="import-route-backup-title">
      <h3 id="import-route-backup-title">Import route backup</h3>
      <p>Choose a Field Maps backup file to check it before changing your saved routes.</p>
      <input id="route-backup-file" class="sr-only" type="file" accept="application/json,.json">
      <button id="choose-route-backup" class="secondary-action" type="button"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Choose backup file</button>
      ${preview ? `<div class="route-backup-preview"><strong>${escapeHtml(preview)}</strong><span>Choose how to add these routes.</span></div>
        <div class="route-actions-row route-backup-actions">
          <button id="merge-route-backup" class="primary-action" type="button">Merge with existing</button>
          <button id="replace-route-backup" class="panel-action danger-action" type="button">Replace library</button>
        </div>` : ''}
    </section>
    <section class="route-backup-section" aria-labelledby="app-storage-title">
      <h3 id="app-storage-title">App / storage</h3>
      <p>App files can be checked or refreshed without changing your saved routes.</p>
      <div class="app-build-version">Build <strong id="app-build-version">Checking…</strong></div>
      <div class="route-actions-row route-backup-actions">
        <button id="check-app-updates" class="secondary-action" type="button">Check for updates</button>
        <button id="refresh-app-files" class="secondary-action" type="button">Refresh app files</button>
      </div>
      <p id="app-storage-notice" class="route-backup-notice" role="status"></p>
    </section>
    ${routeBackupNotice ? `<p class="route-backup-notice" role="status">${escapeHtml(routeBackupNotice)}</p>` : ''}`;
  panelContent.querySelector('#back-to-settings-from-backup').onclick = function() {
    panelView = 'settings';
    showRoutePanelContent();
  };
  panelContent.querySelector('#export-route-backup').onclick = exportRouteBackupFile;
  const fileInput = panelContent.querySelector('#route-backup-file');
  panelContent.querySelector('#choose-route-backup').onclick = () => fileInput.click();
  fileInput.onchange = function() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    readRouteBackupFile(file);
  };
  const merge = panelContent.querySelector('#merge-route-backup');
  if (merge) merge.onclick = () => importRouteBackup('merge');
  const replace = panelContent.querySelector('#replace-route-backup');
  if (replace) replace.onclick = () => importRouteBackup('replace');
  const buildVersion = panelContent.querySelector('#app-build-version');
  const appStorageNotice = panelContent.querySelector('#app-storage-notice');
  const checkUpdates = panelContent.querySelector('#check-app-updates');
  const refreshFiles = panelContent.querySelector('#refresh-app-files');
  if (!window.FieldMapsPwa?.supported()) {
    buildVersion.textContent = 'Service worker unavailable';
    checkUpdates.disabled = true;
    refreshFiles.disabled = true;
  } else {
    window.FieldMapsPwa.getBuildInfo().then((info) => {
      buildVersion.textContent = info.label;
    });
    checkUpdates.onclick = async function() {
      checkUpdates.disabled = true;
      appStorageNotice.textContent = 'Checking for updates…';
      try {
        appStorageNotice.textContent = await window.FieldMapsPwa.checkForUpdates();
      } catch (error) {
        appStorageNotice.textContent = 'Could not check for updates.';
      }
      checkUpdates.disabled = false;
    };
    refreshFiles.onclick = async function() {
      refreshFiles.disabled = true;
      appStorageNotice.textContent = 'Refreshing app files…';
      try {
        await window.FieldMapsPwa.refreshAppFiles();
      } catch (error) {
        appStorageNotice.textContent = 'Could not refresh app files. Existing offline files were kept; connect and try again.';
        refreshFiles.disabled = false;
      }
    };
  }
}

function resetRouteNameKeyboardLayout() {
  panel.classList.remove('route-name-keyboard-visible');
  panel.style.removeProperty('--keyboard-panel-offset');
  panel.style.removeProperty('--keyboard-visible-height');
}

function keepRouteNameVisible() {
  const input = panelContent.querySelector('#route-name-input');
  if (!input || document.activeElement !== input) {
    resetRouteNameKeyboardLayout();
    return;
  }
  const touchViewport = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const viewport = window.visualViewport;
  if (!touchViewport || !viewport) return;
  const form = panelContent.querySelector('#rename-route-form');
  const actionRow = form?.querySelector('.route-actions-row');
  const inputBounds = input.getBoundingClientRect();
  const visibleBottom = viewport.offsetTop + viewport.height - 16;
  const keyboardInset = Math.max(0, Math.ceil(window.innerHeight - (viewport.offsetTop + viewport.height)));
  const actionBottom = actionRow?.getBoundingClientRect().bottom || inputBounds.bottom;
  const needsKeyboardLayout = keyboardInset > 0 || actionBottom > visibleBottom;
  if (needsKeyboardLayout) {
    panel.style.setProperty('--keyboard-panel-offset', `${keyboardInset}px`);
    panel.style.setProperty('--keyboard-visible-height', `${Math.max(180, Math.floor(viewport.height - viewport.offsetTop - 8))}px`);
    panel.classList.add('route-name-keyboard-visible');
    window.requestAnimationFrame(() => {
      const row = form?.querySelector('.route-actions-row');
      const rowBottom = row?.getBoundingClientRect().bottom || input.getBoundingClientRect().bottom;
      if (rowBottom > visibleBottom) panelContent.scrollTop += rowBottom - visibleBottom;
      input.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  } else {
    resetRouteNameKeyboardLayout();
  }
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', keepRouteNameVisible);
  window.visualViewport.addEventListener('scroll', keepRouteNameVisible);
}

function showSettings() {
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', 'Settings and tools');
  panelContent.className = 'route-detail-content route-backup-content settings-content';
  panelContent.innerHTML = `
    <div class="panel-heading workflow-heading">
      <div class="panel-eyebrow">Field Maps</div>
      <h2 class="route-title">Settings &amp; tools</h2>
      <p class="panel-hint">Map tools, route data, and app-file controls.</p>
    </div>
    <section class="route-backup-section" aria-labelledby="settings-tools-title">
      <h3 id="settings-tools-title">Map &amp; tools</h3>
      <p>Measure distance or area on the current map.</p>
      <button id="open-measure-tool" class="secondary-action" type="button"><i class="fa-solid fa-ruler" aria-hidden="true"></i> Measure</button>
    </section>
    <section class="route-backup-section" aria-labelledby="settings-data-title">
      <h3 id="settings-data-title">Data &amp; storage</h3>
      <p>Export, validate, restore, merge, or replace saved route backups.</p>
      <button id="open-data-storage" class="secondary-action" type="button"><i class="fa-solid fa-database" aria-hidden="true"></i> Route backup &amp; storage</button>
    </section>
    <section class="route-backup-section" aria-labelledby="settings-offline-title">
      <h3 id="settings-offline-title">Offline maps</h3>
      <p>Download the visible UK area, or manage stored maps.</p>
      <button id="open-offline-maps" class="secondary-action" type="button">View offline maps</button>
    </section>
    ${window.FieldMapsPwa?.canInstall() ? `<section class="route-backup-section" aria-labelledby="settings-install-title">
      <h3 id="settings-install-title">Install Field Maps</h3>
      <p>Install this app on your device.</p>
      <button id="settings-install-app" class="secondary-action" type="button">Install</button>
    </section>` : ''}`;
  panelContent.querySelector('#open-measure-tool').onclick = function() {
    setRoutePanelOpen(false);
    window.openMeasureTool?.();
  };
  panelContent.querySelector('#open-data-storage').onclick = function() {
    panelView = 'backup';
    routeBackupNotice = '';
    showRoutePanelContent();
  };
  panelContent.querySelector('#open-offline-maps').onclick = function() {
    panelView = 'offline';
    showRoutePanelContent();
  };
  const settingsInstall = panelContent.querySelector('#settings-install-app');
  if (settingsInstall) settingsInstall.onclick = () => window.FieldMapsPwa.promptInstall();
}

window.addEventListener('fieldmapsinstallchange', () => {
  if (panelView === 'settings' && panel.classList.contains('open')) showSettings();
});

function startRouteDrawing() {
  clearRouteComparison();
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
  pathDraft?.controller?.abort();
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

function cloneRouteData(value) {
  return JSON.parse(JSON.stringify(value));
}

function isOrsRoutedRoute(route) {
  const routing = route?.routing;
  return routing?.provider === 'ors' && routing.profile === 'foot-hiking' &&
    Array.isArray(routing.waypoints) && routing.waypoints.length >= 2;
}

function renderRoutedEditMarkers() {
  if (!routedEdit) return;
  const layer = getDraftLayer(routedEdit.mode);
  layer.clearLayers();
  routedEdit.waypoints.forEach(function(waypoint, index) {
    const marker = L.marker([waypoint[1], waypoint[0]], {
      draggable: !routedEdit.waiting,
      icon: L.divIcon({
        className: `route-waypoint-marker${routedEdit.selectedIndex === index ? ' is-selected' : ''}`,
        html: `<span>${index + 1}</span>`, iconSize: [32, 32], iconAnchor: [16, 16]
      })
    });
    marker.on('click', function() {
      if (routedEdit?.waiting) return;
      routedEdit.selectedIndex = index;
      renderRoutedEditMarkers();
      showRoutePanelContent();
    });
    marker.on('dragend', function() {
      if (!routedEdit || routedEdit.waiting) return;
      const point = marker.getLatLng();
      const next = routedEdit.waypoints.map(item => item.slice());
      next[index] = [point.lng, point.lat];
      rerouteRoutedEdit(next);
    });
    layer.addLayer(marker);
  });
}

function renderActiveRouteGeometry(mode, route) {
  const routeLayer = getRouteLayer(mode);
  routeLayer.clearLayers();
  const layer = L.geoJSON(route.geojson, { style: window.getRouteStyle(mode, route) });
  layer.eachLayer(item => routeLayer.addLayer(item));
  renderRouteAnnotations(mode, route);
}

function startRoutedEdit(context) {
  if (!isOrsRoutedRoute(context.route)) return false;
  routedEdit = {
    mode: context.mode, index: context.index,
    original: cloneRouteData(context.route),
    originalDisplayMode: routeDisplayMode[context.mode],
    waypoints: cloneRouteData(context.route.routing.waypoints),
    requestId: 0, waiting: false, error: '', selectedIndex: null, adding: false
  };
  clearSteepnessDisplay(context.mode);
  editingMode = true;
  drawingMode = false;
  renderRoutedEditMarkers();
  return true;
}

function finishRoutedEdit(cancelled) {
  if (!routedEdit) return;
  const edit = routedEdit;
  edit.requestId++;
  edit.controller?.abort();
  if (cancelled) {
    const routes = window.getRouteList(edit.mode);
    if (routes[edit.index]) {
      routes[edit.index] = cloneRouteData(edit.original);
      localStorage.setItem(`routeList_${edit.mode}`, JSON.stringify(routes));
      renderActiveRouteGeometry(edit.mode, routes[edit.index]);
      if (edit.originalDisplayMode === 'steepness') showSteepnessDisplay(edit.mode, routes[edit.index]);
      if (edit.originalDisplayMode === 'elevation') showElevationDisplay(edit.mode, routes[edit.index]);
    }
  }
  getDraftLayer(edit.mode).clearLayers();
  routedEdit = null;
  editingMode = false;
  panelView = 'details';
  routePanelNotice = cancelled ? 'Route changes discarded.' : 'Route changes saved.';
  showRoutePanelContent();
  updateRouteFabLabel();
}

async function rerouteRoutedEdit(nextWaypoints) {
  if (!routedEdit || routedEdit.waiting || nextWaypoints.length < 2) return;
  const edit = routedEdit;
  const requestId = ++edit.requestId;
  edit.controller = new AbortController();
  edit.waiting = true;
  edit.error = '';
  edit.adding = false;
  showRoutePanelContent();
  try {
    const geojson = await requestOrsFootHikingRoute(nextWaypoints, edit.controller);
    if (!routedEdit || routedEdit !== edit || requestId !== edit.requestId) return;
    const routing = { provider: 'ors', profile: 'foot-hiking', waypoints: cloneRouteData(nextWaypoints) };
    if (!window.replaceRouteGeometryInList(edit.mode, edit.index, geojson, routing)) throw new Error('Route unavailable');
    edit.waypoints = cloneRouteData(nextWaypoints);
    edit.selectedIndex = null;
    renderActiveRouteGeometry(edit.mode, window.getRouteList(edit.mode)[edit.index]);
    renderRoutedEditMarkers();
  } catch (error) {
    if (!routedEdit || routedEdit !== edit || requestId !== edit.requestId) return;
    // Do not retain an unaccepted control position after a failed request.
    edit.error = 'Could not update this walking route. The last valid route is still shown.';
    renderRoutedEditMarkers();
  } finally {
    if (routedEdit === edit && requestId === edit.requestId) {
      edit.waiting = false;
      renderRoutedEditMarkers();
      showRoutePanelContent();
    }
  }
}

function getRouteInsertionIndex(geojson, point) {
  const coordinates = getRouteLineCoordinates(geojson);
  if (coordinates.length < 2) return 1;
  let bestSegment = 0, bestDistance = Infinity;
  for (let index = 0; index < coordinates.length - 1; index++) {
    const [ax, ay] = coordinates[index], [bx, by] = coordinates[index + 1];
    const dx = bx - ax, dy = by - ay;
    const factor = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const px = ax + factor * dx, py = ay + factor * dy;
    const distance = (point[0] - px) ** 2 + (point[1] - py) ** 2;
    if (distance < bestDistance) { bestDistance = distance; bestSegment = index; }
  }
  const total = coordinates.length - 1;
  const along = bestSegment / total;
  // Project controls onto the same ordered detailed geometry, then insert after
  // the last control occurring before the selected route position.
  const controlPositions = routedEdit.waypoints.map(control => {
    let nearest = 0, distance = Infinity;
    coordinates.forEach((coordinate, index) => {
      const value = (control[0] - coordinate[0]) ** 2 + (control[1] - coordinate[1]) ** 2;
      if (value < distance) { distance = value; nearest = index; }
    });
    return nearest / total;
  });
  return Math.max(0, Math.min(routedEdit.waypoints.length, controlPositions.filter(value => value <= along).length));
}

function handleRoutedEditClick(mode, event) {
  if (!routedEdit || routedEdit.mode !== mode || !routedEdit.adding || routedEdit.waiting) return;
  const route = window.getRouteList(mode)[routedEdit.index];
  if (!route) return;
  const point = [event.latlng.lng, event.latlng.lat];
  const next = routedEdit.waypoints.map(item => item.slice());
  next.splice(getRouteInsertionIndex(route.geojson, point), 0, point);
  rerouteRoutedEdit(next);
}

async function requestPathRoute() {
  if (!pathDraft || pathDraft.waypoints.length < 2) return;
  if (!CONFIG.orsApiKey) {
    pathDraft.error = 'Path routing is unavailable because the ORS key is missing.';
    showRoutePanelContent();
    return;
  }
  const draft = pathDraft;
  const requestId = ++draft.requestId;
  draft.controller?.abort();
  draft.controller = new AbortController();
  pathDraft.waiting = true;
  pathDraft.error = '';
  showRoutePanelContent();
  try {
    const geojson = await requestOrsFootHikingRoute(draft.waypoints, draft.controller);
    if (pathDraft !== draft || requestId !== draft.requestId) return;
    pathDraft.geojson = geojson;
    pathDraft.error = '';
    renderPathDraft();
  } catch (error) {
    if (pathDraft !== draft || requestId !== draft.requestId) return;
    pathDraft.error = pathDraft.kind === 'snap' ? 'Could not convert this route to walking paths. Your original route is unchanged; try again later.' : 'Could not follow paths. Your waypoints are still available; try again or add another point.';
  } finally {
    if (pathDraft === draft && requestId === draft.requestId) {
      pathDraft.waiting = false;
      showRoutePanelContent();
    }
  }
}

async function requestOrsFootHikingRoute(waypoints, controller = new AbortController()) {
  if (!CONFIG.orsApiKey) throw new Error('Path routing is unavailable because the ORS key is missing.');
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://api.heigit.org/openrouteservice/v2/directions/foot-hiking/geojson', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: CONFIG.orsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: waypoints })
    });
    if (!response.ok) throw new Error('Routing request failed');
    const geojson = await response.json();
    if (!hasValidRouteCoordinates(geojson)) throw new Error('No valid route returned');
    return geojson;
  } finally { window.clearTimeout(timeout); }
}

function startSnapRoute(context) {
  const waypoints = getRoutingWaypoints(context.route.geojson);
  if (waypoints.length < 2) {
    routePanelNotice = 'This route needs at least two points before it can follow paths.';
    showRoutePanelContent();
    return;
  }
  clearPathDraft();
  pathDraft = { mode: context.mode, kind: 'snap', waypoints, geojson: null, requestId: 0, waiting: false, error: '' };
  snapPreview = { mode: context.mode, index: context.index, originalGeojson: context.route.geojson, originalRouting: context.route.routing, sourcePoints: getRouteLineCoordinates(context.route.geojson).length, waypointCount: waypoints.length };
  requestPathRoute();
}

function cancelSnapRoute() {
  clearPathDraft();
  snapPreview = null;
  routePanelNotice = 'Original route kept.';
  showRoutePanelContent();
}

function applySnapRoute() {
  if (!snapPreview || !pathDraft || !pathDraft.geojson) return;
  const context = getActiveRouteContext();
  if (!context || context.mode !== snapPreview.mode || context.index !== snapPreview.index) return cancelSnapRoute();
  const routing = { provider: 'ors', profile: 'foot-hiking', waypoints: pathDraft.waypoints.slice() };
  if (!window.replaceRouteGeometryInList(context.mode, context.index, pathDraft.geojson, routing)) return;
  const route = window.getRouteList(context.mode)[context.index];
  clearSteepnessDisplay(context.mode);
  const routeLayer = context.mode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
  routeLayer.clearLayers();
  const layer = L.geoJSON(route.geojson, { style: window.getRouteStyle(context.mode, route) });
  layer.eachLayer(item => routeLayer.addLayer(item));
  clearPathDraft();
  snapPreview = null;
  renderRouteAnnotations(context.mode, route);
  routePanelNotice = 'Walking-path route applied.';
  showRoutePanelContent();
}

function showSnapPreview() {
  const ready = Boolean(pathDraft && pathDraft.geojson && !pathDraft.waiting);
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', 'Preview walking-path route');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `
    <div class="panel-heading workflow-heading">
      <div class="panel-eyebrow">Convert to walking paths</div>
      <h2 class="route-title">Preview snapped route</h2>
      <p class="panel-hint">Your original line is unchanged. This preview follows walking paths using ${snapPreview.waypointCount} shape points${snapPreview.sourcePoints ? ` from ${snapPreview.sourcePoints} drawn points` : ''}.</p>
    </div>
    <div class="workflow-tip"><span>1</span>${pathDraft?.waiting ? 'Finding walking paths…' : ready ? 'Review the orange preview on the map' : 'Route preview unavailable'}</div>
    ${pathDraft?.error ? `<p class="route-workflow-error" role="alert">${escapeHtml(pathDraft.error)}</p>` : ''}
    <div class="route-actions-row">
      <button id="apply-snapped-route" class="primary-action primary-action-wide" type="button" ${ready ? '' : 'disabled'}><i class="fa-solid fa-check" aria-hidden="true"></i><span>Apply snapped route</span></button>
      <button id="cancel-snapped-route" class="panel-action" type="button">Cancel</button>
    </div>`;
  panelContent.querySelector('#apply-snapped-route').onclick = applySnapRoute;
  panelContent.querySelector('#cancel-snapped-route').onclick = cancelSnapRoute;
}

function handlePathClick(mode, event) {
  if (!drawingMode || routeCreationMode !== 'paths' || !pathDraft || pathDraft.mode !== mode || pathDraft.waiting) return;
  pathDraft.waypoints.push([event.latlng.lng, event.latlng.lat]);
  pathDraft.geojson = null;
  pathDraft.error = '';
  renderPathDraft();
  if (pathDraft.waypoints.length > 1) requestPathRoute();
  else showRoutePanelContent();
}

function undoPathWaypoint() {
  if (!pathDraft || pathDraft.waiting || !pathDraft.waypoints.length) return;
  pathDraft.waypoints.pop();
  pathDraft.error = '';
  pathDraft.geojson = null;
  renderPathDraft();
  if (pathDraft.waypoints.length >= 2) requestPathRoute();
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
  panelContent.querySelector('#add-route-panel').onclick = openRouteCreationOptions;
  renderRouteLibraryResults(items);
}

function openRouteCreationOptions() {
  clearRouteComparison();
  if (navigation || trackRecording || trackSummary) {
    routePanelNotice = 'Finish, save, or discard the active recording before creating another route.';
    showRoutePanelContent();
    return;
  }
  panelView = 'create-route';
  showRoutePanelContent();
}

function showRouteCreationOptions() {
  const mode = window.currentMode || 'uk';
  panel.classList.remove('library-view', 'library-scroll-view');
  panel.setAttribute('aria-label', 'Create a route');
  panelContent.className = 'route-detail-content';
  panelContent.innerHTML = `<div class="panel-navigation"><button id="back-to-library-from-create" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Saved routes</button></div><div class="panel-heading workflow-heading"><div class="panel-eyebrow">New ${getModeLabel(mode)} route</div><h2 class="route-title">Create a route</h2><p class="panel-hint">Choose whether to plan a route on the map or record a walk as you go.</p></div><div class="route-creation-options"><button id="create-planned-route" class="secondary-action" type="button"><i class="fa-solid fa-pen-ruler" aria-hidden="true"></i><span><strong>Plan a route</strong><small>Follow paths or draw freely</small></span></button><button id="create-tracked-route" class="primary-action" type="button"><i class="fa-solid fa-person-walking" aria-hidden="true"></i><span><strong>Track my route</strong><small>Record a walk from GPS</small></span></button></div>`;
  panelContent.querySelector('#back-to-library-from-create').onclick = () => { panelView = 'library'; showRoutePanelContent(); };
  panelContent.querySelector('#create-planned-route').onclick = startRouteDrawing;
  panelContent.querySelector('#create-tracked-route').onclick = () => { panelView = 'track-prestart'; showRoutePanelContent(); };
}

function showRouteWorkflow() {
  const mode = window.currentMode || 'uk';
  const context = getActiveRouteContext();
  panel.classList.remove('library-view');
  panel.classList.remove('library-scroll-view');
  panel.setAttribute('aria-label', drawingMode ? 'Draw route' : 'Edit route');
  panelContent.className = 'route-detail-content';
  const isRoutedEdit = Boolean(!drawingMode && routedEdit);
  panelContent.innerHTML = `
    <div class="panel-heading workflow-heading">
      <div class="panel-eyebrow">${drawingMode ? `New ${getModeLabel(mode)} route` : 'Editing route'}</div>
      <h2 class="route-title">${drawingMode ? (routeCreationMode === 'paths' ? 'Follow paths' : 'Draw your route') : `Edit ${escapeHtml(context?.route.name || 'route')}`}</h2>
      <p class="panel-hint">${drawingMode ? (routeCreationMode === 'paths' ? 'Tap control waypoints on the map. The route follows hiking paths between them.' : 'Tap the map to add points. Use the map while this sheet stays open.') : isRoutedEdit ? 'Numbered points control the generated walking route. Drag a point, or select one to remove it.' : 'Move route points on the map, then save or discard your changes.'}</p>
    </div>
    ${drawingMode ? `<div class="route-creation-mode" role="group" aria-label="Route creation mode">
      <button id="follow-paths-mode" class="${routeCreationMode === 'paths' ? 'selected' : ''}" type="button" aria-pressed="${routeCreationMode === 'paths'}">Follow paths</button>
      <button id="draw-freely-mode" class="${routeCreationMode === 'free' ? 'selected' : ''}" type="button" aria-pressed="${routeCreationMode === 'free'}">Draw freely</button>
    </div>` : ''}
    <div class="workflow-tip"><span>1</span>${drawingMode ? (routeCreationMode === 'paths' ? `${pathDraft?.waypoints.length || 0} waypoint${(pathDraft?.waypoints.length || 0) === 1 ? '' : 's'}${pathDraft?.waiting ? ' · Finding paths…' : ''}` : 'Add at least two points on the map') : isRoutedEdit ? `${routedEdit.waypoints.length} control waypoint${routedEdit.waypoints.length === 1 ? '' : 's'}${routedEdit.waiting ? ' · Finding paths…' : routedEdit.adding ? ' · Tap the route or map to add a point' : ''}` : 'Drag any point to adjust the route'}</div>
    ${drawingMode && routeCreationMode === 'paths' && pathDraft?.error ? `<p class="route-workflow-error" role="alert">${escapeHtml(pathDraft.error)}</p>` : ''}
    ${isRoutedEdit && routedEdit.error ? `<p class="route-workflow-error" role="alert">${escapeHtml(routedEdit.error)}</p>` : ''}
    ${drawingMode && routeCreationMode === 'paths' && pathDraft?.waypoints.length ? '<button id="undo-path-waypoint" class="panel-action route-workflow-action" type="button">Undo last point</button>' : ''}
    ${isRoutedEdit ? `<div class="route-actions-row route-routed-edit-actions">
      <button id="add-routed-waypoint" class="panel-action" type="button" ${routedEdit.waiting ? 'disabled' : ''}>Add waypoint</button>
      <button id="delete-routed-waypoint" class="panel-action" type="button" ${routedEdit.selectedIndex == null || routedEdit.waiting || routedEdit.waypoints.length <= 2 ? 'disabled' : ''}>Remove selected</button>
    </div>` : ''}
    <div class="route-actions-row">
      <button id="${drawingMode ? 'save-route-panel' : 'save-edit-route-panel'}" class="primary-action primary-action-wide" type="button">
        <i class="fa-solid fa-check" aria-hidden="true"></i><span>${drawingMode ? 'Finish route' : 'Done'}</span>
      </button>
      <button id="cancel-route-workflow" class="panel-action" type="button">Cancel</button>
    </div>`;

  if (drawingMode) {
    panelContent.querySelector('#follow-paths-mode').onclick = function() { setRouteCreationMode('paths'); };
    panelContent.querySelector('#draw-freely-mode').onclick = function() { setRouteCreationMode('free'); };
  }
  const undoButton = panelContent.querySelector('#undo-path-waypoint');
  if (undoButton) undoButton.onclick = undoPathWaypoint;
  const addWaypointButton = panelContent.querySelector('#add-routed-waypoint');
  if (addWaypointButton) addWaypointButton.onclick = function() {
    if (!routedEdit || routedEdit.waiting) return;
    routedEdit.adding = !routedEdit.adding;
    routedEdit.selectedIndex = null;
    renderRoutedEditMarkers();
    showRoutePanelContent();
  };
  const deleteWaypointButton = panelContent.querySelector('#delete-routed-waypoint');
  if (deleteWaypointButton) deleteWaypointButton.onclick = function() {
    if (!routedEdit || routedEdit.waiting || routedEdit.selectedIndex == null || routedEdit.waypoints.length <= 2) return;
    const next = routedEdit.waypoints.map(item => item.slice());
    next.splice(routedEdit.selectedIndex, 1);
    rerouteRoutedEdit(next);
  };
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
    } else if (routedEdit) {
      if (!routedEdit.waiting) finishRoutedEdit(false);
    } else if (editingMode && activeDrawControl._toolbars?.edit) {
      const handler = activeDrawControl._toolbars.edit._modes.edit.handler;
      handler.save();
      handler.disable();
    }
  };

  panelContent.querySelector('#cancel-route-workflow').onclick = function() {
    if (routedEdit) {
      finishRoutedEdit(true);
      return;
    }
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
      if (shareUrl.length > 8000) {
        if (shareStatus) shareStatus.textContent = 'This free-drawn route is too large to share reliably. Export GPX or GeoJSON instead.';
        return;
      }
      const title = currentRoute.name || 'Route';
      const text = `Route from Field Maps${currentRoute.name ? `: ${currentRoute.name}` : ''}`;
      let message = 'Share link copied.';
      try {
        if (navigator.share) {
          await navigator.share({ title, text, url: shareUrl });
          message = 'Route shared.';
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
        } else {
          prompt('Copy this link to share:', shareUrl);
          message = 'Share link ready.';
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
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
  const elevationSummary = getRouteElevationSummary(currentRoute);
  const isElevationRequesting = elevationRequesting === `${context.mode}:${context.index}`;
  const annotations = window.getRouteAnnotations(currentRoute);
  const selectedAnnotation = selectedAnnotationId && getAnnotationById(currentRoute, selectedAnnotationId);
  if (selectedAnnotation) {
    showNoteDetails(context, selectedAnnotation);
    return;
  }
  const { km, mi, timeStr, usesAscent } = getRouteMetrics(currentRoute);
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
      ${timeStr ? `<span class="metric-pill" title="Estimated walking time${usesAscent ? ', including ascent' : ''}" aria-label="Estimated walking time: ${timeStr}${usesAscent ? ', including ascent' : ''}"><i class="fa-solid fa-stopwatch" aria-hidden="true"></i><strong>${timeStr}</strong>${usesAscent ? '<i class="fa-solid fa-mountain metric-ascent-indicator" aria-hidden="true"></i>' : ''}</span>` : ''}
    </div>
    ${routePanelNotice ? `<div class="panel-notice" role="status">${escapeHtml(routePanelNotice)}</div>` : ''}
    <div class="route-actions-row active-route-actions">
      <button id="walk-route-panel" class="primary-action primary-action-wide" type="button"><i class="fa-solid fa-person-walking" aria-hidden="true"></i><span>Walk this route</span></button>
      <button id="edit-route-panel" class="panel-action" type="button"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Edit route</span></button>
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
    <details class="route-disclosure route-elevation"${elevationDisclosureOpen || isElevationRequesting ? ' open' : ''}>
      <summary><span><i class="fa-solid fa-mountain" aria-hidden="true"></i> Elevation</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
      <div class="route-disclosure-body">
        ${elevationSummary ? `<div class="elevation-stats" aria-label="Elevation statistics">
          <span><small>Ascent</small><strong>${elevationSummary.ascent} m</strong></span>
          <span><small>Descent</small><strong>${elevationSummary.descent} m</strong></span>
          <span><small>Minimum</small><strong>${elevationSummary.min} m</strong></span>
          <span><small>Maximum</small><strong>${elevationSummary.max} m</strong></span>
        </div>
        ${timeStr ? `<p class="elevation-walking-time">Estimated walking time: <strong>${timeStr}</strong></p>` : ''}
        ${getRouteElevationSamples(currentRoute).length ? buildElevationProfile(getRouteElevationSamples(currentRoute)).markup : '<p class="route-disclosure-empty">Elevation samples are unavailable for this route.</p>'}
        <button id="refresh-elevation-panel" class="panel-action route-disclosure-action" type="button"><i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh elevation</span></button>` : `<p class="route-disclosure-empty">${isElevationRequesting ? 'Getting elevation…' : 'Get route ascent, descent, and elevation range.'}</p>
        <button id="get-elevation-panel" class="panel-action route-disclosure-action" type="button"${isElevationRequesting ? ' disabled' : ''}><i class="fa-solid fa-mountain" aria-hidden="true"></i><span>${isElevationRequesting ? 'Getting elevation…' : 'Get elevation'}</span></button>`}
      </div>
    </details>
    <details class="route-disclosure route-customisation">
      <summary><span><i class="fa-solid fa-palette" aria-hidden="true"></i> Appearance</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
      <div class="route-disclosure-body">
        <div class="route-display-control" role="radiogroup" aria-label="Route display mode">
          <span class="route-color-label">Route display</span>
          <div class="route-display-options">
            <button type="button" class="route-display-option${routeDisplayMode[context.mode] === 'solid' ? ' is-selected' : ''}" data-route-display="solid" role="radio" aria-checked="${routeDisplayMode[context.mode] === 'solid'}">Solid colour</button>
            <button type="button" class="route-display-option${routeDisplayMode[context.mode] === 'steepness' ? ' is-selected' : ''}" data-route-display="steepness" role="radio" aria-checked="${routeDisplayMode[context.mode] === 'steepness'}"${getRouteElevationSamples(currentRoute).length >= 2 ? '' : ' disabled'}>Steepness</button>
            <button type="button" class="route-display-option${routeDisplayMode[context.mode] === 'elevation' ? ' is-selected' : ''}" data-route-display="elevation" role="radio" aria-checked="${routeDisplayMode[context.mode] === 'elevation'}"${getRouteElevationSamples(currentRoute).length >= 2 ? '' : ' disabled'}>Elevation</button>
          </div>
        </div>
        ${routeDisplayMode[context.mode] === 'steepness' ? `<div class="steepness-legend" role="img" aria-label="Steepness colour legend: strong descent at 10 percent or steeper, moderate descent 5 to 10 percent, gentle descent 2 to 5 percent, approximately flat within 2 percent, gentle ascent 2 to 5 percent, moderate ascent 5 to 10 percent, and strong ascent at 10 percent or steeper.">
          <div class="steepness-legend-labels"><span>Strong descent <i aria-hidden="true">←</i></span><span><i aria-hidden="true">→</i> Strong ascent</span></div>
          <div class="steepness-legend-bar" aria-hidden="true">${STEEPNESS_BANDS.map(band => `<i style="--steepness-colour: ${band.color}"></i>`).join('')}</div>
          <div class="steepness-legend-scale"><span>Descent</span><span>← flat →</span><span>Ascent</span></div>
          <div class="steepness-legend-thresholds" aria-hidden="true"><span>-10</span><span>-5</span><span>-2</span><span>2</span><span>5</span><span>10%</span></div>
        </div>` : ''}
        ${routeDisplayMode[context.mode] === 'elevation' ? buildElevationLegend(currentRoute) : ''}
        ${getRouteElevationSamples(currentRoute).length < 2 ? '<p class="route-display-hint">Fetch elevation first to use Steepness or Elevation.</p>' : ''}
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
        ${context.mode === 'uk' && currentRoute.id && hasValidRouteCoordinates(currentRoute.geojson) ? '<button class="secondary-action" id="offline-route-panel" type="button"><i class="fa-solid fa-map" aria-hidden="true"></i> Download offline map</button>' : ''}
        ${!(currentRoute.routing && currentRoute.routing.provider === 'ors' && currentRoute.routing.profile === 'foot-hiking') ? '<button class="secondary-action" id="snap-route-panel" type="button"><i class="fa-solid fa-route" aria-hidden="true"></i> Snap route to paths</button>' : ''}
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
      keepRouteNameVisible();
    });
    input.addEventListener('focus', () => window.requestAnimationFrame(keepRouteNameVisible));
    input.addEventListener('blur', () => window.setTimeout(resetRouteNameKeyboardLayout, 0));
    return;
  }

  const addRouteButton = panelContent.querySelector('#add-route-panel');
  const addNoteButton = panelContent.querySelector('#add-note-panel');
  const elevationDisclosure = panelContent.querySelector('.route-elevation');
  if (addRouteButton) addRouteButton.onclick = openRouteCreationOptions;
  if (addNoteButton) addNoteButton.onclick = startNotePlacement;
  if (elevationDisclosure) elevationDisclosure.ontoggle = function() {
    elevationDisclosureOpen = elevationDisclosure.open;
    clearRouteProfileMarker();
    if (elevationDisclosure.open) scheduleRouteFitToVisibleMap(context.mode);
  };
  if (elevationSummary) {
    bindElevationProfile(context, getRouteElevationSamples(currentRoute));
    if (elevationDisclosure?.open) scheduleRouteFitToVisibleMap(context.mode);
  }
  const elevationButton = panelContent.querySelector('#get-elevation-panel, #refresh-elevation-panel');
  if (elevationButton) elevationButton.onclick = async function() {
    const requestKey = `${context.mode}:${context.index}`;
    if (elevationRequesting) return;
    elevationRequesting = requestKey;
    elevationDisclosureOpen = true;
    routePanelNotice = '';
    showRoutePanelContent();
    let elevationUpdated = false;
    try {
      await window.fetchRouteElevation(context.mode, context.index);
      elevationUpdated = true;
    } catch (error) {
      const active = getActiveRouteContext();
      if (active?.route.id === context.route.id) routePanelNotice = 'Could not get elevation. Your route is unchanged; please try again.';
    } finally {
      if (elevationRequesting === requestKey) elevationRequesting = null;
      const active = getActiveRouteContext();
      if (elevationUpdated && active?.route.id === context.route.id && routeDisplayMode[context.mode] !== 'solid') {
        const route = window.getRouteList(context.mode)[context.index];
        if (routeDisplayMode[context.mode] === 'steepness') showSteepnessDisplay(context.mode, route);
        else showElevationDisplay(context.mode, route);
      }
      if (active?.route.id === context.route.id && panelView === 'details' &&
          !renamingRoute && !drawingMode && !editingMode && !noteDraft && !notePlacementMode &&
          !snapPreview && !getLiveLocationSession() && panel.classList.contains('open')) showRoutePanelContent();
    }
  };
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
      if (routeDisplayMode[context.mode] !== 'solid') setSolidRouteVisibility(context.mode, { color }, false);
      renderRouteAnnotations(context.mode, window.getRouteList(context.mode)[context.index]);
      routePanelNotice = 'Route colour updated.';
      showRoutePanelContent();
    };
  });
  panelContent.querySelectorAll('[data-route-display]').forEach(button => {
    button.onclick = function() {
      const display = button.dataset.routeDisplay;
      const showed = display === 'steepness'
        ? showSteepnessDisplay(context.mode, currentRoute)
        : display === 'elevation' && showElevationDisplay(context.mode, currentRoute);
      if (display !== 'solid' && !showed) {
        routePanelNotice = 'Fetch elevation first to use Steepness or Elevation.';
      } else if (display === 'solid') {
        clearSteepnessDisplay(context.mode);
      }
      showRoutePanelContent();
    };
  });
  panelContent.querySelector('#walk-route-panel').onclick = function() { startNavigation(context); };
  panelContent.querySelector('#edit-route-panel').onclick = function() {
    routePanelNotice = '';
    if (startRoutedEdit(context)) {
      showRoutePanelContent();
      return;
    }
    if (routeDisplayMode[context.mode] !== 'solid') clearSteepnessDisplay(context.mode);
    editingMode = true;
    drawingMode = false;
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
        clearSteepnessDisplay('uk');
        window.routeLayerUK.clearLayers();
        window.routeNotesLayerUK.clearLayers();
      } else {
        clearSteepnessDisplay('world');
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
    const offlineRouteButton = panelContent.querySelector('#offline-route-panel');
    if (offlineRouteButton) {
      offlineRouteButton.onclick = function() { panelView = 'offline-route'; showRoutePanelContent(); };
      window.FieldMapsOfflineMaps.routePacks(currentRoute.id).then(packs => {
        if (!offlineRouteButton.isConnected) return;
        if (packs.some(pack => pack.status === 'complete')) offlineRouteButton.innerHTML = '<i class="fa-solid fa-map" aria-hidden="true"></i> Offline map ✓';
        else if (packs.length) offlineRouteButton.innerHTML = '<i class="fa-solid fa-map" aria-hidden="true"></i> Resume offline map';
      }).catch(() => {});
    }
    panelContent.querySelector('#rename-route-panel').onclick = function() {
      renamingRoute = true;
      routePanelNotice = '';
      showRoutePanelContent();
    };
    const snapRouteButton = panelContent.querySelector('#snap-route-panel');
    if (snapRouteButton) snapRouteButton.onclick = function() { startSnapRoute(context); };
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
  if (sharedRouteImport) {
    panel.classList.remove('library-view');
    panelContent.className = 'route-detail-content';
    panelContent.innerHTML = `<div class="panel-heading workflow-heading"><div class="panel-eyebrow">Shared route</div><h2 class="route-title">${sharedRouteImport.waiting ? 'Finding walking paths' : 'Could not load route'}</h2><p class="panel-hint">${escapeHtml(sharedRouteImport.message)}</p></div>`;
    return;
  }
  if (snapPreview) {
    showSnapPreview();
    return;
  }
  if (panelView === 'comparison' && routeComparison) {
    showRouteComparison();
    return;
  }
  if (navigation) {
    showNavigationMode();
    return;
  }
  if (trackRecording) {
    showTrackRecording();
    return;
  }
  if (panelView === 'navigation-summary') {
    showNavigationSummary();
    return;
  }
  if (panelView === 'track-summary') {
    showTrackSummary();
    return;
  }
  if (panelView === 'track-prestart') {
    showTrackPrestart();
    return;
  }
  if (panelView === 'create-route') {
    showRouteCreationOptions();
    return;
  }
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
  if (panelView === 'backup') {
    showRouteBackup();
    return;
  }
  if (panelView === 'offline') {
    panelContent.className = 'route-detail-content route-backup-content settings-content';
    window.FieldMapsOfflineMaps.render(panelContent, {
      crs: mapUK.options.crs,
      layers: { Road_27700: ukBaseLayers['OS Road'], Outdoor_27700: ukBaseLayers['OS Outdoor'], Leisure_27700: ukBaseLayers['OS Leisure'] },
      hasKey: () => Boolean(CONFIG.apiKey),
      routes: () => window.getRouteList('uk'),
      routeBounds: route => window.FieldMapsOfflineMaps.routeBounds(routeLineCoordinates(route.geojson),
        point => proj4('EPSG:4326', 'EPSG:27700', point), point => proj4('EPSG:27700', 'EPSG:4326', point)),
      currentArea: () => {
        if ((window.currentMode || 'uk') !== 'uk') {
          if (!window.switchMap('uk')) return;
          setRoutePanelOpen(true);
        }
        panelView = 'offline-area'; showRoutePanelContent();
      },
      view: viewOfflinePack,
      back: () => { panelView = 'settings'; showRoutePanelContent(); }
    });
    return;
  }
  if (panelView === 'offline-area') {
    panelContent.className = 'route-detail-content route-backup-content settings-content';
    window.FieldMapsOfflineMaps.renderCurrentArea(panelContent, {
      crs: mapUK.options.crs,
      layers: { Road_27700: ukBaseLayers['OS Road'], Outdoor_27700: ukBaseLayers['OS Outdoor'], Leisure_27700: ukBaseLayers['OS Leisure'] },
      defaultLayer: mapUK.hasLayer(ukBaseLayers['OS Road']) ? 'Road_27700' :
        mapUK.hasLayer(ukBaseLayers['OS Leisure']) ? 'Leisure_27700' : 'Outdoor_27700',
      hasKey: () => Boolean(CONFIG.apiKey), currentBounds: getOfflineCurrentAreaBounds, view: viewOfflinePack,
      back: () => { panelView = 'offline'; showRoutePanelContent(); }
    });
    return;
  }
  if (panelView === 'offline-route' && context) {
    panelContent.className = 'route-detail-content route-backup-content';
    window.FieldMapsOfflineMaps.renderRoute(panelContent, {
      route: context.route,
      routeExists: () => window.getRouteList('uk').some(route => route?.id === context.route.id),
      defaultLayer: mapUK.hasLayer(ukBaseLayers['OS Road']) ? 'Road_27700' :
        mapUK.hasLayer(ukBaseLayers['OS Leisure']) ? 'Leisure_27700' : 'Outdoor_27700',
      layers: { Road_27700: ukBaseLayers['OS Road'], Outdoor_27700: ukBaseLayers['OS Outdoor'], Leisure_27700: ukBaseLayers['OS Leisure'] },
      crs: mapUK.options.crs,
      isValid: hasValidRouteCoordinates,
      coordinates: routeLineCoordinates,
      project: point => proj4('EPSG:4326', 'EPSG:27700', point),
      unproject: point => proj4('EPSG:27700', 'EPSG:4326', point),
      hasKey: () => Boolean(CONFIG.apiKey),
      back: () => { panelView = 'details'; showRoutePanelContent(); },
      viewStatus: () => { panelView = 'offline'; showRoutePanelContent(); }
    });
    return;
  }
  if (panelView === 'settings') {
    showSettings();
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
  const mobilePeek = !isOpen && isMobileDrawerLayout();
  panel.classList.toggle('open', isOpen);
  panel.classList.toggle('mobile-peek', mobilePeek);
  fab.classList.toggle('panel-open', isOpen);
  fabIcon.className = 'fas fa-route';
  fab.setAttribute('aria-expanded', String(isOpen));
  panel.setAttribute('aria-hidden', String(!isOpen && !mobilePeek));
  if (mobilePeek) panel.setAttribute('aria-label', 'Routes');
  panel.inert = !isOpen && !mobilePeek;
  updateDesktopMapControlOffset();
  if (isOpen) {
    showRoutePanelContent();
    addDrawToolbar();
    window.requestAnimationFrame(() => panelClose.focus({ preventScroll: true }));
  } else {
    if (drawingMode) clearPathDraft();
    if (editingMode && !routedEdit) activeDrawControl?._toolbars?.edit?._modes.edit.handler.revertLayers();
    resetRouteNameKeyboardLayout();
    clearRouteProfileMarker();
    if (!mobilePeek) panelContent.innerHTML = '';
    removeDrawToolbar();
    if (routedEdit) finishRoutedEdit(true);
    drawingMode = false;
    editingMode = false;
    if (restoreFocus) {
      const restoreTarget = isMobileDrawerLayout() ? panelRouteToggle : fab;
      restoreTarget.focus({ preventScroll: true });
    }
  }
  refreshNavigationMapPosition();
}

function syncRoutePanelLayout() {
  panel.classList.remove('drawer-dragging');
  panel.style.removeProperty('--drawer-drag-offset');
  const mobilePeek = !panel.classList.contains('open') && isMobileDrawerLayout();
  panel.classList.toggle('mobile-peek', mobilePeek);
  panel.setAttribute('aria-hidden', String(!panel.classList.contains('open') && !mobilePeek));
  panel.inert = !panel.classList.contains('open') && !mobilePeek;
  updateDesktopMapControlOffset();
  refreshNavigationMapPosition();
}

window.matchMedia('(max-width: 600px)').addEventListener('change', syncRoutePanelLayout);
window.addEventListener('resize', () => { updateDesktopMapControlOffset(); refreshNavigationMapPosition(); });

fab.onclick = function() {
  if (panel.classList.contains('open') && panelView !== 'settings' && panelView !== 'backup') {
    setRoutePanelOpen(false);
  } else {
    openRoutesPanel();
  }
};

panelRouteToggle.onclick = function() {
  openRoutesPanel();
};

panelSettings.onclick = function() {
  openSettingsPanel();
};

panelClose.onclick = function() {
  setRoutePanelOpen(false, true);
};

let panelDragStartY = null;
let panelDragStartOpen = false;
let panelTopbarDragged = false;
let panelTopbarHandledTap = false;
let panelTopbarPointerId = null;

function getMobileDrawerCollapseOffset() {
  const peekHeight = 58 + (Number.parseFloat(getComputedStyle(panel).getPropertyValue('padding-bottom')) || 0);
  return Math.max(0, panel.getBoundingClientRect().height - peekHeight);
}

function finishMobileDrawerDrag() {
  if (panelDragStartY == null) return;
  if (!panelTopbarDragged) {
    panelDragStartY = null;
    panel.classList.remove('drawer-dragging');
    panel.style.removeProperty('--drawer-drag-offset');
    return;
  }
  const collapseOffset = getMobileDrawerCollapseOffset();
  const currentOffset = Number.parseFloat(panel.style.getPropertyValue('--drawer-drag-offset')) || 0;
  const shouldOpen = currentOffset < collapseOffset * 0.45;
  panelDragStartY = null;
  if (shouldOpen && !drawingMode && !editingMode && !notePlacementMode && !noteDraft && !snapPreview && !sharedRouteImport) {
    panelView = getAppropriateRoutePanelView();
  }
  setRoutePanelOpen(shouldOpen);
  window.requestAnimationFrame(() => {
    panel.classList.remove('drawer-dragging');
    panel.style.removeProperty('--drawer-drag-offset');
  });
  window.setTimeout(() => { panelTopbarDragged = false; }, 0);
}

panelTopbar.addEventListener('pointerdown', function(event) {
  if (!isMobileDrawerLayout() || event.target.closest('button')) return;
  event.preventDefault();
  event.stopPropagation();
  if (!panel.classList.contains('open') && !panelContent.childElementCount) {
    panelView = getAppropriateRoutePanelView();
    panel.classList.remove('mobile-peek');
    showRoutePanelContent();
    panel.classList.add('mobile-peek');
  }
  panelDragStartY = event.clientY;
  panelDragStartOpen = panel.classList.contains('open');
  panelTopbarDragged = false;
  panelTopbarHandledTap = false;
  panelTopbarPointerId = event.pointerId;
  panel.classList.add('drawer-dragging');
  panelTopbar.setPointerCapture?.(event.pointerId);
});
panelTopbar.addEventListener('pointermove', function(event) {
  if (panelDragStartY == null) return;
  event.preventDefault();
  event.stopPropagation();
  const movement = event.clientY - panelDragStartY;
  if (!panelTopbarDragged && Math.abs(movement) < 8) return;
  panelTopbarDragged = true;
  const collapseOffset = getMobileDrawerCollapseOffset();
  const startOffset = panelDragStartOpen ? 0 : collapseOffset;
  const offset = Math.min(collapseOffset, Math.max(0, startOffset + movement));
  panel.style.setProperty('--drawer-drag-offset', `${offset}px`);
});
panelTopbar.addEventListener('pointerup', function(event) {
  if (panelTopbarPointerId !== event.pointerId || panelDragStartY == null) return;
  event.preventDefault();
  event.stopPropagation();
  if (panelTopbarDragged) {
    finishMobileDrawerDrag();
  } else {
    panelDragStartY = null;
    panel.classList.remove('drawer-dragging');
    panel.style.removeProperty('--drawer-drag-offset');
    panelTopbarHandledTap = true;
    if (panel.classList.contains('open')) setRoutePanelOpen(false);
    else openRoutesPanel();
  }
  panelTopbarPointerId = null;
});
panelTopbar.addEventListener('pointercancel', function(event) {
  if (panelTopbarPointerId !== event.pointerId) return;
  panelTopbarPointerId = null;
  finishMobileDrawerDrag();
});
panelTopbar.addEventListener('click', function(event) {
  if (panelTopbarHandledTap) {
    panelTopbarHandledTap = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!isMobileDrawerLayout() || event.target.closest('button') || panelTopbarDragged) return;
  if (panel.classList.contains('open')) setRoutePanelOpen(false);
  else openRoutesPanel();
});

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
    clearSteepnessDisplay('uk');
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
      fitRouteBoundsToVisibleMap('uk', e.layer.getBounds());
    }
  }
  showRoutePanelContent();
  updateRouteFabLabel();
});

mapWorld.on(L.Draw.Event.CREATED, function (e) {
  drawingMode = false;
  editingMode = false;
  if (e.layerType === 'polyline') {
    clearSteepnessDisplay('world');
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
      fitRouteBoundsToVisibleMap('world', e.layer.getBounds());
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
mapUK.on('click', function(event) { handlePathClick('uk', event); handleRoutedEditClick('uk', event); });
mapWorld.on('click', function(event) { handlePathClick('world', event); handleRoutedEditClick('world', event); });

// Save map state for persistence
function saveMapState() {
  let map, mode = currentMode;
  if (mode === 'uk') map = mapUK;
  else map = mapWorld;
  const center = map.getCenter();
  const zoom = map.getZoom();
  try {
    localStorage.setItem('lastMode', mode);
    localStorage.setItem('lastCenter', JSON.stringify([center.lat, center.lng]));
    localStorage.setItem('lastZoom', zoom);
  } catch (_) { /* A failed preference write must not interrupt map movement. */ }
}
mapUK.on('moveend zoomend', saveMapState);
mapWorld.on('moveend zoomend', saveMapState);
// Leaflet only emits these for direct gestures, so automatic panTo following
// remains calm while a deliberate pan or zoom hands map control back to the user.
[mapUK, mapWorld].forEach(map => map.on('dragstart zoomstart', () => {
  if (navigation && getNavigationMap(navigation.mode) === map) {
    navigation.follow = false;
    refreshNavigationUI();
  }
  if (trackRecording && getNavigationMap(trackRecording.mode) === map) {
    trackRecording.follow = false;
    refreshTrackUI();
  }
}));

// --- Load shared route if present in URL ---
async function importSharedRoute(sharedRoute) {
  if (!sharedRoute) return;
  const sharedMode = currentMode || 'uk';
  if (sharedRoute.routing) {
    sharedRouteImport = { waiting: true, message: 'Rebuilding this shared walking route from its saved control waypoints…' };
    setRoutePanelOpen(true);
    showRoutePanelContent();
    try {
      sharedRoute.geojson = await requestOrsFootHikingRoute(sharedRoute.routing.waypoints);
    } catch (error) {
      sharedRouteImport = { waiting: false, message: 'This shared route could not be rebuilt. No route was saved; check your connection and try the link again.' };
      showRoutePanelContent();
      return;
    }
  }
  if (!sharedRoute.geojson) return;
  const layer = L.geoJSON(sharedRoute.geojson, { style: window.getRouteStyle(sharedMode, sharedRoute) });
  if (!layer.getBounds().isValid()) return;
  const targetLayer = sharedMode === 'uk' ? window.routeLayerUK : window.routeLayerWorld;
  targetLayer.clearLayers();
  layer.eachLayer(l => targetLayer.addLayer(l));
  const importedIndex = window.saveRouteToList(sharedMode, sharedRoute.name || getDefaultRouteName(sharedMode), layer, sharedRoute.routing);
  if (sharedRoute.color) window.updateRouteColorInList(sharedMode, importedIndex, sharedRoute.color);
  if (Array.isArray(sharedRoute.annotations)) window.updateRouteAnnotationsInList(sharedMode, importedIndex, sharedRoute.annotations);
  const importedRoute = window.getRouteList(sharedMode)[importedIndex];
  window.applyRouteStyle(targetLayer, sharedMode, importedRoute);
  window.currentRouteIndex[sharedMode] = importedIndex;
  renderRouteAnnotations(sharedMode, importedRoute);
  panelView = 'details';
  sharedRouteImport = null;
  fitRouteBoundsToVisibleMap(sharedMode, layer.getBounds());
  clearSharedRouteParam();
  showRoutePanelContent();
}

const sharedRoute = getSharedRouteFromUrl();
if (sharedRoute) importSharedRoute(sharedRoute);

function canSwitchMapMode() {
  if (navigation || trackRecording) {
    return { allowed: false, reason: 'Finish the current walk before switching maps.' };
  }
  if (drawingMode || editingMode || pathDraft || snapPreview || routedEdit || sharedRouteImport || notePlacementMode || noteDraft) {
    return { allowed: false, reason: 'Finish or cancel the current route action before switching maps.' };
  }
  return { allowed: true };
}

function showMapSwitchBlockedMessage(message) {
  routePanelNotice = message;
  const status = document.getElementById('map-switch-notice');
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
  window.clearTimeout(mapSwitchNoticeTimeout);
  mapSwitchNoticeTimeout = window.setTimeout(() => { status.hidden = true; }, 4000);
}

// --- Remove draw toolbar if open before switching maps ---
window.switchMap = function(mode) {
  if (mode !== 'uk' && mode !== 'world') return false;
  if (mode === currentMode) return true;
  const eligibility = canSwitchMapMode();
  if (!eligibility.allowed) {
    showMapSwitchBlockedMessage(eligibility.reason);
    return false;
  }
  clearRouteComparison();
  let center, zoom;
  if (activeDrawControl) removeDrawToolbar();
  if (panel.classList.contains('open')) {
    setRoutePanelOpen(false);
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
  return true;
};

function isPracticalUKSearchLocation(lat, lng) {
  // EPSG:27700 covers Great Britain, not a dynamically selected CRS. Keep a
  // small practical envelope so UK searches use the detailed UK map without
  // making worldwide results inaccessible.
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 49 && lat <= 61.5 && lng >= -8.75 && lng <= 2.5;
}

function getSearchResultZoom(mode, type) {
  const closeTypes = new Set(['address', 'venue', 'poi', 'postcode', 'street']);
  const mediumTypes = new Set(['locality', 'localadmin', 'neighbourhood']);
  const requested = mode === 'uk'
    ? (closeTypes.has(type) ? 9 : mediumTypes.has(type) ? 6 : 4)
    : (closeTypes.has(type) ? 16 : mediumTypes.has(type) ? 12 : 9);
  const map = mode === 'uk' ? mapUK : mapWorld;
  const minZoom = Number.isFinite(map.getMinZoom()) ? map.getMinZoom() : 0;
  const maxZoom = Number.isFinite(map.getMaxZoom()) ? map.getMaxZoom() : (mode === 'uk' ? 12 : 18);
  return Math.max(minZoom, Math.min(maxZoom, requested));
}

function clearSearchResultMarker() {
  searchResultLayerUK.clearLayers();
  searchResultLayerWorld.clearLayers();
  window.FieldMapsSearch?.clearSelection?.();
}

function showSearchResultMarker(mode, result) {
  const layer = mode === 'uk' ? searchResultLayerUK : searchResultLayerWorld;
  layer.clearLayers();
  const marker = L.marker([result.lat, result.lng], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: 'field-search-marker',
      html: '<i class="fa-solid fa-location-dot" aria-hidden="true"></i>',
      iconSize: [28, 28],
      iconAnchor: [14, 28]
    })
  });
  layer.addLayer(marker);
  const label = document.createElement('span');
  label.textContent = result.label;
  marker.bindTooltip(label, {
    permanent: true,
    direction: 'top',
    offset: [0, -22],
    className: 'field-search-marker-label'
  });
}

function selectSearchResult(result) {
  if (!window.FieldMapsSearch?.validCoordinate?.(result.lat, result.lng) || getLiveLocationSession()) return;
  if (routeComparison) endRouteComparison();
  const mode = isPracticalUKSearchLocation(result.lat, result.lng) ? 'uk' : 'world';
  if (mode === 'uk') {
    // Explicitly validate the WGS84-to-BNG transform before Leaflet's CRS uses
    // the same projection to centre the UK map.
    try {
      const bng = proj4('EPSG:4326', 'EPSG:27700', [result.lng, result.lat]);
      if (!Number.isFinite(bng[0]) || !Number.isFinite(bng[1])) return;
    } catch (error) { return; }
  }
  if (currentMode !== mode && !window.switchMap(mode)) return;
  clearSearchResultMarker();
  const map = mode === 'uk' ? mapUK : mapWorld;
  map.setView([result.lat, result.lng], getSearchResultZoom(mode, result.type));
  showSearchResultMarker(mode, result);
  window.FieldMapsSearch?.updateSelection?.(result);
}

window.FieldMapsSearch?.setContextProvider?.(() => {
  const map = currentMode === 'uk' ? mapUK : mapWorld;
  const center = map.getCenter();
  return { lat: center.lat, lng: center.lng };
});
window.FieldMapsSearch?.setOpenGuard?.(() => {
  if (getLiveLocationSession()) return false;
  // Comparison's purpose is a temporary focused map view. Searching ends it
  // through the existing cleanup path before the map is moved.
  if (routeComparison) endRouteComparison();
  return true;
});
window.FieldMapsSearch?.setSelectionHandler?.(selectSearchResult);
window.FieldMapsSearch.clearMarker = clearSearchResultMarker;

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
setRoutePanelOpen(false);
