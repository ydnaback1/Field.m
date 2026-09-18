const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routeGeometry = { type: 'LineString', coordinates: [[-1, 51], [-0.99, 51]] };
const store = new Map([
  ['routeList_uk', JSON.stringify([{ name: 'Legacy', geojson: routeGeometry }])],
  ['routeList_world', JSON.stringify([])]
]);
global.window = global;
global.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};
vm.runInThisContext(fs.readFileSync('js/routes.js', 'utf8'), { filename: 'routes.js' });

const legacy = getRouteList('uk')[0];
assert.equal(typeof legacy.id, 'string');
assert(legacy.id.length > 0);
assert.equal(legacy.name, 'Legacy');
assert.deepEqual(legacy.geojson, routeGeometry);
assert.equal(getRouteList('uk')[0].id, legacy.id);

assert(renameRouteInList('uk', 0, 'Renamed'));
assert(updateRouteColorInList('uk', 0, '#123456'));
assert(updateRouteInList('uk', 0, routeGeometry));
assert.equal(getRouteList('uk')[0].id, legacy.id);

const trackedIndex = saveRouteToList('uk', 'Recorded', { toGeoJSON: () => routeGeometry }, null, {
  activity: { type: 'walked', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:01:02.000Z', durationSeconds: 62 }
});
const tracked = getRouteList('uk')[trackedIndex];
assert.notEqual(tracked.id, legacy.id);
assert.equal(tracked.sourceRouteId, undefined);
assert.equal(tracked.activity.durationSeconds, 62);

const walkedIndex = saveRouteToList('uk', 'Legacy — Walked', { toGeoJSON: () => routeGeometry }, null, {
  sourceRouteId: legacy.id,
  activity: { type: 'walked', startedAt: '2026-01-01T11:00:00.000Z', endedAt: '2026-01-01T11:10:00.000Z', durationSeconds: 600 }
});
const walked = getRouteList('uk')[walkedIndex];
assert.notEqual(walked.id, legacy.id);
assert.equal(walked.sourceRouteId, legacy.id);

const backup = exportRouteBackup();
assert.equal(backup.routes.uk[walkedIndex].id, walked.id);
assert.equal(backup.routes.uk[walkedIndex].sourceRouteId, legacy.id);
assert.equal(backup.routes.uk[walkedIndex].activity.type, 'walked');
assert.equal(validateRouteBackup(backup).valid, true);

function invalidBackup(mutator) {
  const candidate = structuredClone(backup);
  mutator(candidate.routes.uk[0]);
  return candidate;
}

assert.equal(validateRouteBackup(invalidBackup(route => { route.geojson.coordinates[0] = [Infinity, 51]; })).valid, false);
assert.equal(validateRouteBackup(invalidBackup(route => { route.geojson.coordinates[0] = [-1, 91]; })).valid, false);
assert.equal(validateRouteBackup(invalidBackup(route => { route.geojson.coordinates = [[-1, 51]]; })).valid, false);
assert.equal(validateRouteBackup(invalidBackup(route => { route.annotations = [{ id: 'note-1', title: 'Bad point', note: '', lat: 91, lng: -1 }]; })).valid, false);
const beforeRejectedReplace = { uk: getRouteList('uk'), world: getRouteList('world') };
assert.equal(applyRouteBackup(invalidBackup(route => { route.geojson.coordinates[0] = [NaN, 51]; }), 'replace').valid, false);
assert.deepEqual(getRouteList('uk'), beforeRejectedReplace.uk);
assert.deepEqual(getRouteList('world'), beforeRejectedReplace.world);
assert.equal(applyRouteBackup(backup, 'merge').valid, true);
const merged = getRouteList('uk');
const ids = merged.map(route => route.id);
assert.equal(new Set(ids).size, ids.length);
const importedWalked = merged.find(route => route.name === 'Legacy — Walked' && route.id !== walked.id);
const importedParent = merged.find(route => route.name === 'Renamed' && route.id !== legacy.id);
assert(importedWalked && importedParent);
assert.equal(importedWalked.sourceRouteId, importedParent.id);

assert.equal(applyRouteBackup(backup, 'replace').valid, true);
const replaced = getRouteList('uk');
assert.equal(replaced.find(route => route.id === walked.id).sourceRouteId, legacy.id);
console.log('route identity tests passed');
