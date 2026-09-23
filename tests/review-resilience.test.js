const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync('js/map.js', 'utf8');
const routesSource = fs.readFileSync('js/routes.js', 'utf8');

// Exercise real lifecycle functions without booting/mocking two Leaflet maps.
function functions(names, context) {
  context.window = context;
  vm.createContext(context);
  for (const name of names) {
    let start = source.indexOf(`function ${name}(`);
    assert(start >= 0, name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  return context;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test('a cancelled path request cannot overwrite a new draft with the same request number', async () => {
  const old = deferred(), fresh = deferred();
  const c = functions(['requestPathRoute', 'clearPathDraft'], {
    CONFIG: { orsApiKey: 'test-only-placeholder' }, AbortController,
    pathDraft: { waypoints: [[0,0],[1,1]], requestId: 0 },
    routeDraftLayerUK: { clearLayers() {} }, routeDraftLayerWorld: { clearLayers() {} },
    showRoutePanelContent() {}, renderPathDraft() {},
    requestOrsFootHikingRoute: () => old.promise
  });
  const first = c.requestPathRoute();
  const signal = c.pathDraft.controller.signal;
  c.clearPathDraft();
  assert(signal.aborted);
  c.pathDraft = { waypoints: [[2,2],[3,3]], requestId: 0 };
  c.requestOrsFootHikingRoute = () => fresh.promise;
  const second = c.requestPathRoute();
  old.resolve({ old: true }); await first;
  assert.equal(c.pathDraft.geojson, undefined);
  assert.equal(c.pathDraft.waiting, true);
  fresh.resolve({ fresh: true }); await second;
  assert.equal(c.pathDraft.geojson.fresh, true);
  assert.equal(c.pathDraft.waiting, false);
});

test('undo removes a route preview before a failed reroute', () => {
  const c = functions(['undoPathWaypoint'], {
    pathDraft: { waypoints: [1,2,3], geojson: { old: true } },
    renderPathDraft() {}, requestPathRoute() {}, showRoutePanelContent() {}
  });
  c.undoPathWaypoint();
  assert.equal(c.pathDraft.geojson, null);
  assert.equal(c.pathDraft.waypoints.length, 2);
});

test('late wake lock is released and concurrent acquisition is suppressed', async () => {
  const pending = deferred(); let calls = 0, released = 0;
  let live = {};
  const c = functions(['requestNavigationWakeLock', 'releaseNavigationWakeLock'], {
    navigationWakeLock: null, navigationWakeLockRequest: null,
    getLiveLocationSession: () => live,
    navigator: { wakeLock: { request() { calls++; return pending.promise; } } }
  });
  const request = c.requestNavigationWakeLock();
  await c.requestNavigationWakeLock(); assert.equal(calls, 1);
  live = null; c.releaseNavigationWakeLock();
  pending.resolve({ async release() { released++; } }); await request;
  assert.equal(released, 1); assert.equal(c.navigationWakeLock, null);
});

test('walked track save finishes once, and quota failure preserves retryable summary', () => {
  const summary = { mode: 'uk', plannedRoute: { id: 'planned' }, recording: { points: [{},{}] } };
  let saves = 0, errors = 0;
  const c = functions(['saveNavigationTrack'], {
    navigationSummary: summary,
    FieldMapsLiveLocation: { recordingGeoJSON: () => ({}) },
    L: { geoJSON: () => ({}) }, activityFromRecording: () => ({}),
    saveRouteToList() { throw new Error('QuotaExceededError'); },
    showRecordingSaveError() { errors++; }, showRoutePanelContent() {}, updateRouteFabLabel() {}
  });
  assert.equal(c.saveNavigationTrack('Test'), false);
  assert.equal(c.navigationSummary, summary); assert.equal(errors, 1);
  c.saveRouteToList = () => { saves++; return 0; };
  assert.equal(c.saveNavigationTrack('Test'), true);
  assert.equal(c.navigationSummary, null);
  assert.equal(c.saveNavigationTrack('Test'), false); assert.equal(saves, 1);
});

test('pause control reads current session state, refresh updates label and heading', () => {
  let status = 'recording';
  const elements = new Map();
  const c = functions(['showTrackRecording', 'refreshTrackUI'], {
    trackRecording: { follow: true, ready: true, session: { getRecording: () => ({status}) } },
    panel: { classList: { remove() {} }, setAttribute() {} },
    panelContent: { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, {}); return elements.get(selector); } },
    trackMetricsMarkup: () => '', renderLiveLocationOverlays() {}, updateNavigationPeek() {},
    pauseTrackRecording() { status = 'paused'; }, resumeTrackRecording() { status = 'recording'; }, finishTrackRecording() {}
  });
  c.showTrackRecording();
  const button = elements.get('#track-pause');
  button.onclick(); c.refreshTrackUI();
  assert.equal(button.textContent, 'Resume');
  assert.equal(elements.get('.route-title').textContent, 'Recording paused');
  button.onclick(); c.refreshTrackUI();
  assert.equal(status, 'recording'); assert.equal(button.textContent, 'Pause');
});

test('route metrics handle disconnected MultiLineString segments without joining the gap', () => {
  const c = functions(['getRouteMetrics','calculateRouteWalkingTime','getRouteElevationSummary'], {});
  vm.runInContext(routesSource, c);
  const line = { type: 'MultiLineString', coordinates: [[[-1,51],[-0.99,51]],[[0,51],[0.01,51]]] };
  const result = c.getRouteMetrics(line);
  assert.equal(result.km, '1.40');
  assert.equal(c.getRouteMetrics({type:'FeatureCollection',features:[]}).km, '');
});

test('elevation rejects a replacement route even when it has identical geometry', async () => {
  const pending = deferred();
  const data = new Map();
  const c = { window: null, AbortController, setTimeout, clearTimeout,
    CONFIG: { orsApiKey: 'test-only-placeholder' }, fetch: () => pending.promise,
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value) }
  };
  c.window = c; vm.createContext(c); vm.runInContext(routesSource,c);
  const geometry = {type:'LineString',coordinates:[[-1,51],[-0.99,51]]};
  data.set('routeList_uk',JSON.stringify([{id:'old',geojson:geometry}]));
  const request = c.fetchRouteElevation('uk',0);
  data.set('routeList_uk',JSON.stringify([{id:'replacement',geojson:geometry}]));
  pending.resolve({ok:true,json: async () => ({geometry:{type:'LineString',coordinates:[[-1,51,10],[-0.99,51,20]]}})});
  await assert.rejects(request,/Route changed/);
  assert.equal(JSON.parse(data.get('routeList_uk'))[0].elevation,undefined);
});

