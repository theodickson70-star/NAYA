// Ramani ndogo ya safari (Leaflet + OpenStreetMap): mahali pa kuchukuliwa, unakoenda, na dereva anavyosogea.
// Leaflet inapakiwa mara ya kwanza tu ramani inapohitajika (app inabaki nyepesi kwa simu za data ndogo).

let leafletPromise = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = '/vendor/leaflet/leaflet.js';
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error('Ramani haikupakia'));
    };
    document.head.append(script);
  });
  return leafletPromise;
}

const MOTO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="16" r="3"/><circle cx="18.5" cy="16" r="3"/><path d="M5.5 16l4-6h5l2.5 4h1.5"/><path d="M13 6.5h3l2 4"/></svg>`;

/**
 * Inachora ramani ndani ya `el`. Inarudisha { setDriver(point), fit(), destroy() }.
 * points: { pickup: {lat,lng}, destination: {lat,lng}, driver?: {lat,lng} }
 */
export async function rideMap(el, points, { focus = 'pickup' } = {}) {
  const L = await loadLeaflet();
  if (!el.isConnected) return null;
  const map = L.map(el, { zoomControl: false, attributionControl: true, dragging: true, tap: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  L.circleMarker([points.pickup.lat, points.pickup.lng], { radius: 9, color: '#06502F', weight: 3, fillColor: '#ffffff', fillOpacity: 1 })
    .bindTooltip('Kuchukuliwa')
    .addTo(map);
  L.circleMarker([points.destination.lat, points.destination.lng], { radius: 9, color: '#0A6E47', weight: 3, fillColor: '#0A6E47', fillOpacity: 1 })
    .bindTooltip('Unakoenda')
    .addTo(map);

  const icon = L.divIcon({ className: 'moto-marker', html: MOTO_ICON, iconSize: [36, 36], iconAnchor: [18, 18] });
  let driver = null;

  function fit() {
    const target = focus === 'destination' ? points.destination : points.pickup;
    const bounds = L.latLngBounds([[target.lat, target.lng]]);
    if (driver) bounds.extend(driver.getLatLng());
    else bounds.extend([points.destination.lat, points.destination.lng]);
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }

  function setDriver(point) {
    if (!point) return;
    if (driver) driver.setLatLng([point.lat, point.lng]);
    else driver = L.marker([point.lat, point.lng], { icon, keyboard: false, title: 'Dereva' }).addTo(map);
  }

  setDriver(points.driver);
  fit();
  return {
    setDriver(point) {
      const first = !driver;
      setDriver(point);
      // Dereva akitoka nje ya ramani inayoonekana, rekebisha ramani; vinginevyo usiisogeze (mtumiaji anaweza kuwa anaiangalia).
      if (first || !map.getBounds().pad(-0.1).contains([point.lat, point.lng])) fit();
    },
    fit,
    destroy() {
      map.remove();
    },
  };
}
