// js/routeControl.js

window.makeRouteControl = function(map, mode, featureGroup, drawOpts) {
    return L.Control.extend({
        options: { position: 'topright' },
        onAdd: function() {
            var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            container.style.marginTop = '4px';

            var btn = L.DomUtil.create('a', '', container);
            btn.innerHTML = '<i class="fas fa-route"></i>';
            btn.href = '#';
            btn.title = 'Show/Hide Routes';
            btn.style.width = '34px';
            btn.style.height = '34px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';

            var panel = L.DomUtil.create('div', 'route-panel', container);
            panel.innerHTML = `
                <select id="route-list-${mode}"></select>
                <button id="load-route-${mode}">Load</button>
                <button id="delete-route-${mode}">Delete</button>
            `;

            var drawControl = new L.Control.Draw(Object.assign({
                position: 'topright',
                edit: { featureGroup }
            }, drawOpts));

            function togglePanel() {
                var open = panel.classList.toggle('open');
                if (open) {
                    map.addControl(drawControl);
                    window.updateRouteListUI(mode);
                } else {
                    map.removeControl(drawControl);
                }
            }

            btn.onclick = function(e) {
                e.preventDefault();
                togglePanel();
            };

            setTimeout(function() {
                document.getElementById(`load-route-${mode}`).onclick = function() {
                    const idx = document.getElementById(`route-list-${mode}`).value;
                    if (idx === '' || idx === null) return;
                    window.loadRouteByIndex(mode, idx);
                };
                document.getElementById(`delete-route-${mode}`).onclick = function() {
                    const idx = document.getElementById(`route-list-${mode}`).value;
                    if (idx === '' || idx === null) return;
                    window.deleteRouteFromList(mode, idx);
                    window.updateRouteListUI(mode);
                    featureGroup.clearLayers();
                };
            }, 0);

            return container;
        }
    });
};
