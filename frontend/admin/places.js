// Ofisi: Maeneo (ramani ya Leaflet + OpenStreetMap) na Bei (kanuni za nauli + mfano wa nauli).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatTsh, LOCATION_CATEGORIES, VEHICLE_TYPES } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
// Katikati ya ramani mwanzoni tu (mji wa Urambo). Maeneo yenyewe yanawekwa na ofisi.
const URAMBO_CENTER = [-5.0767, 32.0516];

let ctx = null; // { api, onAuthError }
export function setup(context) {
  ctx = context;
  $('loc-category').innerHTML = Object.entries(LOCATION_CATEGORIES)
    .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
    .join('');
  bindLocationForm();
}

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  $(boxId).textContent = err.message;
  $(boxId).hidden = false;
}

// =========================================================== Maeneo
let map = null;
let markerLayer = null;
let pendingMarker = null;
let leafletPromise = null;
let locations = [];
let editingId = null;
let fittedOnce = false;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/leaflet/leaflet.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Ramani haikupakia'));
    document.head.append(script);
  });
  return leafletPromise;
}

export async function loadLocations(q = '') {
  $('location-q').value = q;
  $('location-error').hidden = true;
  try {
    await loadLeaflet();
    initMap();
  } catch {
    $('location-map').innerHTML = '<p class="empty">Ramani haikupakia. Unaweza kuandika latitude na longitude mwenyewe.</p>';
  }
  await refreshLocations(q);
}

