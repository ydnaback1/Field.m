function toWGS84(coords) {
    return proj4('EPSG:27700', 'EPSG:4326', coords).reverse();
}