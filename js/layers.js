function getBaseLayers(serviceUrl, apiKey) {
    return {
        'OS Road WMS': L.tileLayer.wms('https://your-wms-server-url', {
            layers: 'your-layer-name',
            format: 'image/png',
            transparent: true,
        }),
        'OS Outdoor': L.tileLayer(`${serviceUrl}/Outdoor_27700/{z}/{x}/{y}.png?key=${apiKey}`, {
            maxZoom: 22,
        }),
        'OS Leisure': L.tileLayer(`${serviceUrl}/Leisure_27700/{z}/{x}/{y}.png?key=${apiKey}`, {
            maxZoom: 9,
        })
    };
}

function getOfflineLayer(serviceUrl, apiKey) {
    return L.tileLayer.offline(`${serviceUrl}/Outdoor_27700/{z}/{x}/{y}.png?key=${apiKey}`, {
        maxZoom: 22,
    });
}
