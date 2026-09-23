const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const proj4 = require('../vendor/proj4/proj4.js');

const sandbox = { URL, globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync('js/offline-maps.js', 'utf8'), sandbox);
const { canonicalizeOsTileUrl, enumerateTiles, zoomPolicy, routeBounds, matchingPack, TILE_LIMIT } = sandbox.FieldMapsOfflineMaps;

const tile = 'https://api.os.uk/maps/raster/v1/zxy/Outdoor_27700/9/123/456.png';
assert.equal(canonicalizeOsTileUrl(tile + '?key=first'), tile);
assert.equal(canonicalizeOsTileUrl(tile + '?key=second&other=value'), tile);
assert.equal(canonicalizeOsTileUrl('https://tile.openstreetmap.org/9/123/456.png'), null);
assert.equal(canonicalizeOsTileUrl('https://api.os.uk/maps/raster/v1/zxy/Other_27700/9/123/456.png?key=x'), null);
assert.equal(canonicalizeOsTileUrl('https://evil.example/maps/raster/v1/zxy/Outdoor_27700/9/123/456.png'), null);
for (const style of ['Road', 'Outdoor', 'Leisure'])
  assert.equal(canonicalizeOsTileUrl(tile.replace('Outdoor', style) + '?key=secret'), tile.replace('Outdoor', style));
assert.deepEqual(JSON.parse(JSON.stringify(zoomPolicy('Road_27700', 'standard'))), { minZoom: 5, maxZoom: 9 });
assert.deepEqual(JSON.parse(JSON.stringify(zoomPolicy('Road_27700', 'detailed'))), { minZoom: 5, maxZoom: 10 });
assert.deepEqual(JSON.parse(JSON.stringify(zoomPolicy('Outdoor_27700', 'standard'))), { minZoom: 5, maxZoom: 9 });
assert.deepEqual(JSON.parse(JSON.stringify(zoomPolicy('Outdoor_27700', 'detailed'))), { minZoom: 5, maxZoom: 10 });
assert.deepEqual(JSON.parse(JSON.stringify(zoomPolicy('Leisure_27700', 'standard'))), { minZoom: 5, maxZoom: 9 });
assert.equal(zoomPolicy('Leisure_27700', 'detailed'), null);

// Use the UK CRS pixel convention: origin [-238375, 1376256], resolution 7m at z7.
// The chosen projected 1 km square lies inside one tile at z7 and four at z9.
const origin = [-238375, 1376256];
const resolutions = [896, 448, 224, 112, 56, 28, 14, 7, 3.5, 1.75];
const crs = { latLngToPoint(p, z) {
  return { x: (p.lng - origin[0]) / resolutions[z], y: (origin[1] - p.lat) / resolutions[z] };
} };
const bounds = { west: 374000, east: 375000, south: 442000, north: 443000 };
const tiles = enumerateTiles(bounds, 7, 9, crs, 256);
assert(tiles.length > 0 && tiles.length < TILE_LIMIT);
assert.deepEqual([...new Set(tiles.map(t => t.z))], [7, 8, 9]);
assert.equal(new Set(tiles.map(t => `${t.z}/${t.x}/${t.y}`)).size, tiles.length);
// Leaflet GridLayer uses floor(projected pixel / tile size), with XYZ y direction.
const center = { lat: 442500, lng: 374500 };
const point = crs.latLngToPoint(center, 9);
assert(tiles.some(t => t.z === 9 && t.x === Math.floor(point.x / 256) && t.y === Math.floor(point.y / 256)));

// Match the production EPSG:27700 definition and Proj4Leaflet origin/resolution.
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const bngCrs = { latLngToPoint(p, z) {
  const [easting, northing] = proj4('EPSG:4326', 'EPSG:27700', [p.lng, p.lat]);
  return { x: (easting - origin[0]) / resolutions[z], y: (origin[1] - northing) / resolutions[z] };
} };
const nearCenter = { south: 52.995, west: -2.005, north: 53.005, east: -1.995 };
const bngTiles = enumerateTiles(nearCenter, 9, 9, bngCrs, 256);
assert(bngTiles.some(t => t.z === 9 && t.x === 1425 && t.y === 2302));
const routeCoordinates = [[-2.005, 52.995], [-1.995, 53.005]];
const project = point => proj4('EPSG:4326', 'EPSG:27700', point);
const unproject = point => proj4('EPSG:27700', 'EPSG:4326', point);
const routeArea = routeBounds(routeCoordinates, project, unproject);
assert(routeArea.west < -2.005 && routeArea.east > -1.995);
assert(routeArea.south < 52.995 && routeArea.north > 53.005);
const sw = project([routeArea.west, routeArea.south]);
const ne = project([routeArea.east, routeArea.north]);
const a = project(routeCoordinates[0]);
const b = project(routeCoordinates[1]);
assert(sw[0] <= Math.min(a[0], b[0]) - 990 && ne[0] >= Math.max(a[0], b[0]) + 990);
assert(sw[1] <= Math.min(a[1], b[1]) - 990 && ne[1] >= Math.max(a[1], b[1]) + 990);
const routeTiles = enumerateTiles(routeArea, 5, 9, bngCrs, 256);
assert.deepEqual([...new Set(routeTiles.map(t => t.z))], [5, 6, 7, 8, 9]);
assert.equal(new Set(routeTiles.map(t => `${t.z}/${t.x}/${t.y}`)).size, routeTiles.length);
assert.equal(enumerateTiles(routeArea, 5, 9, bngCrs, 256).length, routeTiles.length);
const selection = { sourceRouteId: 'stable-id', layer: 'Outdoor_27700', minZoom: 5, maxZoom: 9, bounds: routeArea };
const pack = { ...selection, name: 'Old route name — Outdoor' };
assert.equal(matchingPack([pack], { ...selection, name: 'New route name' }), pack);
assert.equal(matchingPack([pack], { ...selection, layer: 'Road_27700' }), undefined);
assert.equal(matchingPack([pack], { ...selection, maxZoom: 10 }), undefined);
assert.equal(matchingPack([pack], { ...selection, bounds: { ...routeArea, west: routeArea.west - 0.001 } }), undefined);
console.log('offline-maps tests passed');
