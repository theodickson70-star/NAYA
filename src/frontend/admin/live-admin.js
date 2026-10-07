// Ofisi: Ramani live — madereva walio online (huru / wana kazi / hawaonekani) na wateja wanaosubiri dereva.
import { escapeHtml as esc } from '/shared/api.js';
import { loadLeaflet } from '/shared/map.js';
import { formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
const URAMBO = [-5.0767, 32.0516];
const MOTO = '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16" r="3"/><circle cx="18.5" cy="16" r="3"/><path d="M5.5 16l4-6h5l2.5 4h1.5"/><path d="M13 6.5h3l2 4"/></svg>';
const BAJAJI = '<svg viewBox="0 0 24 24"><path d="M4 16V9a4 4 0 0 1 4-4h7l5 5.5V16"/><path d="M4 10.5h16"/><circle cx="7.5" cy="16.5" r="2.5"/><circle cx="17" cy="16.5" r="2.5"/></svg>';
const RIDE_TEXT = { ACCEPTED: 'Anaenda kwa abiria', ARRIVED: 'Amefika kwa abiria', IN_PROGRESS: 'Safarini' };

let ctx = null;
let map = null;
let layer = null;
let fitted = false;
let timer = null;
const markers = new Map(); // id -> marker

export function setup(context) {
  ctx = context;
  for (const box of ['live-searching', 'live-drivers']) {
    $(box).addEventListener('click', (event) => {
      const item = event.target.closest('[data-lat]');
      if (!item || !map) return;
      map.setView([Number(item.dataset.lat), Number(item.dataset.lng)], 16, { animate: false });
      markers.get(item.dataset.key)?.openPopup();
    });
  }
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

export async function load() {
  stop();
  $('live-error').hidden = true;
  try {
    const L = await loadLeaflet();
    if (!map) {
      map = L.map('live-map', { zoomControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(URAMBO, 14);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 50);
    await refresh();
    timer = setInterval(() => {
      if (!$('page-live').hidden && document.visibilityState === 'visible') refresh();
    }, 10_000);
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('live-error').textContent = err.message;
    $('live-error').hidden = false;
  }
}

const ago = (seconds) => (seconds < 60 ? 'sasa hivi' : `dakika ${Math.floor(seconds / 60)}`);

export async function refresh() {
  if (!map) return;
  const L = window.L;
  const data = await ctx.api.get('/api/admin/live');
  layer.clearLayers();
  markers.clear();
  const points = [];

  for (const d of data.drivers) {
    const kind = d.stale ? 'stale' : d.rideStatus || d.hasOffer ? 'busy' : 'free';
    const icon = L.divIcon({ className: '', html: `<div class="drv-marker drv-${kind}">${d.vehicleType === 'BAJAJI' ? BAJAJI : MOTO}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    const status = d.stale ? 'Hajaonekana dakika 2+' : d.rideStatus ? RIDE_TEXT[d.rideStatus] : d.hasOffer ? 'Ana ombi linalosubiri' : 'Yuko huru';
    const m = L.marker([d.lat, d.lng], { icon, keyboard: false, title: d.name })
      .bindPopup(`<strong>${esc(d.name)}</strong><br>${esc(d.plateNumber ?? '')} · ${esc(VEHICLE_TYPES[d.vehicleType] ?? '')}<br>${esc(status)}<br>
        <a href="tel:+${esc(d.phone)}">${esc(formatPhone(d.phone))}</a> · <a href="#/wateja/${esc(d.id)}">Wasifu</a>`)
      .addTo(layer);
    markers.set(`d-${d.id}`, m);
    points.push([d.lat, d.lng]);
  }
  const searching = data.rides.filter((r) => r.status === 'SEARCHING');
  for (const r of data.rides) {
    if (r.status !== 'SEARCHING') continue;
    const icon = L.divIcon({ className: '', html: '<div class="req-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker([r.pickupLat, r.pickupLng], { icon, keyboard: false, title: r.passengerName })
      .bindPopup(`<strong>${esc(r.passengerName)}</strong> anasubiri ${esc(VEHICLE_TYPES[r.vehicleType] ?? '')}<br>${esc(r.pickupName)} → ${esc(r.destinationName)}<br>
        ${formatTsh(r.fare)} · ${ago(r.ageSeconds)}<br><a href="#/safari/${esc(r.id)}">Fungua safari — mpe dereva</a>`)
      .addTo(layer);
    markers.set(`r-${r.id}`, m);
    points.push([r.pickupLat, r.pickupLng]);
  }
  if (!fitted && points.length) {
    fitted = true;
    if (points.length === 1) map.setView(points[0], 15, { animate: false });
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 16, animate: false });
  }

  $('live-search-count').textContent = searching.length;
  $('live-driver-count').textContent = data.drivers.length;
  $('live-searching').innerHTML = searching.length
    ? searching
        .map(
          (r) => `<button type="button" class="live-item" data-key="r-${esc(r.id)}" data-lat="${r.pickupLat}" data-lng="${r.pickupLng}">
            <span class="req-marker" style="animation:none" aria-hidden="true"></span>
            <span><strong>${esc(r.passengerName)}</strong><small>${esc(r.pickupName)} → ${esc(r.destinationName)}</small></span>
            <span class="mins">${Math.floor(r.ageSeconds / 60)}′</span>
          </button>`,
        )
        .join('')
    : '<p class="live-empty">Hakuna mteja anayesubiri sasa.</p>';
  $('live-drivers').innerHTML = data.drivers.length
    ? data.drivers
        .map((d) => {
          const kind = d.stale ? 'stale' : d.rideStatus || d.hasOffer ? 'busy' : 'free';
          const status = d.stale ? 'Hajaonekana' : d.rideStatus ? RIDE_TEXT[d.rideStatus] : d.hasOffer ? 'Ana ombi' : 'Yuko huru';
          return `<button type="button" class="live-item" data-key="d-${esc(d.id)}" data-lat="${d.lat}" data-lng="${d.lng}">
            <span class="drv-marker drv-${kind}" style="width:24px;height:24px" aria-hidden="true">${d.vehicleType === 'BAJAJI' ? BAJAJI : MOTO}</span>
            <span><strong>${esc(d.name)}</strong><small>${esc(d.plateNumber ?? '')} · ${esc(status)}</small></span>
            <span></span>
          </button>`;
        })
        .join('')
    : '<p class="live-empty">Hakuna dereva online sasa.</p>';
}
