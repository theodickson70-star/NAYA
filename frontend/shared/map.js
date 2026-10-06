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
  const map = L.map(el, { zoomControl: false, attributionControl: true, dragging: true, tap: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
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
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16, animate: false });
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
      // Skrini inabadilika haraka (mf. nauli inahesabiwa) — ramani ifungwe bila kosa hata ikiwa katikati ya kusogea.
      try {
        map.stop();
        map.remove();
      } catch {
        // tayari imeondoka
      }
    },
  };
}

const BAJAJI_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16V9a4 4 0 0 1 4-4h7l5 5.5V16"/><path d="M4 10.5h16"/><circle cx="7.5" cy="16.5" r="2.5"/><circle cx="17" cy="16.5" r="2.5"/></svg>`;

/**
 * "NAYA karibu nawe": abiria katikati, na madereva walio karibu wakisogea kwa ulaini (bila kuchora ramani upya).
 * Inarudisha { setDrivers({BODABODA:[], BAJAJI:[]}), destroy() }.
 */
export async function nearbyMap(el, center) {
  const L = await loadLeaflet();
  if (!el.isConnected) return null;
  const map = L.map(el, { zoomControl: false, attributionControl: true, dragging: true, tap: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([center.lat, center.lng], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const me = L.divIcon({ className: 'me-marker', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] });
  L.marker([center.lat, center.lng], { icon: me, keyboard: false, title: 'Uko hapa' }).addTo(map);
  const icons = {
    BODABODA: L.divIcon({ className: 'moto-marker', html: MOTO_ICON, iconSize: [36, 36], iconAnchor: [18, 18] }),
    BAJAJI: L.divIcon({ className: 'moto-marker bajaji-marker', html: BAJAJI_ICON, iconSize: [36, 36], iconAnchor: [18, 18] }),
  };
  const markers = new Map();
  let fitted = false;
  return {
    setDrivers(groups) {
      const seen = new Set();
      const points = [[center.lat, center.lng]];
      for (const type of ['BODABODA', 'BAJAJI']) {
        for (const d of groups[type] ?? []) {
          seen.add(d.key);
          points.push([d.lat, d.lng]);
          const existing = markers.get(d.key);
          if (existing) existing.setLatLng([d.lat, d.lng]);
          else markers.set(d.key, L.marker([d.lat, d.lng], { icon: icons[type], keyboard: false }).addTo(map));
        }
      }
      for (const [key, m] of markers) {
        if (!seen.has(key)) {
          m.remove();
          markers.delete(key);
        }
      }
      if (!fitted && points.length > 1) {
        fitted = true;
        map.fitBounds(points, { padding: [34, 34], maxZoom: 16, animate: false });
      }
    },
    destroy() {
      // Skrini inabadilika haraka (mf. nauli inahesabiwa) — ramani ifungwe bila kosa hata ikiwa katikati ya kusogea.
      try {
        map.stop();
        map.remove();
      } catch {
        // tayari imeondoka
      }
    },
  };
}
