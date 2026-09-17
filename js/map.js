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
const settingsFab = document.getElementById('fab-settings');
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
let sharedRouteImport = null;
let panelView = 'library';
let routePanelViewBeforeSettings = 'library';
let routeLibraryQuery = '';
let routeLibrarySort = 'recent';
let routeLibraryFilter = 'all';
let routeBackupCandidate = null;
let routeBackupNotice = '';
let renamingRoute = false;
let confirmingDelete = false;
let routePanelNotice = '';
let elevationRequesting = null;
let elevationDisclosureOpen = false;
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
        return { name: payload.n, color: payload.c, annotations: Array.isArray(payload.a) ? payload.a : [], geojson: lineCoordinatesToGeojson(coordinates) };
      }
      if (payload.t === 'ors' && payload.p === 'foot-hiking' && Array.isArray(payload.w) && payload.w.length >= 2 && payload.w.every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))) return { name: payload.n, color: payload.c, annotations: Array.isArray(payload.a) ? payload.a : [], routing: { provider: 'ors', profile: 'foot-hiking', waypoints: payload.w } };
      return null;
    }
    return payload; // Legacy payloads stored full GeoJSON.
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

function isMobileDrawerLayout() {
  return window.matchMedia('(max-width: 600px)').matches;
}

function getAppropriateRoutePanelView() {
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
  if (panelView === 'details' || panelView === 'library') {
    routePanelViewBeforeSettings = panelView;
  } else {
    routePanelViewBeforeSettings = getAppropriateRoutePanelView();
  }
  panelView = 'settings';
  routeBackupNotice = '';
  setRoutePanelOpen(true);
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
        appStorageNotice.textContent = 'Could not refresh app files.';
        refreshFiles.disabled = false;
      }
    };
  }
}

