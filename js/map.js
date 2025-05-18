// js/map.js

const serviceUrl = CONFIG.serviceUrl;
const apiKey = CONFIG.apiKey;

// Setup the EPSG:27700 (British National Grid) projection.
var bngcrs = new L.Proj.CRS('EPSG:27700',
    '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs', {
        resolutions: [896.0, 448.0, 224.0, 112.0, 56.0, 28.0, 14.0, 7.0, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
        origin: [-238375.0, 1376256.0]
    }
);

// Transform coordinates utility.
function transformCoords(arr) {
    return proj4('EPSG:27700', 'EPSG:4326', arr).reverse();
}

// Initialize the map.
var mapOptions = {
    crs: bngcrs,
    center: transformCoords([374288, 442016]),
    zoom: 7,
    maxBounds: [
        transformCoords([-238375.0, 0.0]),
        transformCoords([900000.0, 1376256.0])
    ],
    attributionControl: false
};

var map = L.map('map', mapOptions);

// Get base layers from layers.js (imported in your HTML before this file)
var baseLayers = getBaseLayers(serviceUrl, apiKey);

// Add default base layer (OS Outdoor) to map
baseLayers['OS Outdoor'].addTo(map);

// Add controls using controls.js
addControls(map, baseLayers);


