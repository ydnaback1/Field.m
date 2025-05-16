const bngCRS = new L.Proj.CRS('EPSG:27700',
    '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs', {
        resolutions: [896.0, 448.0, 224.0, 112.0, 56.0, 28.0, 14.0, 7.0, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
        origin: [-238375.0, 1376256.0]
    }
);

const map = L.map('map', {
    crs: bngCRS,
    center: transformCoords([374288, 442016]),
    zoom: 7,
    maxBounds: [transformCoords([-238375.0, 0.0]), transformCoords([900000.0, 1376256.0])],
    attributionControl: false
});

const baseLayers = getBaseLayers(CONFIG.serviceUrl, CONFIG.apiKey);
const offlineLayer = getOfflineLayer(CONFIG.serviceUrl, CONFIG.apiKey);

// Add default layer
baseLayers['OS Outdoor'].addTo(map);

addControls(map, baseLayers, offlineLayer);

// Setup offline tile events
map.on('offline', function() {
    offlineLayer.load();
});