async function refreshLocations(q = $('location-q').value.trim()) {
  try {
    locations = await ctx.api.get(`/api/admin/locations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    renderLocationList();
    renderMarkers();
  } catch (err) {
    fail(err, 'location-error');
  }
}

function initMap() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 0);
    return;
  }
  map = window.L.map('location-map', { zoomControl: true }).setView(URAMBO_CENTER, 14);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = window.L.layerGroup().addTo(map);
  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, true));
}

function setPoint(lat, lng, fromMap = false) {
  $('loc-lat').value = Number(lat).toFixed(6);
  $('loc-lng').value = Number(lng).toFixed(6);
  $('coords-hint').textContent = fromMap ? 'Mahali pamechaguliwa. Jaza jina, kisha hifadhi.' : 'Unaweza kubonyeza ramani kubadilisha mahali.';
  if (!map) return;
  const point = [Number(lat), Number(lng)];
  if (pendingMarker) pendingMarker.setLatLng(point);
  else {
    pendingMarker = window.L.circleMarker(point, { radius: 11, color: '#6B4E00', weight: 3, fillColor: '#F2B705', fillOpacity: 1 }).addTo(map);
  }
  if (fromMap && !$('loc-name').value) $('loc-name').focus();
}

function clearPoint() {
  if (pendingMarker) pendingMarker.remove();
  pendingMarker = null;
}

function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  const active = locations.filter((l) => l.isActive);
  for (const l of active) {
    window.L.circleMarker([l.lat, l.lng], { radius: 8, color: '#06502F', weight: 2, fillColor: '#0A6E47', fillOpacity: 0.9 })
      .bindTooltip(l.name)
      .on('click', () => startEdit(l.id))
      .addTo(markerLayer);
  }
  if (!fittedOnce && active.length > 0) {
    fittedOnce = true;
    if (active.length === 1) map.setView([active[0].lat, active[0].lng], 15);
    else map.fitBounds(active.map((l) => [l.lat, l.lng]), { padding: [40, 40], maxZoom: 16 });
  }
}

function renderLocationList() {
  const list = $('location-list');
  if (locations.length === 0) {
    list.innerHTML = `<p class="empty">${
      $('location-q').value ? 'Hakuna eneo linalolingana na utafutaji huu.' : 'Bado hakuna eneo. Bonyeza ramani kuongeza la kwanza (mf. Stendi ya Mabasi).'
    }</p>`;
    return;
  }
  list.innerHTML = locations
    .map(
      (l) => `<div class="location-row${l.isActive ? '' : ' inactive'}">
        <span>
          <button type="button" class="link name" data-edit="${l.id}">${esc(l.name)}</button><br>
          <span class="muted small">${esc(LOCATION_CATEGORIES[l.category] ?? l.category)}${l.area ? ` · ${esc(l.area)}` : ''}</span>
          ${l.isActive ? '' : ' <span class="badge badge-muted">Limezimwa</span>'}
        </span>
        <span class="row-actions">
          <button type="button" class="btn btn-ghost btn-small" data-edit="${l.id}">Badilisha</button>
          <button type="button" class="btn btn-small ${l.isActive ? 'btn-danger' : 'btn-ghost'}" data-toggle="${l.id}" data-active="${l.isActive}">${
            l.isActive ? 'Zima' : 'Washa'
          }</button>
        </span>
      </div>`,
    )
    .join('');
}

function startEdit(id) {
  const l = locations.find((x) => x.id === id);
  if (!l) return;
  editingId = id;
  $('location-form-title').textContent = 'Badilisha eneo';
  $('location-save').textContent = 'Hifadhi mabadiliko';
  $('location-cancel').hidden = false;
  $('loc-name').value = l.name;
  $('loc-category').value = l.category;
  $('loc-area').value = l.area ?? '';
  setPoint(l.lat, l.lng);
  map?.setView([l.lat, l.lng], Math.max(map.getZoom(), 16));
  $('location-error').hidden = true;
  $('loc-name').focus();
}

function resetForm() {
  editingId = null;
  $('location-form').reset();
  $('location-form-title').textContent = 'Ongeza eneo';
  $('location-save').textContent = 'Hifadhi eneo';
  $('location-cancel').hidden = true;
  $('coords-hint').textContent = 'Bonyeza ramani kujaza latitude na longitude.';
  clearPoint();
}

function bindLocationForm() {
  $('location-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('location-error').hidden = true;
    const lat = Number($('loc-lat').value.replace(',', '.'));
    const lng = Number($('loc-lng').value.replace(',', '.'));
    if (!$('loc-lat').value || !$('loc-lng').value || Number.isNaN(lat) || Number.isNaN(lng)) {
      $('location-error').textContent = 'Chagua mahali kwenye ramani (au andika latitude na longitude).';
      $('location-error').hidden = false;
      return;
    }
    const body = { name: $('loc-name').value, category: $('loc-category').value, area: $('loc-area').value, lat, lng };
    const button = $('location-save');
    button.disabled = true;
    try {
      if (editingId) await ctx.api.put(`/api/admin/locations/${editingId}`, body);
      else await ctx.api.post('/api/admin/locations', body);
      resetForm();
      await refreshLocations();
    } catch (err) {
      fail(err, 'location-error');
    } finally {
      button.disabled = false;
    }
  });

  $('location-cancel').addEventListener('click', resetForm);

  for (const id of ['loc-lat', 'loc-lng']) {
    $(id).addEventListener('change', () => {
      const lat = Number($('loc-lat').value);
      const lng = Number($('loc-lng').value);
      if ($('loc-lat').value && $('loc-lng').value && !Number.isNaN(lat) && !Number.isNaN(lng)) setPoint(lat, lng);
    });
  }

  $('location-list').addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) return startEdit(edit.dataset.edit);
    const toggle = event.target.closest('[data-toggle]');
    if (!toggle) return;
    toggle.disabled = true;
    try {
      const action = toggle.dataset.active === 'true' ? 'deactivate' : 'activate';
      await ctx.api.post(`/api/admin/locations/${toggle.dataset.toggle}/${action}`);
      await refreshLocations();
    } catch (err) {
      fail(err, 'location-error');
      toggle.disabled = false;
    }
  });

  $('location-search').addEventListener('submit', (event) => {
    event.preventDefault();
    refreshLocations();
  });
}

// =========================================================== Bei
const ROUNDING = [50, 100, 200, 500, 1000];
const previewTimers = {};

export async function loadFares() {
  $('fares-error').hidden = true;
  $('fare-cards').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    const rules = await ctx.api.get('/api/admin/fares');
    const byType = Object.fromEntries(rules.map((r) => [r.vehicleType, r]));
    $('fare-cards').innerHTML = Object.keys(VEHICLE_TYPES)
      .map((type) => fareCard(type, byType[type]))
      .join('');
    for (const type of Object.keys(VEHICLE_TYPES)) {
      bindFareCard(type);
      if (byType[type]) schedulePreview(type, 0);
    }
  } catch (err) {
    $('fare-cards').innerHTML = '';
    fail(err, 'fares-error');
  }
}

function fareCard(type, rule) {
  const v = (x) => (x === undefined || x === null ? '' : esc(x));
  const status = rule
    ? `<span class="badge ${rule.isActive ? 'badge-ok' : 'badge-muted'}">${rule.isActive ? 'Inatumika' : 'Imezimwa'}</span>`
    : '<span class="badge badge-warn">Bado haijawekwa</span>';
  return `<form class="fare-card" id="fare-${type}" novalidate>
    <h2>${esc(VEHICLE_TYPES[type])} ${status}</h2>
    ${rule ? `<p class="muted small">Ilibadilishwa ${esc(formatDate(rule.updatedAt, true))}</p>` : '<p class="muted small">Weka bei ili abiria waone nauli ya ' + esc(VEHICLE_TYPES[type].toLowerCase()) + '.</p>'}
    <div class="fare-grid">
      <div><label for="${type}-base">Bei ya kuanzia (TSh)</label><input id="${type}-base" name="baseFare" inputmode="numeric" value="${v(rule?.baseFare)}" required></div>
      <div><label for="${type}-km">Bei kwa km (TSh)</label><input id="${type}-km" name="perKm" inputmode="numeric" value="${v(rule?.perKm)}" required></div>
      <div><label for="${type}-min">Nauli ya chini kabisa (TSh)</label><input id="${type}-min" name="minimumFare" inputmode="numeric" value="${v(rule?.minimumFare)}" required></div>
      <div><label for="${type}-round">Zungusha juu hadi</label><select id="${type}-round" name="roundingStep">${ROUNDING.map(
        (r) => `<option value="${r}" ${Number(rule?.roundingStep ?? 100) === r ? 'selected' : ''}>TSh ${r}</option>`,
      ).join('')}</select></div>
      <div><label for="${type}-factor">Kizidisho cha barabara</label><input id="${type}-factor" name="roadFactor" inputmode="decimal" value="${v(rule?.roadFactor ?? 1.3)}"></div>
      <div><label class="check" style="margin-top:44px"><input type="checkbox" name="isActive" ${rule?.isActive === false ? '' : 'checked'}> Inatumika</label></div>
    </div>
    <table class="preview" aria-live="polite">
      <caption>Mfano wa nauli</caption>
      <thead><tr><th scope="col">Umbali wa barabara</th><th scope="col">Nauli</th></tr></thead>
      <tbody id="${type}-preview"><tr><td colspan="2" class="muted">Jaza bei kuona mfano.</td></tr></tbody>
    </table>
    <p class="alert alert-danger" id="${type}-error" role="alert" hidden></p>
    <p class="alert alert-ok" id="${type}-saved" role="status" hidden>Bei zimehifadhiwa.</p>
    <div class="actions"><button class="btn btn-primary" type="submit">Hifadhi bei za ${esc(VEHICLE_TYPES[type].toLowerCase())}</button></div>
  </form>`;
}

function readFareForm(type) {
  const form = $(`fare-${type}`);
  const num = (name) => Number(String(form.elements[name].value).replace(/[,\s]/g, '').replace(',', '.'));
  return {
    baseFare: num('baseFare'),
    perKm: num('perKm'),
    minimumFare: num('minimumFare'),
    roundingStep: Number(form.elements.roundingStep.value),
    roadFactor: Number(String(form.elements.roadFactor.value).replace(',', '.')),
    isActive: form.elements.isActive.checked,
  };
}

function filled(type) {
  const form = $(`fare-${type}`);
  return ['baseFare', 'perKm', 'minimumFare'].every((n) => form.elements[n].value.trim() !== '');
}

function schedulePreview(type, delay = 300) {
  clearTimeout(previewTimers[type]);
  previewTimers[type] = setTimeout(() => preview(type), delay);
}

async function preview(type) {
  const body = $(`${type}-preview`);
  if (!filled(type)) {
    body.innerHTML = '<tr><td colspan="2" class="muted">Jaza bei kuona mfano.</td></tr>';
    return;
  }
  try {
    const rows = await ctx.api.post('/api/admin/fares/preview', readFareForm(type));
    body.innerHTML = rows.map((r) => `<tr><td>km ${r.distanceKm}</td><td>${formatTsh(r.fare)}</td></tr>`).join('');
    $(`${type}-error`).hidden = true;
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    body.innerHTML = `<tr><td colspan="2" class="muted">${esc(err.message)}</td></tr>`;
  }
}

function bindFareCard(type) {
  const form = $(`fare-${type}`);
  form.addEventListener('input', () => {
    $(`${type}-saved`).hidden = true;
    schedulePreview(type);
  });
  form.addEventListener('change', () => schedulePreview(type));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    $(`${type}-error`).hidden = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await ctx.api.put(`/api/admin/fares/${type}`, readFareForm(type));
      await loadFares();
      $(`${type}-saved`).hidden = false;
    } catch (err) {
      fail(err, `${type}-error`);
      button.disabled = false;
    }
  });
}