test('empty geometries are invalid and failed legacy ID writes do not abort initialization', () => {
  const c = { window:null, localStorage:{ getItem: () => '[{"name":"Legacy"}]', setItem(){ throw new Error('quota'); } } };
  c.window=c; vm.createContext(c); vm.runInContext(routesSource,c);
  assert.equal(c.hasValidRouteCoordinates({type:'FeatureCollection',features:[]}),false);
  assert.equal(c.hasValidRouteCoordinates({type:'MultiLineString',coordinates:[]}),false);
});

test('UK zoom mapping preserves valid zero and tile maximum fits the CRS', () => {
  const c = functions(['getEquivalentUKZoom'], {});
  assert.equal(c.getEquivalentUKZoom(7),0);
  vm.runInContext(fs.readFileSync('js/layers.js','utf8') + '\nthis.maximum=UK_BASE_MAX_ZOOM;',c);
  assert.equal(c.maximum,13);
  assert(!source.includes('L.Handler.prototype._onTouch'));
});

test('finishing while paused then resuming does not leave the recording clock frozen', () => {
  let now=1000, watch;
  const c={window:null,Date:{now:()=>now}, navigator:{geolocation:{watchPosition(ok){watch=ok;return 1;},clearWatch(){}}}};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/live-location.js','utf8'),c);
  const session=c.FieldMapsLiveLocation.createSession();
  session.startRecording();now=2000;session.pauseRecording();now=3000;session.finishRecording();
  now=4000;session.resumeFinishedRecording();now=5000;
  assert.equal(session.getRecording().elapsed,2000);
  session.cancelRecording();
});

test('a fresh GPS session accepts the same location as the previous session', () => {
  let success;
  const c={window:null,Date,navigator:{geolocation:{watchPosition(ok){success=ok;return 1;},clearWatch(){}}},distanceBetweenCoordinates:()=>0};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/live-location.js','utf8'),c);
  const first=c.FieldMapsLiveLocation.createSession();first.start();
  const fix={coords:{latitude:51,longitude:-1,accuracy:5},timestamp:1000};success(fix);first.stop();
  const second=c.FieldMapsLiveLocation.createSession();second.start();success(fix);
  assert.equal(second.getState().latestPosition.lat,51);second.stop();
});

test('GPX export escapes route names containing XML text characters', () => {
  const c=functions(['routeGeojsonToGpx'],{L:{geoJSON:()=>({eachLayer(){}})}});
  assert(c.routeGeojsonToGpx('A & B <loop>',{}).includes('<name>A &amp; B &lt;loop&gt;</name>'));
});

test('provider labels are passed to Leaflet as text content', () => {
  let tooltip;
  const c=functions(['showSearchResultMarker'],{
    searchResultLayerUK:{clearLayers(){},addLayer(){}},searchResultLayerWorld:{},
    document:{createElement:()=>({textContent:''})},
    L:{divIcon:()=>({}),marker:()=>({bindTooltip(label){tooltip=label;}})}
  });
  c.showSearchResultMarker('uk',{lat:51,lng:-1,label:'<img src=x onerror=alert(1)>'});
  assert.equal(typeof tooltip,'object');assert.equal(tooltip.textContent,'<img src=x onerror=alert(1)>');
});

test('shared routes validate legacy geometry, routed waypoints and annotation records', () => {
  const c=functions(['validateSharedRoute','isOrsRoutedRoute','lineCoordinatesToGeojson'],{});
  vm.runInContext(routesSource,c);
  const check=value=>vm.runInContext(`validateSharedRoute(${JSON.stringify(value)})`,c);
  const valid={name:'Shared',geojson:{type:'LineString',coordinates:[[-1,51],[-0.9,51]]}};
  assert(check(valid));
  assert.equal(check({...valid,geojson:{type:'LineString',coordinates:[[-1,91],[-0.9,51]]}}),null);
  assert.equal(check({...valid,annotations:[null]}),null);
  assert.equal(check({...valid,name:{unexpected:true}}),null);
  assert(check({name:'Routed',routing:{provider:'ors',profile:'foot-hiking',waypoints:[[-1,51],[-0.9,51]]}}));
  assert.equal(check({routing:{provider:'ors',profile:'foot-hiking',waypoints:[[-1,51],[-0.9,91]]}}),null);
});
