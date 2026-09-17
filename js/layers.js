// js/layers.js

const UK_BASE_MAX_ZOOM = 22;

function getUKBaseLayers(serviceUrl, apiKey) {
    return {
        'OS Road': L.tileLayer(
            `${serviceUrl}/Road_27700/{z}/{x}/{y}.png?key=${apiKey}`,
            { maxZoom: UK_BASE_MAX_ZOOM, attribution: '&copy; Ordnance Survey' }
        ),
        'OS Outdoor': L.tileLayer(
            `${serviceUrl}/Outdoor_27700/{z}/{x}/{y}.png?key=${apiKey}`,
            { maxZoom: UK_BASE_MAX_ZOOM, attribution: '&copy; Ordnance Survey' }
        ),
        'OS Leisure': L.tileLayer(
            `${serviceUrl}/Leisure_27700/{z}/{x}/{y}.png?key=${apiKey}`,
            {
                maxNativeZoom: 9,
                maxZoom: UK_BASE_MAX_ZOOM,
                attribution: '&copy; Ordnance Survey'
            }
        )
    };
}

function getWorldBaseLayer() {
    return L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
    );
}
