function addControls(map, baseLayers, offlineLayer) {
    L.control.locate().addTo(map);
    new L.Control.Measure({
        position: 'topleft',
        primaryLengthUnit: 'meters',
        secondaryLengthUnit: 'kilometers',
        primaryAreaUnit: 'sqmeters',
        secondaryAreaUnit: 'hectares'
    }).addTo(map);
    L.control.layers(baseLayers).addTo(map);
