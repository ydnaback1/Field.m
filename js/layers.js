function getBaseLayers(serviceUrl, apiKey) {
    return {
        'OS Outdoor (Offline)': L.tileLayer.offline(`${serviceUrl}/Outdoor_27700/{z}/{x}/{y}.png?key=${apiKey}`, {
            maxZoom: 22,
            attribution: '&copy; Ordnance Survey'
        }),
        'OS Road': L.tileLayer(`${serviceUrl}/Road_27700/{z}/{x}/{y}.png?key=${apiKey}`, {
            maxZoom: 22,
            attribution: '&copy; Ordnance Survey'
        }),
        'OS Leisure': L.tileLayer(`${serviceUrl}/Leisure_27700/{z}/{x}/{y}.png?key=${apiKey}`, {
            maxZoom: 9,
            attribution: '&copy; Ordnance Survey'
        })
    };
}