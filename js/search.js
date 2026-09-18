// Compact Pelias search. Provider fields stay here; map movement stays in map.js.
(function (global) {
  'use strict';

  const ENDPOINT = 'https://api.heigit.org/pelias/v1/';
  const MIN_QUERY_LENGTH = 3;
  const DEBOUNCE_MS = 320;
  const RESULT_LIMIT = 6;
  const cache = new Map();
  let selectionHandler = null;
  let contextProvider = null;
  let openGuard = null;
  let lastDiagnostic = null;

  function validCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function normaliseFeature(feature) {
    const properties = feature && feature.properties || {};
    const coordinates = feature && feature.geometry && feature.geometry.coordinates;
    const lng = Number(coordinates && coordinates[0]);
    const lat = Number(coordinates && coordinates[1]);
    if (!validCoordinate(lat, lng)) return null;

    const label = String(properties.name || feature.text || '').trim();
    if (!label) return null;
    const secondaryParts = [properties.locality, properties.county, properties.region, properties.country]
      .map(value => String(value || '').trim())
      .filter((value, index, values) => value && values.indexOf(value) === index && value !== label);
    return {
      label,
      secondaryLabel: secondaryParts.slice(0, 3).join(', '),
      lat,
      lng,
      type: String(properties.layer || feature.layer || 'place').toLowerCase(),
      providerId: String(properties.gid || feature.id || '')
    };
  }

  function normaliseResponse(payload) {
    const features = Array.isArray(payload && payload.features) ? payload.features : [];
    return features.map(normaliseFeature).filter(Boolean).slice(0, RESULT_LIMIT);
  }

  function queryUrl(service, query, context) {
    const url = new URL(service, ENDPOINT);
    url.searchParams.set('text', query);
    url.searchParams.set('size', String(RESULT_LIMIT));
    url.searchParams.set('lang', 'en');
    if (validCoordinate(context && context.lat, context && context.lng)) {
      url.searchParams.set('focus.point.lat', String(context.lat));
      url.searchParams.set('focus.point.lon', String(context.lng));
    }
    return url.toString();
  }

  function orsApiKeyAtRequestTime() {
    // This deliberately matches Follow Paths: config.js declares CONFIG as a
    // global lexical const, not a window property. Resolve it only per request.
    return typeof CONFIG !== 'undefined' ? CONFIG.orsApiKey : '';
  }

  function setDiagnostic(endpoint, category, status) {
    lastDiagnostic = { endpoint, category, status: Number.isFinite(status) ? status : null };
  }

  async function fetchResults(service, query, context, signal) {
    const endpoint = queryUrl(service, query, context);
    const apiKey = orsApiKeyAtRequestTime();
    if (!apiKey) {
      setDiagnostic(endpoint, 'missing-configuration');
      throw new Error('missing-configuration');
    }
    if (navigator.onLine === false) {
      setDiagnostic(endpoint, 'offline');
      throw new Error('offline');
    }
    let response;
    try {
      response = await fetch(endpoint, { headers: { Authorization: apiKey }, signal });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      setDiagnostic(endpoint, 'network-error');
      throw new Error('network-error');
    }
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403 ? 'authentication-error' : 'provider-http-error';
      setDiagnostic(endpoint, category, response.status);
      throw new Error(category);
    }
    const found = normaliseResponse(await response.json());
    setDiagnostic(endpoint, found.length ? 'success' : 'zero-results', response.status);
    return found;
  }

  function typeLabel(type) {
    const labels = { address: 'Address', venue: 'Place', poi: 'Place', postcode: 'Postcode', locality: 'Town', localadmin: 'Area', region: 'Region', country: 'Country', street: 'Road' };
    return labels[type] || 'Place';
  }

  function SearchControl() {}
  SearchControl.prototype = Object.create(L.Control.prototype);
  SearchControl.prototype.onAdd = function () {
    const control = this;
    const container = L.DomUtil.create('div', 'leaflet-control field-search-control');
    const button = L.DomUtil.create('button', 'field-search-button', container);
    button.type = 'button';
    button.title = 'Search places';
    button.setAttribute('aria-label', 'Search places');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';

    const panel = L.DomUtil.create('section', 'field-search-panel', container);
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Search places');
    const form = document.createElement('form');
    form.className = 'field-search-form';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search places, postcodes or addresses';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Search places, postcodes or addresses');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'field-search-close';
    close.setAttribute('aria-label', 'Close search');
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    form.append(input, close);
    const status = document.createElement('p');
    status.className = 'field-search-status';
    status.setAttribute('role', 'status');
    const results = document.createElement('div');
    results.className = 'field-search-results';
    results.setAttribute('role', 'listbox');
    results.setAttribute('aria-label', 'Search results');
    const selection = document.createElement('div');
    selection.className = 'field-search-selection';
    selection.hidden = true;
    const selectionText = document.createElement('span');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear pin';
    clear.addEventListener('click', () => global.FieldMapsSearch?.clearMarker?.());
    selection.append(selectionText, clear);
    const attribution = document.createElement('small');
    attribution.className = 'field-search-attribution';
    attribution.textContent = 'Search by HeiGIT Pelias';
    panel.append(form, status, results, selection, attribution);

    let timer = null;
    let controller = null;
    let requestId = 0;
    let items = [];
    let activeIndex = -1;

    function setStatus(message) { status.textContent = message || ''; }
    function renderResults() {
      results.replaceChildren();
      items.forEach((item, index) => {
        const result = document.createElement('button');
        result.type = 'button';
        result.className = 'field-search-result';
        result.setAttribute('role', 'option');
        result.setAttribute('aria-selected', String(index === activeIndex));
        const primary = document.createElement('strong');
        primary.textContent = item.label;
        const detail = document.createElement('span');
        detail.textContent = item.secondaryLabel || typeLabel(item.type);
        const kind = document.createElement('small');
        kind.textContent = typeLabel(item.type);
        result.append(primary, detail, kind);
        result.addEventListener('click', () => choose(index));
        results.append(result);
      });
    }
    function updateViewport() {
      const viewport = global.visualViewport;
      const height = viewport ? viewport.height : global.innerHeight;
      container.style.setProperty('--field-search-viewport-height', `${Math.floor(height)}px`);
    }
    function closeSearch(focusButton) {
      if (timer) global.clearTimeout(timer);
      controller?.abort();
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus({ preventScroll: true });
    }
    function choose(index) {
      const item = items[index];
      if (!item) return;
      selectionHandler?.(item);
      selectionText.textContent = item.label;
      selection.hidden = false;
      input.blur();
      closeSearch(false);
    }
    function runSearch(service) {
      const query = input.value.trim();
      const currentRequest = ++requestId;
      controller?.abort();
      if (query.length < MIN_QUERY_LENGTH) {
        items = [];
        activeIndex = -1;
        renderResults();
        setStatus(query ? 'Type at least 3 characters.' : '');
        return;
      }
      const cacheKey = `${service}:${query.toLocaleLowerCase()}`;
      if (cache.has(cacheKey)) {
        items = cache.get(cacheKey);
        activeIndex = items.length ? 0 : -1;
        renderResults();
        setStatus(items.length ? '' : 'No places found');
        return;
      }
      controller = new AbortController();
      setStatus('Searching…');
      fetchResults(service, query, contextProvider?.(), controller.signal).then(found => {
        if (currentRequest !== requestId) return;
        cache.set(cacheKey, found);
        if (cache.size > 24) cache.delete(cache.keys().next().value);
        items = found;
        activeIndex = found.length ? 0 : -1;
        renderResults();
        setStatus(found.length ? '' : 'No places found');
      }).catch(error => {
        if (error.name === 'AbortError' || currentRequest !== requestId) return;
        items = [];
        activeIndex = -1;
        renderResults();
        setStatus(error.message === 'offline' ? 'Search unavailable while offline.' : 'Search unavailable — try again.');
      });
    }
    function scheduleSearch() {
      if (timer) global.clearTimeout(timer);
      // Invalidate immediately, not when the debounce expires: an old response
      // must never briefly replace results for text the user has already changed.
      requestId += 1;
      controller?.abort();
      timer = global.setTimeout(() => runSearch('autocomplete'), DEBOUNCE_MS);
    }
    button.addEventListener('click', () => {
      if (panel.hidden && openGuard && !openGuard()) {
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        setStatus('Search unavailable while walking or recording.');
        return;
      }
      const opening = panel.hidden;
      panel.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (opening) {
        updateViewport();
        global.requestAnimationFrame(() => input.focus({ preventScroll: true }));
      }
    });
    close.addEventListener('click', () => closeSearch(true));
    input.addEventListener('input', scheduleSearch);
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); activeIndex = Math.min(items.length - 1, activeIndex + 1); renderResults(); }
      else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); renderResults(); }
      else if (event.key === 'Escape') { event.preventDefault(); closeSearch(true); }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (items[activeIndex]) choose(activeIndex);
      else runSearch('search');
    });
    global.visualViewport?.addEventListener('resize', updateViewport);
    global.visualViewport?.addEventListener('scroll', updateViewport);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    this._fieldSearchSetSelection = item => { selectionText.textContent = item.label; selection.hidden = false; };
    this._fieldSearchClearSelection = () => { selectionText.textContent = ''; selection.hidden = true; };
    return container;
  };

  global.createSearchControl = function (map) {
    const control = new SearchControl({ position: 'topleft' });
    control.options = { ...(control.options || {}), position: 'topleft' };
    map.addControl(control);
    map._fieldMapsSearchControl = control;
  };
  global.FieldMapsSearch = {
    normaliseFeature,
    normaliseResponse,
    validCoordinate,
    getLastDiagnostic() { return lastDiagnostic && { ...lastDiagnostic }; },
    setSelectionHandler(handler) { selectionHandler = handler; },
    setContextProvider(provider) { contextProvider = provider; },
    setOpenGuard(guard) { openGuard = guard; },
    updateSelection(item) { [global.mapUK, global.mapWorld].forEach(map => map?._fieldMapsSearchControl?._fieldSearchSetSelection?.(item)); },
    clearSelection() { [global.mapUK, global.mapWorld].forEach(map => map?._fieldMapsSearchControl?._fieldSearchClearSelection?.()); },
    clearMarker: null
  };
})(window);
