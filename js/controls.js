function addControls(map, offlineLayer) {
    L.control.locate().addTo(map);

    new L.Control.Measure({
        position: 'topleft',
        primaryLengthUnit: 'meters',
        secondaryLengthUnit: 'kilometers',
        primaryAreaUnit: 'sqmeters',
        secondaryAreaUnit: 'hectares'
    }).addTo(map);

    L.control.savetiles(offlineLayer, {
        position: 'topright',
        saveText: '💾',
        rmText: '🗑️',
        zoomLevels: [7, 8, 9, 10]
    }).addTo(map);
}