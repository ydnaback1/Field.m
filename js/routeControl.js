// js/routeControl.js

window.makeRouteControl = function(map, mode, featureGroup, drawOpts) {
    return L.Control.extend({
        options: { position: 'topright' },
        onAdd: function() {
            var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            container.style.marginTop = '4px';

            // Icon button
            var btn = L.DomUtil.create('a', '', container);
            btn.innerHTML = '<i class="fas fa-route"></i>';
            btn.href = '#';
            btn.title = 'Show/Hide Routes';
            btn.style.width = '34px';
            btn.style.height = '34px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';

            // Panel
            var panel = L.DomUtil.create('div', 'route-panel', container);
            panel.innerHTML = `
                <select id="route-list"></select>
                <button id="load-route">Load</button>
                <button id="delete-route">Delete</button>
            `;

            // Create the draw control (polyline only) but do not add to map yet
            var drawControl = new L.Control.Draw(Object.assign({
                position: 'topright',
                edit: { featureGroup }
            }, drawOpts));

            function togglePanel() {
                var open = panel.classList.toggle('open');
                // Add/remove draw controls and update routes UI
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

            // Set up listeners for route UI
            setTimeout(function() {
                document.getElementById('load-route').onclick = function() {
                    const idx = document.getElementById('route-list').value;
                    if (idx === '' || idx === null) return;
                    window.loadRouteByIndex(mode, idx);
                };
                document.getElementById('delete-route').onclick = function() {
                    const idx = document.getElementById('route-list').value;
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
