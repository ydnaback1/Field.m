const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const proj4 = require('../vendor/proj4/proj4.js');

const sandbox = { URL, globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync('js/offline-maps.js', 'utf8'), sandbox);
const { canonicalizeOsTileUrl, enumerateTiles, TILE_LIMIT } = sandbox.FieldMapsOfflineMaps;

const tile = 'https://api.os.uk/maps/raster/v1/zxy/Outdoor_27700/9/123/456.png';
assert.equal(canonicalizeOsTileUrl(tile + '?key=first'), tile);
assert.equal(canonicalizeOsTileUrl(tile + '?key=second&other=value'), tile);
assert.equal(canonicalizeOsTileUrl('https://tile.openstreetmap.org/9/123/456.png'), null);
assert.equal(canonicalizeOsTileUrl('https://api.os.uk/maps/raster/v1/zxy/Other_27700/9/123/456.png?key=x'), null);
assert.equal(canonicalizeOsTileUrl('https://evil.example/maps/raster/v1/zxy/Outdoor_27700/9/123/456.png'), null);

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
console.log('offline-maps tests passed');
