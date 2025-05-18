function addControls(map, baseLayers) {
    // Locate Controle
    L.control.locate().addTo(map);

    // Measure Tool
    new L.Control.Measure({
        position: 'topleft',
        primaryLengthUnit: 'meters',
        secondaryLengthUnit: 'kilometers',
        primaryAreaUnit: 'sqmeters',
        secondaryAreaUnit: 'hectares'
    }).addTo(map);

    // Base layer Switcher 
    L.control.layers(baseLayers).addTo(map);
}
