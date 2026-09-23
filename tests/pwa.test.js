const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function workerEnvironment() {
  const handlers = new Map();
  const contents = new Map([
    ['field-maps-app-old', new Map()], ['field-maps-app-__FIELD_MAPS_BUILD_ID__',new Map()],
    ['field-maps-offline-os-test',new Map()], ['unrelated',new Map()]
  ]);
  let requested = [], failBatch = false;
  const context = { URL, Request, console, FieldMapsOfflineMaps: null,
    self: { location: new URL('https://test.invalid/sw.js'), clients: { claim: async () => {} },
      addEventListener: (event,handler) => handlers.set(event,handler) },
    caches: { keys: async () => [...contents.keys()], delete: async key => contents.delete(key),
      open: async key => ({
        async addAll(assets) { requested = assets; if (failBatch) throw new Error('offline'); },
        async match(url) { return contents.get(key)?.get(url); }
      })
    }, fetch: async () => { throw new Error('offline'); },
    importScripts() { vm.runInContext(fs.readFileSync('js/offline-maps.js','utf8'), context); }
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('sw.template.js','utf8'),context);
  return { handlers, contents, get requested(){return requested;}, fail(){failBatch=true;} };
}

test('service worker activation only removes obsolete application caches', async () => {
  const env=workerEnvironment(); let completion;
  env.handlers.get('activate')({waitUntil(promise){completion=promise;}}); await completion;
  assert(!env.contents.has('field-maps-app-old'));
  assert(env.contents.has('field-maps-offline-os-test')); assert(env.contents.has('unrelated'));
});

test('app refresh bypasses HTTP cache, excludes runtime config and preserves all caches on failure', async () => {
  const env=workerEnvironment(); let completion,reply;
  const event={data:{type:'REFRESH_APP_FILES'}, ports:[{postMessage(value){reply=value;}}],waitUntil(promise){completion=promise;}};
  env.handlers.get('message')(event); await completion;
  assert.equal(reply.ok,true);
  assert(env.requested.length>30);
  assert(env.requested.every(request=>request.cache==='reload' && !request.url.includes('config.runtime.js')));
  const names=[...env.contents.keys()]; env.fail();
  env.handlers.get('message')(event); await completion;
  assert.equal(reply.ok,false); assert.deepEqual([...env.contents.keys()],names);
});

test('runtime configuration bypasses the worker; offline tiles only use explicit OS packs', async () => {
  const env=workerEnvironment(); let response;
  env.handlers.get('fetch')({request:new Request('https://test.invalid/config.runtime.js'),respondWith(){throw new Error('runtime config intercepted');}});
  const tile='https://api.os.uk/maps/raster/v1/zxy/Road_27700/9/1/2.png';
  env.contents.get('field-maps-offline-os-test').set(tile,'managed-tile');
  env.handlers.get('fetch')({request:new Request(tile+'?key=test-placeholder'),respondWith(promise){response=promise;}});
  assert.equal(await response,'managed-tile');
});

test('only the configured deployment workflow may publish Pages', () => {
  const workflows=fs.readdirSync('.github/workflows').map(name=>fs.readFileSync('.github/workflows/'+name,'utf8'));
  const deployers=workflows.filter(text=>text.includes('actions/deploy-pages'));
  assert.equal(deployers.length,1);
  assert(deployers[0].includes('Generate runtime config'));
  assert(deployers[0].includes('Generate versioned service worker'));
});

test('an update activated by another tab does not reload unsaved work without confirmation', async () => {
  const nodes=new Map(), events=new Map();let reloads=0,confirm=false;
  const element=()=>({hidden:true,textContent:'',listeners:{},querySelector(){return this.label ||= element();},
    addEventListener(type,handler){this.listeners[type]=handler;}});
  const registration={waiting:{},active:{},addEventListener(){}};
  const serviceWorker={controller:{},register:async()=>registration,addEventListener(type,handler){events.set(type,handler);}};
  const context={window:null,CONFIG:{apiKey:'test-placeholder',orsApiKey:'test-placeholder'},
    document:{getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}},
    navigator:{serviceWorker},location:{reload(){reloads++;}},
    addEventListener(type,handler){events.set(type,handler);},dispatchEvent(){},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},
    FieldMapsHasLiveSession:()=>true,confirm:()=>confirm
  };
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('js/pwa.js','utf8'),context);
  events.get('load')();await new Promise(setImmediate);
  registration.waiting=null;serviceWorker.controller={};events.get('controllerchange')();
  assert.equal(reloads,0);assert.equal(nodes.get('app-update-now').textContent,'Reload');
  assert.equal(nodes.get('app-update-notice').hidden,false);
  await nodes.get('app-update-now').listeners.click();assert.equal(reloads,0);
  confirm=true;await nodes.get('app-update-now').listeners.click();assert.equal(reloads,1);
  assert.equal(context.FieldMapsPwa.shouldOfferConfigReload(true,true),true);
  assert.equal(context.FieldMapsPwa.shouldOfferConfigReload(false,true),false);
});
