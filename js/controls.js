function addControls(map, baseLayers) {
    // Locate Controle
    L.control.locate().addTo(map);

    // Measurement Tool (ptma)
    L.control.measure({
        position: 'topleft',
        primaryLengthUnit: 'meters',
        secondaryLengthUnit: 'kilometers',
        primaryAreaUnit: 'sqmeters',
        secondaryAreaUnit: 'hectares',
        activeColor: '#db4a29',
        completedColor: '#9b2d14'
    }).addTo(map);

    // Base layer Switcher 
    L.control.layers(baseLayers).addTo(map);
}
