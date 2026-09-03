// js/controls.js

function GlobeSwitcherControl() {}
GlobeSwitcherControl.prototype = Object.create(L.Control.prototype);
GlobeSwitcherControl.prototype.onAdd = function(map) {
  var container = L.DomUtil.create('div', 'leaflet-control globe-control');
  var button = L.DomUtil.create('button', 'leaflet-control-custom globe-btn', container);
  var targetName = map.getContainer().id === 'map-uk' ? 'Worldwide' : 'UK';
  button.type = 'button';
  button.title = `Switch to ${targetName} map`;
  button.setAttribute('aria-label', `Switch to ${targetName} map`);
  button.innerHTML = `<i class="fas fa-globe" aria-hidden="true"></i>`;

  L.DomEvent.disableClickPropagation(container);
  button.onclick = function(e) {
    L.DomEvent.preventDefault(e);
    if (window.currentMode === 'uk') {
      window.switchMap('world');
    } else {
      window.switchMap('uk');
    }
  };
  return container;
};

function labelControl(control, selector, label) {
  var element = control.getContainer().querySelector(selector);
  if (!element) return;
  element.setAttribute('role', 'button');
  element.setAttribute('aria-label', label);
  element.title = label;
}

function prepareMeasureControl(control) {
  var container = control.getContainer();
  var toggle = container.querySelector('.leaflet-measure-toggle');
  var actions = container.querySelectorAll('.leaflet-measure-actions a');
  var actionLabels = ['Measure distance', 'Measure area'];
  if (!toggle) return;

  actions.forEach(function(action, index) {
    action.textContent = actionLabels[index] || action.textContent;
    action.setAttribute('aria-label', action.textContent);
  });

  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-haspopup', 'true');
  container.addEventListener('mouseenter', function() {
    toggle.setAttribute('aria-expanded', 'true');
  });
  container.addEventListener('mouseleave', function() {
    toggle.setAttribute('aria-expanded', 'false');
  });
  toggle.addEventListener('click', function(event) {
    event.preventDefault();
    control._expand();
    toggle.setAttribute('aria-expanded', 'true');
    if (event.detail === 0 && actions.length) {
      actions[0].focus();
    }
  });
  container.addEventListener('keydown', function(event) {
    if (event.target === toggle && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      toggle.click();
      return;
    }
    if (event.key === 'Escape') {
      control._collapse();
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
  actions.forEach(function(action) {
    action.addEventListener('click', function() {
      control._collapse();
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

function addUKControls(map, baseLayers) {
    var layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
    labelControl(layerControl, '.leaflet-control-layers-toggle', 'Choose map style');
    map.addControl(new GlobeSwitcherControl({ position: 'topright' }));
    // Route control is handled separately in map.js
    var locateControl = L.control.locate().addTo(map);
    labelControl(locateControl, 'a', 'Find my location');
    var measureControl = L.control.measure({
        position: 'topleft',
        collapsed: true,
        title: 'Measure',
        color: '#FF0080'
    }).addTo(map);
    labelControl(measureControl, '.leaflet-measure-toggle', 'Measure distance');
    prepareMeasureControl(measureControl);
    L.control.scale({
        position: 'bottomleft',
        imperial: false,
        metric: true,
        maxWidth: 200
    }).addTo(map);
}
function addWorldControls(map) {
    map.addControl(new GlobeSwitcherControl({ position: 'topright' }));
    // Route control is handled separately in map.js
    var locateControl = L.control.locate().addTo(map);
    labelControl(locateControl, 'a', 'Find my location');
    var measureControl = L.control.measure({
        position: 'topleft',
        collapsed: true,
        title: 'Measure',
        color: '#3388ff'
    }).addTo(map);
    labelControl(measureControl, '.leaflet-measure-toggle', 'Measure distance');
    prepareMeasureControl(measureControl);
    L.control.scale({
        position: 'bottomleft',
        imperial: true,
        metric: true,
        maxWidth: 200
    }).addTo(map);
}