function resetRouteNameKeyboardLayout() {
  panel.classList.remove('route-name-keyboard-visible');
  panel.style.removeProperty('--keyboard-panel-offset');
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
  const inputBounds = input.getBoundingClientRect();
  const visibleBottom = viewport.offsetTop + viewport.height - 16;
  const currentOffset = Number.parseFloat(panel.style.getPropertyValue('--keyboard-panel-offset')) || 0;
  const offset = Math.max(0, Math.ceil(currentOffset + inputBounds.bottom - visibleBottom));
  if (offset) {
    panel.style.setProperty('--keyboard-panel-offset', `${offset}px`);
    panel.classList.add('route-name-keyboard-visible');
    input.scrollIntoView({ block: 'nearest', behavior: 'auto' });
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
    </section>`;
  panelContent.querySelector('#open-measure-tool').onclick = function() {
    setRoutePanelOpen(false);
    window.openMeasureTool?.();
  };
  panelContent.querySelector('#open-data-storage').onclick = function() {
    panelView = 'backup';
    routeBackupNotice = '';
    showRoutePanelContent();
  };
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
    const geojson = await requestOrsFootHikingRoute(pathDraft.waypoints);
    if (!pathDraft || requestId !== pathDraft.requestId) return;
    pathDraft.geojson = geojson;
    pathDraft.error = '';
    renderPathDraft();
  } catch (error) {
    if (!pathDraft || requestId !== pathDraft.requestId) return;
    pathDraft.error = pathDraft.kind === 'snap' ? 'Could not convert this route to walking paths. Your original route is unchanged; try again later.' : 'Could not follow paths. Your waypoints are still available; try again or add another point.';
  } finally {
    if (pathDraft && requestId === pathDraft.requestId) {
      pathDraft.waiting = false;
      showRoutePanelContent();
    }
  }
}

async function requestOrsFootHikingRoute(waypoints) {
  if (!CONFIG.orsApiKey) throw new Error('Path routing is unavailable because the ORS key is missing.');
  const response = await fetch('https://api.heigit.org/openrouteservice/v2/directions/foot-hiking/geojson', {
    method: 'POST',
    headers: { Authorization: CONFIG.orsApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: waypoints })
  });
  if (!response.ok) throw new Error('Routing request failed');
  const geojson = await response.json();
  if (!geojson || !geojson.features || !geojson.features.length) throw new Error('No route returned');
  return geojson;
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
      if (shareUrl.length > 8000) {
        if (shareStatus) shareStatus.textContent = 'This free-drawn route is too large to share reliably. Export GPX or GeoJSON instead.';
        return;
      }
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
  if (addRouteButton) addRouteButton.onclick = startRouteDrawing;
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
      routePanelNotice = 'Could not get elevation. Your route is unchanged; please try again.';
    } finally {
      if (elevationRequesting === requestKey) elevationRequesting = null;
      if (elevationUpdated && routeDisplayMode[context.mode] !== 'solid') {
        const route = window.getRouteList(context.mode)[context.index];
        if (routeDisplayMode[context.mode] === 'steepness') showSteepnessDisplay(context.mode, route);
        else showElevationDisplay(context.mode, route);
      }
      showRoutePanelContent();
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
  panelContent.querySelector('#edit-route-panel').onclick = function() {
    if (routeDisplayMode[context.mode] !== 'solid') clearSteepnessDisplay(context.mode);
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
  settingsFab.classList.toggle('panel-open', isOpen);
  fabIcon.className = 'fas fa-route';
  fab.setAttribute('aria-expanded', String(isOpen));
  settingsFab.setAttribute('aria-expanded', String(isOpen));
  panel.setAttribute('aria-hidden', String(!isOpen && !mobilePeek));
  if (mobilePeek) panel.setAttribute('aria-label', 'Routes');
  panel.inert = !isOpen && !mobilePeek;
  if (isOpen) {
    showRoutePanelContent();
    addDrawToolbar();
    window.requestAnimationFrame(() => panelClose.focus({ preventScroll: true }));
  } else {
    resetRouteNameKeyboardLayout();
    clearRouteProfileMarker();
    if (!mobilePeek) panelContent.innerHTML = '';
    removeDrawToolbar();
    drawingMode = false;
    editingMode = false;
    if (restoreFocus) {
      const restoreTarget = isMobileDrawerLayout() ? panelRouteToggle : (panelView === 'settings' ? settingsFab : fab);
      restoreTarget.focus({ preventScroll: true });
    }
  }
}

fab.onclick = function() {
  if (panel.classList.contains('open') && panelView !== 'settings' && panelView !== 'backup') {
    setRoutePanelOpen(false);
  } else {
    openRoutesPanel();
  }
};

settingsFab.onclick = function() {
  openSettingsPanel();
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
  panel.classList.add('drawer-dragging');
  panelTopbar.setPointerCapture?.(event.pointerId);
});
panelTopbar.addEventListener('pointermove', function(event) {
  if (panelDragStartY == null) return;
  event.preventDefault();
  event.stopPropagation();
  const collapseOffset = getMobileDrawerCollapseOffset();
  const startOffset = panelDragStartOpen ? 0 : collapseOffset;
  const offset = Math.min(collapseOffset, Math.max(0, startOffset + event.clientY - panelDragStartY));
  if (Math.abs(event.clientY - panelDragStartY) >= 8) panelTopbarDragged = true;
  panel.style.setProperty('--drawer-drag-offset', `${offset}px`);
});
panelTopbar.addEventListener('pointerup', function(event) {
  event.preventDefault();
  event.stopPropagation();
  finishMobileDrawerDrag();
});
panelTopbar.addEventListener('pointercancel', finishMobileDrawerDrag);
panelTopbar.addEventListener('click', function(event) {
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
  const map = sharedMode === 'uk' ? mapUK : mapWorld;
  map.fitBounds(layer.getBounds(), { paddingBottomRight: [0, 316], paddingTopLeft: [0, 24] });
  clearSharedRouteParam();
  showRoutePanelContent();
}

const sharedRoute = getSharedRouteFromUrl();
if (sharedRoute) importSharedRoute(sharedRoute);

// --- Remove draw toolbar if open before switching maps ---
window.switchMap = function(mode) {
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
setRoutePanelOpen(false);
