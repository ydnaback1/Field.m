const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('js/routes.js', 'utf8');
const geometry = { type: 'LineString', coordinates: [[-1, 51], [-0.9, 51]] };
const route = { id: 'route-1', name: 'Original', geojson: geometry, annotations: [] };

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  const storage = {
    values,
    readError: null,
    writeError: null,
    failOnWrite: null,
    get writes() { return writes; },
    getItem(key) { if (this.readError) throw this.readError; return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      writes++;
      if (this.writeError || writes === this.failOnWrite) throw this.writeError || Object.assign(new Error('denied'), { name: 'SecurityError' });
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
  return storage;
}

function load(storage) {
  const context = { window: null, localStorage: storage, console: { warn() {} } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function domError(name) { return Object.assign(new Error(name), { name }); }

test('missing and malformed stores remain distinct, and damage is per map', () => {
  const bad = '{"recoverable":';
  const store = fakeStorage({ routeList_uk: bad, routeList_world: '[]' });
  const routes = load(store);
  assert.equal(routes.readRouteStorage('uk').code, 'malformed');
  assert.equal(routes.readRouteStorage('world').ok, true);
  assert.equal(routes.saveRouteToList('uk', 'New', { toGeoJSON: () => geometry }), null);
  assert.equal(store.values.get('routeList_uk'), bad);
  assert.equal(routes.saveRouteToList('world', 'New', { toGeoJSON: () => geometry }), 0);
  assert.equal(JSON.parse(store.values.get('routeList_world')).length, 1);
  store.values.delete('routeList_uk');
  const missing = routes.readRouteStorage('uk');
  assert.equal(missing.ok, true);
  assert.equal(missing.routes.length, 0);
  assert.equal(missing.raw, null);
});

test('blocked reads and quota or security writes are structured and retain raw values', () => {
  const raw = JSON.stringify([route]);
  const store = fakeStorage({ routeList_uk: raw });
  const routes = load(store);
  store.readError = domError('SecurityError');
  assert.equal(routes.readRouteStorage('uk').code, 'blocked');
  assert.equal(routes.renameRouteInList('uk', 0, 'Changed'), false);
  store.readError = null;
  for (const name of ['QuotaExceededError', 'SecurityError']) {
    store.writeError = domError(name);
    assert.equal(routes.renameRouteInList('uk', 0, 'Changed'), false);
    assert.equal(routes.getRouteStorageError('uk').code, name === 'QuotaExceededError' ? 'quota' : 'blocked');
    assert.equal(store.values.get('routeList_uk'), raw);
  }
});

test('new route, geometry edit, rename, delete, and note writes fail without changing the stored list', () => {
  const raw = JSON.stringify([route]);
  const store = fakeStorage({ routeList_uk: raw });
  const routes = load(store);
  store.writeError = domError('QuotaExceededError');
  const layer = { toGeoJSON: () => geometry };
  const edited = { type: 'LineString', coordinates: [[-1, 51], [-0.8, 51]] };
  const note = { id: 'note-1', lat: 51, lng: -1, title: 'Gate', note: 'Open' };
  assert.equal(routes.saveRouteToList('uk', 'Draft', layer), null);
  assert.equal(routes.updateRouteInList('uk', 0, edited), false);
  assert.equal(routes.renameRouteInList('uk', 0, 'Changed'), false);
  assert.equal(routes.deleteRouteFromList('uk', 0), false);
  assert.equal(routes.saveRouteAnnotation('uk', 0, note), false);
  assert.equal(store.values.get('routeList_uk'), raw);
  assert.equal(routes.getRouteList('uk').length, 1);
  store.writeError = null;
  assert.equal(routes.saveRouteToList('uk', 'Draft', layer), 1);
  assert.equal(routes.getRouteList('uk').length, 2);
  assert.equal(routes.getRouteList('uk')[0].id, 'route-1');
});

test('backup second-key failure restores exact prior UK raw data', () => {
  const ukRaw = JSON.stringify([route]);
  const worldRaw = '[]';
  const store = fakeStorage({ routeList_uk: ukRaw, routeList_world: worldRaw });
  const routes = load(store);
  const backup = routes.exportRouteBackup();
  store.failOnWrite = store.writes + 2;
  const result = routes.applyRouteBackup(backup, 'replace');
  assert.equal(result.valid, false);
  assert.equal(result.rollbackFailed, false);
  assert.equal(store.values.get('routeList_uk'), ukRaw);
  assert.equal(store.values.get('routeList_world'), worldRaw);
});

test('backup reports a failed rollback without claiming restoration', () => {
  const store = fakeStorage({ routeList_uk: '[]', routeList_world: '[]' });
  const routes = load(store);
  const backup = routes.exportRouteBackup();
  const first = store.writes;
  const originalSet = store.setItem.bind(store);
  store.setItem = (key, value) => {
    if (store.writes >= first + 1) { store.failOnWrite = store.writes + 1; }
    return originalSet(key, value);
  };
  const result = routes.applyRouteBackup(backup, 'replace');
  assert.equal(result.valid, false);
  assert.equal(result.rollbackFailed, true);
  assert.match(result.error, /could not be restored/);
});

test('explicit reset affects only a malformed map key', () => {
  const store = fakeStorage({ routeList_uk: 'broken {', routeList_world: JSON.stringify([route]), preference: 'keep' });
  const routes = load(store);
  assert.equal(routes.resetDamagedRouteStorage('uk').ok, true);
  assert.equal(store.values.get('routeList_uk'), '[]');
  assert.equal(store.values.get('routeList_world'), JSON.stringify([route]));
  assert.equal(store.values.get('preference'), 'keep');
  assert.equal(routes.resetDamagedRouteStorage('uk').code, 'not-damaged');
});

test('legacy IDs migrate only valid lists and a failed migration write preserves the original', () => {
  const legacy = JSON.stringify([{ name: 'Legacy', geojson: geometry }]);
  const store = fakeStorage({ routeList_uk: legacy, routeList_world: 'broken [' });
  store.writeError = domError('QuotaExceededError');
  const routes = load(store);
  assert.equal(store.values.get('routeList_uk'), legacy);
  assert.equal(store.values.get('routeList_world'), 'broken [');
  store.writeError = null;
  routes.migrateStoredRouteIds();
  assert.equal(typeof JSON.parse(store.values.get('routeList_uk'))[0].id, 'string');
  assert.equal(store.values.get('routeList_world'), 'broken [');
});

test('backup merge refuses malformed current data while explicit replace can recover it', () => {
  const raw = 'broken [ original';
  const store = fakeStorage({ routeList_uk: raw, routeList_world: '[]' });
  const routes = load(store);
  const backup = vm.runInContext('(' + JSON.stringify({ type: 'field-maps-route-backup', version: 1, routes: { uk: [route], world: [] } }) + ')', routes);
  const merge = routes.applyRouteBackup(backup, 'merge');
  assert.equal(merge.valid, false);
  assert.equal(merge.code, 'malformed');
  assert.equal(store.values.get('routeList_uk'), raw);
  const replace = routes.applyRouteBackup(backup, 'replace');
  assert.equal(replace.valid, true);
  assert.equal(JSON.parse(store.values.get('routeList_uk'))[0].name, 'Original');
});
