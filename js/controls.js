function addControls(map, baseLayers) {
    // Locate Controle
    L.control.locate().addTo(map);

    // Measurement Tool (ptma)
    L.control.measure({
        position: 'topleft',
        collapsed: true,
        color: '#FF0080'
    }).addTo(map);
    
    // Base layer Switcher 
    L.control.layers(baseLayers).addTo(map);
}
