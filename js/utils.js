function transformCoords(arr) {
    return proj4('EPSG:27700', 'EPSG:4326', arr).reverse();
}
