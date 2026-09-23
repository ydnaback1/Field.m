// Explicit OS raster packs. The same canonical tile identity is used by the page and service worker.
(() => {
  const DB_NAME = 'field-maps-offline';
  const STORE = 'packs';
  const CACHE_PREFIX = 'field-maps-offline-os-';
  const TILE_LIMIT = 2000;
  const CONCURRENCY = 4;
  const ROUTE_PADDING_METERS = 1000;
  const STYLES = { Road_27700: 'Road', Outdoor_27700: 'Outdoor', Leisure_27700: 'Leisure' };
  let active = null;
  let activeProgress = null;

  function canonicalizeOsTileUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (url.origin !== 'https://api.os.uk' ||
        !/^\/maps\/raster\/v1\/zxy\/(Road|Outdoor|Leisure)_27700\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) return null;
    return url.origin + url.pathname;
  }

  function enumerateTiles(bounds, minZoom, maxZoom, crs, tileSize) {
    if (!bounds || !Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom > maxZoom ||
        !Number.isFinite(tileSize) || tileSize <= 0) throw new Error('Invalid offline map area.');
    const corners = [
      { lat: bounds.south, lng: bounds.west }, { lat: bounds.south, lng: bounds.east },
      { lat: bounds.north, lng: bounds.west }, { lat: bounds.north, lng: bounds.east }
    ];
    if (corners.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) ||
        bounds.south >= bounds.north || bounds.west >= bounds.east) throw new Error('Invalid offline map area.');
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const points = corners.map(p => crs.latLngToPoint(p, z));
      const west = Math.floor(Math.min(...points.map(p => p.x)) / tileSize);
      const east = Math.ceil(Math.max(...points.map(p => p.x)) / tileSize) - 1;
      const north = Math.floor(Math.min(...points.map(p => p.y)) / tileSize);
      const south = Math.ceil(Math.max(...points.map(p => p.y)) / tileSize) - 1;
      for (let y = north; y <= south; y++) for (let x = west; x <= east; x++) {
        tiles.push({ z, x, y });
        if (tiles.length > TILE_LIMIT) return tiles;
      }
    }
    return tiles;
  }

  function zoomPolicy(layer, detailPreset) {
    if (!STYLES[layer] || !['standard', 'detailed'].includes(detailPreset) ||
        (layer === 'Leisure_27700' && detailPreset === 'detailed')) return null;
    return { minZoom: 5, maxZoom: detailPreset === 'detailed' ? 10 : 9 };
  }

  function routeBounds(coordinates, project, unproject) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('Invalid route geometry.');
    const points = coordinates.map(point => {
      if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
          point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) throw new Error('Invalid route geometry.');
      return project(point);
    });
    if (points.some(point => !Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)))
      throw new Error('Invalid route geometry.');
    const west = Math.min(...points.map(p => p[0])) - ROUTE_PADDING_METERS;
    const east = Math.max(...points.map(p => p[0])) + ROUTE_PADDING_METERS;
    const south = Math.min(...points.map(p => p[1])) - ROUTE_PADDING_METERS;
    const north = Math.max(...points.map(p => p[1])) + ROUTE_PADDING_METERS;
    const corners = [[west, south], [west, north], [east, south], [east, north]].map(unproject);
    if (corners.some(point => !Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)))
      throw new Error('Invalid route geometry.');
    return { west: Math.min(...corners.map(p => p[0])), east: Math.max(...corners.map(p => p[0])),
      south: Math.min(...corners.map(p => p[1])), north: Math.max(...corners.map(p => p[1])) };
  }

  function matchingPack(packs, selection) {
    return packs.find(pack => (pack.sourceRouteId || null) === (selection.sourceRouteId || null) && pack.layer === selection.layer &&
      pack.minZoom === selection.minZoom && pack.maxZoom === selection.maxZoom &&
      pack.bounds && ['west', 'east', 'south', 'north'].every(key =>
        Math.abs(pack.bounds[key] - selection.bounds[key]) < 1e-7));
  }

  function visibleAreaBounds(topLeft, bottomRight) {
    const points = [topLeft, bottomRight];
    if (points.some(point => !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)))
      throw new Error('Current visible map area is unavailable.');
    const bounds = { west: Math.min(...points.map(p => p.lng)), east: Math.max(...points.map(p => p.lng)),
      south: Math.min(...points.map(p => p.lat)), north: Math.max(...points.map(p => p.lat)) };
    if (bounds.west >= bounds.east || bounds.south >= bounds.north) throw new Error('Current visible map area is unavailable.');
    return bounds;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
    const units = ['bytes', 'KB', 'MB', 'GB'];
    let value = bytes; let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return (unit ? (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) : Math.round(value)) + ' ' + units[unit];
  }

  function packPresentation(pack, routes, calculateRouteBounds) {
    const route = pack.sourceRouteId && routes.find(item => item?.id === pack.sourceRouteId);
    let annotation = '';
    if (pack.sourceRouteId && !route) annotation = 'Route deleted';
    else if (route && calculateRouteBounds && pack.bounds) {
      try {
        if (!matchingPack([{ ...pack, bounds: calculateRouteBounds(route) }], pack)) annotation = 'Route changed';
      } catch (_) { /* An old or invalid route should not hide its map. */ }
    }
    return { name: route?.name || pack.name || (pack.sourceRouteId ? 'Offline route map' : 'Offline area — ' + packLabel(pack)),
      detail: pack.detailPreset === 'detailed' || (!pack.detailPreset && pack.maxZoom >= 10) ? 'Detailed' : 'Standard',
      annotation, complete: pack.status === 'complete' };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, work) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  const listPacks = () => withStore('readonly', store => store.getAll());
  const savePack = pack => withStore('readwrite', store => store.put(pack));
  const removePack = id => withStore('readwrite', store => store.delete(id));

  function friendlyError(error) {
    if (error?.name === 'QuotaExceededError') return 'Storage is full. Download paused; stored tiles are kept.';
    return 'Download interrupted. Stored tiles are kept; resume when ready.';
  }

  function tileUrls(layer, tile) {
    // Leaflet getTileUrl() uses the layer's current display zoom, which is not
    // necessarily the native zoom being downloaded. Reuse its URL template.
    const network = L.Util.template(layer._url, tile);
    const canonical = canonicalizeOsTileUrl(network);
    if (!canonical) throw new Error('OS tile URL unavailable.');
    return { network, canonical };
  }

  async function download(pack, layer, crs, tileSize, hasKey, progress) {
    if (active) throw new Error('A download is already running.');
    if (!hasKey || navigator.onLine === false) throw new Error('Connect to the internet to download another map.');
    const tiles = enumerateTiles(pack.bounds, pack.minZoom, pack.maxZoom, crs, tileSize);
    if (tiles.length > TILE_LIMIT) throw new Error('This area is too large at the selected detail. Zoom in or choose Standard detail.');
    const controller = new AbortController();
    active = controller;
    activeProgress = { id: pack.id, done: pack.completedTileCount || 0, total: tiles.length };
    let done = 0;
    let index = 0;
    let firstError = null;
    try {
      pack.status = 'downloading';
      pack.tileCount = tiles.length;
      pack.updatedAt = new Date().toISOString();
      await savePack(pack);
      const cache = await caches.open(pack.cacheName);
      const worker = async () => {
        while (!controller.signal.aborted && !firstError) {
          const tile = tiles[index++];
          if (!tile) break;
          try {
            const { network, canonical } = tileUrls(layer, tile);
            if (!(await cache.match(canonical))) {
              // Leaflet's image requests are no-cors; opaque responses are renderable and cacheable.
              const response = await fetch(network, { mode: 'no-cors', signal: controller.signal });
              if (!response.ok && response.type !== 'opaque') throw new Error('Tile request failed.');
              await cache.put(canonical, response);
            }
            done++;
            activeProgress.done = done;
            progress(done, tiles.length);
            if (done % 20 === 0) {
              pack.completedTileCount = done;
              pack.updatedAt = new Date().toISOString();
              await savePack(pack);
            }
          } catch (error) {
            if (!controller.signal.aborted && !firstError) { firstError = error; controller.abort(); }
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      // Cache contents, rather than a progress counter, determine resumability.
      let completed = 0;
      for (const tile of tiles) if (await cache.match(tileUrls(layer, tile).canonical)) completed++;
      pack.completedTileCount = completed;
      pack.status = completed === tiles.length ? 'complete' : 'incomplete';
      pack.updatedAt = new Date().toISOString();
      await savePack(pack);
      if (firstError) throw new Error(friendlyError(firstError));
      return pack;
    } catch (error) {
      if (pack.status === 'downloading') {
        pack.status = 'incomplete';
        pack.updatedAt = new Date().toISOString();
        try { await savePack(pack); } catch (_) { /* Keep original storage error. */ }
      }
      throw error;
    } finally { active = null; activeProgress = null; }
  }

  function cancel() { active?.abort(); }

  async function deletePack(pack) {
    if (active) throw new Error('Cancel the active download first.');
    // Keep metadata until cache removal succeeds, so a failed deletion is retryable.
    if (!(await caches.delete(pack.cacheName)) && (await caches.keys()).includes(pack.cacheName))
      throw new Error('Could not remove stored tiles. Try again.');
    try { await removePack(pack.id); }
    catch (_) { throw new Error('Tiles removed, but pack record remains. Try Delete again.'); }
  }

function packLabel(pack) {
    return STYLES[pack.layer] || 'OS map';
  }

  async function runPack(pack, context, notice, buttons, after) {
    if (active) return;
    const layer = context.layers[pack.layer];
    if (!layer) { notice.textContent = 'This OS map layer is unavailable.'; return; }
    try {
      buttons.forEach(button => { button.disabled = true; });
      notice.textContent = 'Downloading ' + packLabel(pack) + ' · 0 / ' + pack.tileCount + ' tiles';
      const result = await download(pack, layer, context.crs, layer.getTileSize().x, context.hasKey(),
        (done, total) => { if (notice.isConnected) notice.textContent = 'Downloading ' + packLabel(pack) + ' · ' + done + ' / ' + total + ' tiles'; });
      if (notice.isConnected) notice.textContent = result.status === 'complete'
        ? 'Offline map ready · ' + result.completedTileCount + ' / ' + result.tileCount + ' tiles'
        : 'Download cancelled. Stored tiles are kept.';
    } catch (error) {
      if (notice.isConnected) notice.textContent = error.message || 'Download interrupted. Stored tiles are kept.';
    } finally {
      buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
      await after();
    }
  }

  async function render(container, context) {
    container.innerHTML = '<div class="panel-navigation"><button id="back-to-settings-from-offline" class="panel-back" type="button">‹ Settings</button></div>' +
      '<div class="panel-heading workflow-heading"><div class="panel-eyebrow">Settings</div><h2 class="route-title">Offline maps</h2></div>' +
      '<section class="route-backup-section"><button id="offline-current-area" class="primary-action" type="button">Download current area</button>' +
      '<p id="offline-connectivity" class="panel-hint"></p></section>' +
      '<section class="route-backup-section"><h3>Storage</h3><p id="offline-storage" class="panel-hint">Checking browser storage…</p>' +
      '<p class="panel-hint">Browser estimates include cache accounting; quota is not guaranteed device space.</p></section>' +
      '<section class="route-backup-section"><h3>Downloaded maps</h3><div id="offline-pack-list"></div><p id="offline-notice" class="route-backup-notice" role="status"></p></section>';
    container.querySelector('#back-to-settings-from-offline').onclick = context.back;
    const notice = container.querySelector('#offline-notice');
    const connectivity = container.querySelector('#offline-connectivity');
    const updateConnectivity = () => { if (connectivity.isConnected) connectivity.textContent = navigator.onLine === false
      ? "You're offline. Downloaded maps remain available." : 'Offline maps ready for use without a connection.'; };
    updateConnectivity();
    window.addEventListener('online', updateConnectivity, { once: true });
    window.addEventListener('offline', updateConnectivity, { once: true });
    const refreshStorage = async () => {
      const target = container.querySelector('#offline-storage');
      if (!target) return;
      try {
        const estimate = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        if (!target.isConnected) return;
        const approximate = value => Number.isFinite(value) ? '~' + formatSize(value) : 'Unknown';
        target.textContent = 'Used by Field Maps: ' + approximate(estimate?.usage) + '\n' +
          'Browser quota: ' + approximate(estimate?.quota) + '\n' +
          'Persistent storage: ' + (typeof persisted === 'boolean' ? (persisted ? 'Yes' : 'No') : 'Unknown');
      } catch (_) { if (target.isConnected) target.textContent = 'Browser storage information unavailable.\nPersistent storage: Unknown'; }
    };
    container.querySelector('#offline-current-area').onclick = () => context.currentArea();
    const refresh = async () => {
      const target = container.querySelector('#offline-pack-list');
      if (!target) return;
      try {
        const packs = await listPacks();
        target.replaceChildren();
        if (!packs.length) { target.textContent = 'No offline maps stored yet.'; return; }
        const routes = context.routes();
        for (const pack of packs.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))) {
          const row = document.createElement('div');
          row.className = 'offline-pack-row';
          const presentation = packPresentation(pack, routes, context.routeBounds);
          const title = document.createElement('strong'); title.textContent = presentation.name; row.append(title);
          const meta = document.createElement('span'); meta.textContent = packLabel(pack) + ' · ' + presentation.detail; row.append(meta);
          const status = document.createElement('span'); status.textContent = presentation.complete
            ? 'Complete · ' + (pack.tileCount || pack.completedTileCount || 0) + ' tiles'
            : 'Incomplete · ' + (pack.completedTileCount || 0) + ' / ' + (pack.tileCount || 0) + ' tiles'; row.append(status);
          if (presentation.annotation) { const flag = document.createElement('span'); flag.textContent = presentation.annotation; row.append(flag); }
          const actions = document.createElement('div'); actions.className = 'offline-pack-actions'; row.append(actions);
          const view = document.createElement('button'); view.type = 'button'; view.className = 'secondary-action'; view.textContent = 'View';
          view.setAttribute('aria-label', 'View ' + presentation.name); view.onclick = () => context.view(pack); actions.append(view);
          if (pack.status !== 'complete') {
            const resume = document.createElement('button');
            resume.type = 'button'; resume.className = 'secondary-action'; resume.textContent = 'Resume';
            resume.disabled = Boolean(active) || !context.hasKey() || navigator.onLine === false;
            resume.setAttribute('aria-label', 'Resume ' + presentation.name);
            resume.onclick = () => runPack(pack, context, notice, [resume], async () => { await refresh(); await refreshStorage(); });
            actions.append(resume);
          }
          const remove = document.createElement('button');
          remove.type = 'button'; remove.className = 'secondary-action'; remove.textContent = 'Delete';
          remove.setAttribute('aria-label', 'Delete ' + presentation.name);
          remove.disabled = Boolean(active);
          remove.onclick = async () => {
            if (!window.confirm('Delete this offline map?')) return;
            try { await deletePack(pack); notice.textContent = 'Offline map deleted.'; await refresh(); await refreshStorage(); }
            catch (error) { notice.textContent = error.message || 'Could not delete offline map.'; }
          };
          actions.append(remove);
          target.append(row);
        }
      } catch (_) { notice.textContent = 'Offline pack storage is unavailable.'; }
    };
    await refreshStorage();
    await refresh();
  }

  async function renderCurrentArea(container, context) {
    container.innerHTML = '<div class="panel-navigation"><button id="offline-area-back" class="panel-back" type="button">‹ Offline maps</button></div>' +
      '<div class="panel-heading workflow-heading"><div class="panel-eyebrow">Offline maps</div><h2 class="route-title">Download current area</h2></div>' +
      '<section class="route-backup-section offline-route-preview"><dl>' +
      '<div><dt>Map</dt><dd><select id="offline-style"><option value="Road_27700">Road</option><option value="Outdoor_27700">Outdoor</option><option value="Leisure_27700">Leisure</option></select></dd></div>' +
      '<div><dt>Detail</dt><dd><label><input type="radio" name="offline-detail" value="standard" checked> Standard</label> <label><input type="radio" name="offline-detail" value="detailed"> Detailed</label></dd></div>' +
      '<div><dt>Area</dt><dd>Current visible map</dd></div></dl>' +
      '<p id="offline-tile-count" class="panel-hint"></p><p id="offline-area-notice" class="route-backup-notice" role="status"></p>' +
      '<div class="route-actions-row"><button id="offline-area-download" class="primary-action" type="button">Download</button>' +
      '<button id="offline-area-view" class="secondary-action" type="button" hidden>View</button>' +
      '<button id="offline-area-delete" class="secondary-action" type="button" hidden>Delete</button>' +
      '<button id="offline-area-cancel" class="panel-action" type="button">Back</button></div></section>';
    container.querySelector('#offline-area-back').onclick = context.back;
    const style = container.querySelector('#offline-style');
    const detailed = container.querySelector('input[value="detailed"]');
    const count = container.querySelector('#offline-tile-count');
    const notice = container.querySelector('#offline-area-notice');
    const downloadButton = container.querySelector('#offline-area-download');
    const viewButton = container.querySelector('#offline-area-view');
    const deleteButton = container.querySelector('#offline-area-delete');
    const cancelButton = container.querySelector('#offline-area-cancel');
    let selection, existing, revision = 0;
    // Capture the viewport once after the drawer has laid out. Changing options must not move the area.
    const areaBounds = await new Promise(resolve => window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => { try { resolve(context.currentBounds()); } catch (_) { resolve(null); } })));
    const update = async () => {
      const current = ++revision;
      selection = existing = null;
      detailed.disabled = style.value === 'Leisure_27700';
      detailed.closest('label').hidden = detailed.disabled;
      if (detailed.disabled && detailed.checked) container.querySelector('input[value="standard"]').checked = true;
      downloadButton.disabled = true; viewButton.hidden = deleteButton.hidden = true;
      cancelButton.textContent = active ? 'Cancel download' : 'Back';
      cancelButton.onclick = active ? cancel : context.back;
      try {
        const bounds = areaBounds;
        if (!bounds) throw new Error('Switch to the UK map to download the current area.');
        const detailPreset = container.querySelector('input[name="offline-detail"]:checked').value;
        const policy = zoomPolicy(style.value, detailPreset);
        const layer = context.layers[style.value];
        const tiles = enumerateTiles(bounds, policy.minZoom, policy.maxZoom, context.crs, layer.getTileSize().x);
        const candidate = { layer: style.value, detailPreset, bounds, minZoom: policy.minZoom, maxZoom: policy.maxZoom, tileCount: tiles.length };
        const match = matchingPack(await listPacks(), candidate);
        if (current !== revision || !count.isConnected) return;
        selection = candidate; existing = match;
        count.textContent = tiles.length > TILE_LIMIT ? 'More than 2,000 tiles' : tiles.length + ' tiles';
        if (!tiles.length || tiles.length > TILE_LIMIT) notice.textContent = 'This area is too large at the selected detail. Zoom in or choose Standard detail.';
        else if (match?.status === 'complete') {
          notice.textContent = 'This area is already downloaded.';
          viewButton.hidden = deleteButton.hidden = false;
          viewButton.onclick = () => context.view(match);
          deleteButton.onclick = async () => {
            if (!window.confirm('Delete this offline map?')) return;
            try { await deletePack(match); await update(); }
            catch (error) { notice.textContent = error.message || 'Could not delete offline map.'; }
          };
        } else if (!context.hasKey() || navigator.onLine === false) notice.textContent = 'Connect to the internet to download another map.';
        else {
          notice.textContent = match ? 'Stored tiles will be kept and missing tiles downloaded.' : 'Keep this page open while downloading.';
          downloadButton.textContent = match ? 'Resume' : 'Download'; downloadButton.disabled = Boolean(active);
        }
      } catch (error) { if (current === revision) { count.textContent = ''; notice.textContent = error.message || 'Current area unavailable.'; } }
    };
    style.value = context.defaultLayer;
    style.onchange = update;
    container.querySelectorAll('input[name="offline-detail"]').forEach(input => { input.onchange = update; });
    downloadButton.onclick = async () => {
      if (!selection || active || existing?.status === 'complete' || !context.hasKey() || navigator.onLine === false) return;
      const pack = existing || (() => {
        const id = crypto.randomUUID(); const now = new Date().toISOString();
        return { id, name: 'Offline area — ' + STYLES[selection.layer], provider: 'os', mapMode: 'uk',
          ...selection, cacheName: CACHE_PREFIX + id, status: 'incomplete', completedTileCount: 0, createdAt: now, updatedAt: now };
      })();
      cancelButton.textContent = 'Cancel download'; cancelButton.onclick = cancel;
      await runPack(pack, context, notice, [downloadButton], async () => {
        const outcome = notice.textContent;
        await update();
        if (notice.isConnected) notice.textContent = pack.status === 'complete'
          ? 'Offline map ready · ' + pack.completedTileCount + ' / ' + pack.tileCount + ' tiles' : outcome;
      });
    };
    await update();
  }

  async function renderRoute(container, context) {
    const route = context.route;
    container.innerHTML = '<div class="panel-navigation"><button id="offline-route-back" class="panel-back" type="button">‹ Route</button></div>' +
      '<div class="panel-heading workflow-heading"><div class="panel-eyebrow">Saved route</div><h2 class="route-title">Offline map</h2></div>' +
      '<section class="route-backup-section offline-route-preview"><dl>' +
      '<div><dt>Route</dt><dd id="offline-route-name"></dd></div>' +
      '<div><dt>Map</dt><dd><select id="offline-style"><option value="Road_27700">Road</option><option value="Outdoor_27700">Outdoor</option><option value="Leisure_27700">Leisure</option></select></dd></div>' +
      '<div><dt>Detail</dt><dd><label><input type="radio" name="offline-detail" value="standard" checked> Standard</label> <label><input type="radio" name="offline-detail" value="detailed"> Detailed</label></dd></div>' +
      '<div><dt>Coverage</dt><dd>Route + 1 km</dd></div></dl>' +
      '<p id="offline-tile-count" class="panel-hint"></p><p id="offline-route-notice" class="route-backup-notice" role="status"></p>' +
      '<div class="route-actions-row"><button id="offline-route-download" class="primary-action" type="button">Download</button>' +
      '<button id="offline-route-cancel" class="panel-action" type="button">Cancel</button></div></section>';
    container.querySelector('#offline-route-back').onclick = context.back;
    container.querySelector('#offline-route-name').textContent = route?.name || 'Untitled route';
    const style = container.querySelector('#offline-style');
    const detailed = container.querySelector('input[value="detailed"]');
    const count = container.querySelector('#offline-tile-count');
    const notice = container.querySelector('#offline-route-notice');
    const downloadButton = container.querySelector('#offline-route-download');
    const cancelButton = container.querySelector('#offline-route-cancel');
    style.value = context.defaultLayer;
    let selection = null;
    let existing = null;
    let revision = 0;
    const update = async () => {
      const current = ++revision;
      selection = null;
      existing = null;
      detailed.disabled = style.value === 'Leisure_27700';
      detailed.closest('label').hidden = detailed.disabled;
      if (detailed.disabled && detailed.checked) container.querySelector('input[value="standard"]').checked = true;
      downloadButton.disabled = true;
      cancelButton.textContent = active ? 'Cancel download' : 'Back';
      cancelButton.onclick = active ? cancel : context.back;
      try {
        if (!route || !route.id || !context.routeExists()) throw new Error('This saved route is no longer available.');
        if (!context.isValid(route.geojson)) throw new Error('This route has invalid geometry.');
        const policy = zoomPolicy(style.value, container.querySelector('input[name="offline-detail"]:checked').value);
        if (!policy) throw new Error('This detail is unavailable for the selected map.');
        const bounds = routeBounds(context.coordinates(route.geojson), context.project, context.unproject);
        const layer = context.layers[style.value];
        const tiles = enumerateTiles(bounds, policy.minZoom, policy.maxZoom, context.crs, layer.getTileSize().x);
        const candidate = { sourceRouteId: route.id, layer: style.value, detailPreset: detailed.checked ? 'detailed' : 'standard',
          routePaddingMeters: ROUTE_PADDING_METERS, bounds, minZoom: policy.minZoom, maxZoom: policy.maxZoom, tileCount: tiles.length };
        const match = matchingPack(await listPacks(), candidate);
        if (current !== revision || !count.isConnected) return;
        selection = candidate;
        existing = match;
        count.textContent = tiles.length + ' tiles';
        if (!tiles.length || tiles.length > TILE_LIMIT) {
          notice.textContent = 'This route area is too large at the selected detail. ' +
            (detailed.checked ? 'Try Standard detail.' : 'Standard detail also exceeds the 2000 tile limit.');
        } else if (active && activeProgress?.id === match?.id) {
          notice.textContent = 'Downloading ' + packLabel(match) + ' · ' + activeProgress.done + ' / ' + activeProgress.total + ' tiles';
          downloadButton.textContent = 'Downloading';
        } else if (match?.status === 'complete') {
          notice.textContent = 'Offline map already downloaded · ' + match.completedTileCount + ' / ' + match.tileCount + ' tiles';
          downloadButton.textContent = 'View status';
          downloadButton.disabled = false;
        } else {
          notice.textContent = match ? 'Stored tiles will be kept and missing tiles downloaded.' : 'Keep this page open while downloading.';
          downloadButton.textContent = match ? 'Resume' : 'Download';
          downloadButton.disabled = Boolean(active);
        }
      } catch (error) {
        if (current === revision) { count.textContent = ''; notice.textContent = error.message || 'Offline map unavailable.'; }
      }
    };
    style.onchange = update;
    container.querySelectorAll('input[name="offline-detail"]').forEach(input => { input.onchange = update; });
    downloadButton.onclick = async () => {
      if (!selection || active) return;
      if (!context.routeExists()) { notice.textContent = 'This saved route is no longer available.'; return; }
      if (existing?.status === 'complete') { context.viewStatus(); return; }
      if (!context.hasKey()) { notice.textContent = 'OS map key unavailable. Connect online before downloading.'; return; }
      const pack = existing || (() => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        return { id, name: (route.name || 'Untitled route') + ' — ' + STYLES[selection.layer] +
          (selection.detailPreset === 'detailed' ? ' Detailed' : ''), provider: 'os', mapMode: 'uk',
          ...selection, cacheName: CACHE_PREFIX + id, status: 'incomplete', completedTileCount: 0,
          createdAt: now, updatedAt: now };
      })();
      downloadButton.disabled = true;
      cancelButton.textContent = 'Cancel download';
      cancelButton.onclick = cancel;
      await runPack(pack, context, notice, [downloadButton], async () => {
        const outcome = notice.textContent;
        await update();
        if (pack.status === 'complete' && notice.isConnected)
          notice.textContent = 'Offline map ready · ' + pack.completedTileCount + ' / ' + pack.tileCount + ' tiles';
        else if (notice.isConnected) notice.textContent = outcome;
      });
    };
    await update();
  }

  async function preferredRoutePack(routeId) {
    const packs = await listPacks();
    return packs.filter(pack => pack.sourceRouteId === routeId && pack.status === 'complete' && STYLES[pack.layer])
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(a.id).localeCompare(String(b.id)))[0] || null;
  }

  async function routePacks(routeId) {
    return (await listPacks()).filter(pack => pack.sourceRouteId === routeId);
  }

  globalThis.FieldMapsOfflineMaps = { canonicalizeOsTileUrl, enumerateTiles, zoomPolicy, routeBounds,
    matchingPack, visibleAreaBounds, formatSize, packPresentation, render, renderCurrentArea, renderRoute,
    preferredRoutePack, routePacks, cancel, CACHE_PREFIX, TILE_LIMIT, ROUTE_PADDING_METERS };
})();
