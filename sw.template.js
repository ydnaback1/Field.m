const BUILD_ID = "__FIELD_MAPS_BUILD_ID__";
const CACHE_PREFIX = "field-maps-app-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
importScripts("./js/offline-maps.js");
const APP_ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "explore_24dp_FILL0_wght400_GRAD0_opsz24.svg",
  "icons/field-maps-192.png",
  "icons/field-maps-512.png",
  "icons/field-maps-maskable.svg",
  "icons/field-maps-maskable-512.png",
  "css/custom.css",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "vendor/proj4/proj4.js",
  "vendor/proj4leaflet/proj4leaflet.min.js",
  "vendor/leaflet-locatecontrol/L.Control.Locate.min.css",
  "vendor/leaflet-locatecontrol/L.Control.Locate.min.js",
  "vendor/leaflet-draw/leaflet.draw.css",
  "vendor/leaflet-draw/leaflet.draw.js",
  "vendor/leaflet-draw/images/spritesheet.png",
  "vendor/leaflet-draw/images/spritesheet-2x.png",
  "vendor/leaflet-draw/images/spritesheet.svg",
  "vendor/font-awesome/css/all.min.css",
  "vendor/font-awesome/webfonts/fa-brands-400.woff2",
  "vendor/font-awesome/webfonts/fa-brands-400.ttf",
  "vendor/font-awesome/webfonts/fa-regular-400.woff2",
  "vendor/font-awesome/webfonts/fa-regular-400.ttf",
  "vendor/font-awesome/webfonts/fa-solid-900.woff2",
  "vendor/font-awesome/webfonts/fa-solid-900.ttf",
  "vendor/font-awesome/webfonts/fa-v4compatibility.woff2",
  "vendor/font-awesome/webfonts/fa-v4compatibility.ttf",
  "plugins/leaflet-measure/leaflet.measure.css",
  "plugins/leaflet-measure/leaflet.measure.js",
  "config.js",
  "js/pwa.js",
  "js/offline-maps.js",
  "js/layers.js",
  "js/search.js",
  "js/controls.js",
  "js/routes.js",
  "js/map.js",
  "js/live-location.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_BUILD_ID" && event.ports[0]) {
    event.ports[0].postMessage({ type: "FIELD_MAPS_BUILD_ID", buildId: BUILD_ID });
  }
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  const canonicalOsTile = event.request.method === "GET"
    ? FieldMapsOfflineMaps.canonicalizeOsTileUrl(event.request.url) : null;
  if (canonicalOsTile) {
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch (error) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          if (!name.startsWith(FieldMapsOfflineMaps.CACHE_PREFIX)) continue;
          const cached = await (await caches.open(name)).match(canonicalOsTile);
          if (cached) return cached;
        }
        throw error;
      }
    })());
    return;
  }

  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.endsWith("/config.runtime.js")
  ) {
    return;
  }

  event.respondWith(caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request)));
});
