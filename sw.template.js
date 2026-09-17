const BUILD_ID = "__FIELD_MAPS_BUILD_ID__";
const CACHE_PREFIX = "field-maps-app-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "explore_24dp_FILL0_wght400_GRAD0_opsz24.svg",
  "css/custom.css",
  "plugins/leaflet-measure/leaflet.measure.css",
  "plugins/leaflet-measure/leaflet.measure.js",
  "config.js",
  "js/pwa.js",
  "js/layers.js",
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

  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.endsWith("/config.runtime.js")
  ) {
    return;
  }

  event.respondWith(caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request)));
});
