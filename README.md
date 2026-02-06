# Field Maps

Field Maps is a lightweight, static Leaflet app for planning walking routes across the UK Ordnance Survey basemaps and a worldwide OpenStreetMap view. Routes are saved locally in your browser so you can return to them later without a backend.

## Features
- Toggle between UK and worldwide map views.
- Draw, edit, and delete routes using the floating routes panel.
- View distance and estimated walking time for the selected route.
- Export routes as GeoJSON or GPX, and share routes via a URL.
- Persist map position, zoom, and saved routes in localStorage.

## Usage
1. Update `config.js` with your Ordnance Survey API key if needed.
2. Open `index.html` in a local web server (for example, `python -m http.server`) and navigate to the served URL.
3. Click the routes button (bottom-right) to open the routes panel.

## Notes
- All routes are stored in the browser's localStorage, so they are specific to the device and browser profile you use.
