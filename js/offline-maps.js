// Explicit OS raster packs. The same canonical tile identity is used by the page and service worker.
(() => {
  const DB_NAME = 'field-maps-offline';
  const STORE = 'packs';
  const CACHE_PREFIX = 'field-maps-offline-os-';
  const MIN_ZOOM = 7;
  const MAX_ZOOM = 9;
  const TILE_LIMIT = 750;
  const CONCURRENCY = 4;
  let active = null;

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
    if (!canonical || !canonical.includes('/Outdoor_27700/')) throw new Error('Outdoor tile URL unavailable.');
    return { network, canonical };
  }

  async function download(pack, layer, crs, tileSize, hasKey, progress) {
    if (active) throw new Error('A download is already running.');
    if (!hasKey) throw new Error('OS map key unavailable. Connect online before downloading.');
    const tiles = enumerateTiles(pack.bounds, pack.minZoom, pack.maxZoom, crs, tileSize);
    if (tiles.length > TILE_LIMIT) throw new Error('Area is too large for this test download. Zoom in and try again.');
    const controller = new AbortController();
    active = controller;
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
    } finally { active = null; }
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

  async function render(container, context) {
    container.innerHTML = `<div class="panel-navigation"><button id="back-to-settings-from-offline" class="panel-back" type="button"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> Settings</button></div>
      <div class="panel-heading workflow-heading"><div class="panel-eyebrow">Settings</div><h2 class="route-title">Offline maps (Test)</h2>
      <p class="panel-hint">OS Outdoor, current UK map area, native zooms 7–9. Keep this page open while downloading.</p></div>
      <section class="route-backup-section"><h3>Current visible area</h3><p id="offline-area-summary"></p>
      <button id="offline-download" class="secondary-action" type="button">Download current area</button>
      <button id="offline-cancel" class="secondary-action" type="button" hidden>Cancel download</button>
      <p id="offline-notice" class="route-backup-notice" role="status"></p></section>
      <section class="route-backup-section"><h3>Stored test packs</h3><div id="offline-pack-list"></div></section>`;
    container.querySelector('#back-to-settings-from-offline').onclick = context.back;
    const notice = container.querySelector('#offline-notice');
    const downloadButton = container.querySelector('#offline-download');
    const cancelButton = container.querySelector('#offline-cancel');
    cancelButton.onclick = cancel;
    const ui = (message, running = false) => {
      notice.textContent = message;
      cancelButton.hidden = !running;
      downloadButton.disabled = running;
    };
    const refresh = async () => {
      const target = container.querySelector('#offline-pack-list');
      try {
        const packs = await listPacks();
        if (!target) return;
        target.replaceChildren();
        if (!packs.length) { target.textContent = 'No offline test packs yet.'; return; }
        for (const pack of packs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
          const row = document.createElement('div');
          row.className = 'offline-pack-row';
          const label = document.createElement('p');
          label.textContent = `${pack.name} — ${pack.status === 'downloading' ? 'Incomplete' : pack.status} — ${pack.completedTileCount} / ${pack.tileCount} tiles`;
          row.append(label);
          if (pack.status !== 'complete') {
            const resume = document.createElement('button');
            resume.type = 'button'; resume.className = 'secondary-action'; resume.textContent = 'Resume';
            resume.onclick = () => run(pack);
            row.append(resume);
          }
          const remove = document.createElement('button');
          remove.type = 'button'; remove.className = 'secondary-action'; remove.textContent = 'Delete';
          remove.onclick = async () => {
            try { await deletePack(pack); ui('Pack deleted.'); await refresh(); }
            catch (error) { ui(error.message); }
          };
          row.append(remove);
          target.append(row);
        }
      } catch (_) { ui('Offline pack storage is unavailable.'); }
    };
    const run = async pack => {
      if (active) return;
      try {
        ui(`Downloading ${pack.completedTileCount} / ${pack.tileCount}`, true);
        const result = await download(pack, context.layer, context.crs, context.tileSize, context.hasKey(),
          (done, total) => ui(`Downloading ${done} / ${total}`, true));
        ui(result.status === 'complete' ? 'Download complete.' : 'Download cancelled. Stored tiles are kept.');
      } catch (error) { ui(error.message || 'Download interrupted.'); }
      await refresh();
    };
    let selection = null;
    if (context.mode() !== 'uk') {
      container.querySelector('#offline-area-summary').textContent = 'Switch to the UK map to download a test area.';
      downloadButton.disabled = true;
    } else if (!context.isOutdoor()) {
      container.querySelector('#offline-area-summary').textContent = 'Switch to OS Outdoor to download a test area.';
      downloadButton.disabled = true;
    } else {
      try {
        const b = context.bounds();
        const bounds = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
        const tiles = enumerateTiles(bounds, MIN_ZOOM, MAX_ZOOM, context.crs, context.tileSize);
        selection = { bounds, count: tiles.length };
        container.querySelector('#offline-area-summary').textContent = tiles.length > TILE_LIMIT
          ? 'Area is too large for this test download. Zoom in and try again.'
          : `Outdoor · current area · z7–9 · ${tiles.length} tiles`;
        downloadButton.disabled = tiles.length > TILE_LIMIT || !tiles.length;
      } catch (_) { ui('Could not read the current UK map area.'); downloadButton.disabled = true; }
    }
    downloadButton.onclick = () => {
      if (!selection || active) return;
      if (!context.hasKey()) { ui('OS map key unavailable. Connect online before downloading.'); return; }
      if (!confirm(`Download OS Outdoor for the current area at z7–9?\n${selection.count} tiles.`)) return;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      run({ id, name: 'Outdoor test area', provider: 'os', mapMode: 'uk', layer: 'Outdoor_27700',
        bounds: selection.bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
        cacheName: CACHE_PREFIX + id, status: 'incomplete', tileCount: selection.count,
        completedTileCount: 0, createdAt: now, updatedAt: now });
    };
    await refresh();
  }

  globalThis.FieldMapsOfflineMaps = { canonicalizeOsTileUrl, enumerateTiles, render, cancel,
    CACHE_PREFIX, TILE_LIMIT };
})();
