// Skrini za safari: abiria (kutafuta → dereva anakuja → safari → nyota) na dereva (online → ombi → safari → mapato).
// Hali mpya inaangaliwa kila sekunde 4 ukurasa ukiwa wazi (Phase 7 italeta Supabase Realtime na notifications).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';

let ctx = null; // { api, toast, handleError, isPassengerHome, isDriverHome, onPassengerRideClosed, firstName }
const $ = (id) => document.getElementById(id);

let pollTimer = null;
let tickTimer = null;
let passengerRide = null;
let driverData = null;
let lastKey = '';
let gpsWatch = null;
let lastPing = 0;
let cancelOpen = false;
let standPicker = false;
let onlineError = '';
const photos = new Map();

export function init(context) {
  ctx = context;
  $('app-content').addEventListener('click', onClick);
  $('app-content').addEventListener('change', onChange);
}

export function stopPolling() {
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

export function reset() {
  stopPolling();
  stopGps();
  passengerRide = null;
  driverData = null;
  lastKey = '';
  cancelOpen = false;
  standPicker = false;
  for (const url of photos.values()) URL.revokeObjectURL(url);
  photos.clear();
}

const tel = (phone) => `tel:+${esc(phone)}`;
const mapsLink = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
const ICON = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  dot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg>',
};

function routeSummary(ride) {
  return `<div class="route route-static">
    <div class="route-row"><span class="route-icon from">${ICON.dot}</span><span><span class="route-label">Kutoka</span><span class="route-value">${esc(ride.pickup.name)}</span></span></div>
    <div class="route-row"><span class="route-icon to">${ICON.pin}</span><span><span class="route-label">Kwenda</span><span class="route-value">${esc(ride.destination.name)}</span></span></div>
  </div>
  <p class="ride-meta"><span>${esc(VEHICLE_TYPES[ride.vehicleType])} · km ${ride.distanceKm}</span><strong>${formatTsh(ride.fare)}</strong></p>`;
}

function stars(name, label) {
  return `<fieldset class="stars">
    <legend>${label}</legend>
    <div class="stars-row">${[1, 2, 3, 4, 5]
      .map((n) => `<label><input type="radio" name="${name}" value="${n}"><span aria-hidden="true">★</span><span class="sr-only">Nyota ${n}</span></label>`)
      .join('')}</div>
  </fieldset>`;
}

// =================================================================== ABIRIA

export const fetchCurrentRide = () => ctx.api.get('/api/rides/current');

export async function book(body) {
  const ride = await ctx.api.post('/api/rides', body);
  lastKey = '';
  renderPassengerRide(ride);
  return ride;
}

function passengerKey(r) {
  return [r.status, r.redispatched, r.driver?.distanceToPickupKm, r.driver?.name].join('|');
}

export function renderPassengerRide(ride) {
  passengerRide = ride;
  const key = passengerKey(ride);
  // Usichore upya kama hakuna kilichobadilika (mf. abiria anaandika maoni au anachagua nyota).
  if (key === lastKey && $('ride-screen')) return ensurePassengerPolling();
  lastKey = key;

  const d = ride.driver;
  const head = {
    SEARCHING: [
      'searching',
      ride.redispatched ? 'Tunakutafutia dereva mwingine' : 'Tunatafuta dereva karibu nawe…',
      ride.redispatched ? 'Dereva wa awali ameghairi. Usijali — tunamtafuta mwingine sasa hivi.' : 'Safari yako imepokelewa. Subiri kidogo.',
    ],
    ACCEPTED: ['coming', 'Dereva anakuja', d?.distanceToPickupKm != null ? `Yuko km ${d.distanceToPickupKm} kutoka ${ride.pickup.name}.` : `Anakuja ${ride.pickup.name}.`],
    ARRIVED: ['arrived', 'Dereva amefika!', `Anakusubiri ${ride.pickup.name}.`],
    IN_PROGRESS: ['moving', 'Safari inaendelea', `Unaelekea ${ride.destination.name}.`],
    COMPLETED: ['done', `Umefika ${ride.destination.name}!`, `Lipa dereva ${formatTsh(ride.fare)} taslimu.`],
    NO_DRIVER: ['none', 'Hakuna dereva aliyepatikana karibu kwa sasa', 'Jaribu tena baada ya dakika chache.'],
    CANCELLED: ['none', 'Safari imeghairiwa', ride.cancelledBy === 'ADMIN' ? `Ofisi ya NAYA: ${ride.cancelReason ?? ''}` : ride.cancelReason ?? ''],
  }[ride.status];

  const canCancel = ['SEARCHING', 'ACCEPTED', 'ARRIVED'].includes(ride.status);
  $('app-content').innerHTML = `<div id="ride-screen">
    <section class="ride-head ride-${head[0]}" role="status">
      <span class="ride-pulse" aria-hidden="true"></span>
      <h1>${esc(head[1])}</h1>
      <p>${esc(head[2])}</p>
    </section>
    ${d ? driverCardHtml(ride) : ''}
    <section class="card">${routeSummary(ride)}</section>
    ${
      ride.status === 'COMPLETED'
        ? `<form class="card" id="rate-driver-form">
            ${stars('rating', `Mpe ${esc(d?.name.split(' ')[0] ?? 'dereva')} nyota`)}
            <label for="rate-comment">Maoni <span class="optional">(si lazima)</span></label>
            <textarea id="rate-comment" maxlength="300" placeholder="Mf. Aliendesha kwa uangalifu"></textarea>
            <p class="alert alert-danger" id="rate-error" role="alert" hidden></p>
            <button class="btn btn-primary btn-block" type="submit" id="rate-submit" disabled>Tuma</button>
            <button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="close">Ruka</button>
          </form>`
        : ''
    }
    ${ride.status === 'NO_DRIVER' || ride.status === 'CANCELLED' ? '<button class="btn btn-primary btn-block" type="button" data-ride="close">Sawa</button>' : ''}
    ${
      canCancel
        ? cancelOpen
          ? `<div class="card confirm">
              <p><strong>Ghairi safari hii?</strong></p>
              <p class="alert alert-danger" id="cancel-error" role="alert" hidden></p>
              <div class="actions"><button class="btn btn-danger" type="button" data-ride="cancel-confirm">Ndiyo, ghairi</button>
              <button class="btn btn-ghost" type="button" data-ride="cancel-keep">Hapana</button></div>
            </div>`
          : '<button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="cancel">Ghairi safari</button>'
        : ''
    }
  </div>`;
  if (d?.hasPhoto) loadDriverPhoto(ride.id);
  ensurePassengerPolling();
}

function driverCardHtml(ride) {
  const d = ride.driver;
  const initials = d.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<section class="card driver-card">
    <div class="driver-top">
      <span class="driver-photo" id="driver-photo">${esc(initials)}</span>
      <span class="driver-who">
        <strong>${esc(d.name)}</strong>
        <span class="muted">${d.rating ? `★ ${d.rating.average} (${d.rating.count} safari)` : 'Dereva mpya'}</span>
        <span class="muted">${esc([VEHICLE_TYPES[d.vehicleType], d.vehicle].filter(Boolean).join(' · '))}</span>
      </span>
    </div>
    <p class="driver-plate"><span class="plate-chip">${esc(d.plateNumber)}</span><span class="muted">Tafuta ${esc(VEHICLE_TYPES[d.vehicleType].toLowerCase())} ${esc(d.color ?? '')} yenye plate hii</span></p>
    ${
      ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(ride.status)
        ? `<a class="btn btn-ghost btn-block call" href="${tel(d.phone)}">${ICON.phone} Piga simu · ${esc(formatPhone(d.phone))}</a>`
        : ''
    }
  </section>`;
}

function loadDriverPhoto(rideId) {
  const place = (url) => {
    const el = $('driver-photo');
    if (el) el.innerHTML = `<img src="${url}" alt="">`;
  };
  if (photos.has(rideId)) return place(photos.get(rideId));
  ctx.api
    .blob(`/api/rides/${rideId}/driver-photo`)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      photos.set(rideId, url);
      place(url);
    })
    .catch(() => {});
}

function ensurePassengerPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!ctx.isPassengerHome() || document.visibilityState !== 'visible') return;
    try {
      const ride = await fetchCurrentRide();
      if (!ride) {
        stopPolling();
        passengerRide = null;
        lastKey = '';
        return ctx.onPassengerRideClosed();
      }
      if (ride.status !== passengerRide?.status) navigator.vibrate?.(200);
      renderPassengerRide(ride);
    } catch (err) {
      ctx.handleError(err);
    }
  }, 4000);
}

async function closePassengerRide() {
  await ctx.api.post(`/api/rides/${passengerRide.id}/close`);
  stopPolling();
  passengerRide = null;
  lastKey = '';
  ctx.onPassengerRideClosed();
}

// =================================================================== DEREVA

export async function loadDriverDashboard() {
  try {
    driverData = await ctx.api.get('/api/driver/state');
    lastKey = '';
    renderDriverDashboard();
    ensureDriverPolling();
    if (driverData.online) startGps();
  } catch (err) {
    if (ctx.handleError(err)) return;
    $('app-content').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>
      <button class="btn btn-primary btn-block" type="button" data-ride="reload">Jaribu tena</button>`;
  }
}

function driverKey(s) {
  return [s.online, s.offer?.id, s.ride?.id, s.ride?.status, s.earnings.today.total, standPicker, cancelOpen, onlineError].join('|');
}

function renderDriverDashboard() {
  if (!ctx.isDriverHome()) return;
  const s = driverData;
  const key = driverKey(s);
  if (key === lastKey && $('driver-screen')) return;
  lastKey = key;
  clearInterval(tickTimer);

  let main;
  if (s.ride) main = driverRideHtml(s.ride);
  else if (s.offer) main = offerHtml(s.offer);
  else main = onlineHtml(s);

  $('app-content').innerHTML = `<div id="driver-screen">
    ${main}
    <section class="earnings" aria-label="Mapato">
      <div><span class="muted">Leo</span><strong>${formatTsh(s.earnings.today.total)}</strong><span class="muted">safari ${s.earnings.today.trips}</span></div>
      <div><span class="muted">Wiki hii</span><strong>${formatTsh(s.earnings.week.total)}</strong><span class="muted">safari ${s.earnings.week.trips}</span></div>
    </section>
  </div>`;

  if (s.offer && !s.ride) startOfferCountdown(s.offer.secondsLeft);
}

function onlineHtml(s) {
  if (standPicker) {
    return `<section class="card">
      <h1>Uko wapi sasa?</h1>
      <p class="muted">GPS haipatikani. Chagua eneo ulilopo ili upokee maombi ya karibu.</p>
      <div id="stand-list" class="place-list"><p class="muted">Inapakia maeneo…</p></div>
      <button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="stand-cancel">Rudi</button>
    </section>`;
  }
  if (!s.online) {
    return `<section class="go-online">
      <h1>Habari, ${ctx.firstName()}</h1>
      <p class="muted">Ukiwa online utapokea maombi ya safari yaliyo karibu nawe.</p>
      ${onlineError ? `<p class="alert alert-danger" role="alert">${esc(onlineError)}</p>` : ''}
      <button class="online-button" type="button" data-ride="go-online">NENDA ONLINE</button>
    </section>`;
  }
  return `<section class="go-online is-online" role="status">
    <span class="ride-pulse" aria-hidden="true"></span>
    <h1>Uko online</h1>
    <p class="muted">Unasubiri maombi ya safari. Acha app wazi.</p>
    ${onlineError ? `<p class="alert alert-danger" role="alert">${esc(onlineError)}</p>` : ''}
    <button class="btn btn-ghost btn-block" type="button" data-ride="go-offline">Nenda offline</button>
  </section>`;
}

function offerHtml(offer) {
  const r = offer.ride;
  return `<section class="offer" role="alertdialog" aria-labelledby="offer-title">
    <div class="offer-top"><h1 id="offer-title">Ombi jipya la safari</h1><span class="offer-timer" id="offer-seconds">${offer.secondsLeft}</span></div>
    <p class="offer-fare">${formatTsh(r.fare)}</p>
    <p class="muted">${esc(VEHICLE_TYPES[r.vehicleType])} · safari ya km ${r.distanceKm} · abiria yuko km ${offer.distanceToPickupKm} kutoka kwako</p>
    ${routeSummary(r).replace(/<p class="ride-meta">[\s\S]*<\/p>/, '')}
    <p class="alert alert-danger" id="offer-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block btn-big" type="button" data-ride="accept" data-id="${offer.id}">Kubali</button>
    <button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="decline" data-id="${offer.id}">Kataa</button>
  </section>`;
}

function startOfferCountdown(seconds) {
  navigator.vibrate?.([300, 150, 300]);
  let left = seconds;
  tickTimer = setInterval(() => {
    left -= 1;
    const el = $('offer-seconds');
    if (el) el.textContent = Math.max(0, left);
    if (left <= 0) {
      clearInterval(tickTimer);
      refreshDriver();
    }
  }, 1000);
}

function driverRideHtml(ride) {
  const p = ride.passenger;
  const steps = {
    ACCEPTED: { title: 'Nenda kwa abiria', sub: `Mahali pa kumchukua: ${ride.pickup.name}`, target: ride.pickup, action: 'arrive', label: 'Nimefika' },
    ARRIVED: { title: 'Subiri abiria', sub: `Uko ${ride.pickup.name}. Abiria akipanda, anza safari.`, target: null, action: 'start', label: 'Anza safari' },
    IN_PROGRESS: { title: `Mpeleke ${ride.destination.name}`, sub: 'Endesha kwa uangalifu.', target: ride.destination, action: 'complete', label: 'Maliza safari' },
  };
  if (ride.status === 'COMPLETED') {
    return `<section class="ride-head ride-done" role="status"><span class="ride-pulse" aria-hidden="true"></span>
        <h1>Pokea ${formatTsh(ride.fare)}</h1><p>Taslimu kutoka kwa ${esc(p?.name ?? 'abiria')}.</p></section>
      <form class="card" id="rate-passenger-form">
        ${stars('rating', `Mpe ${esc(p?.name.split(' ')[0] ?? 'abiria')} nyota`)}
        <p class="alert alert-danger" id="rate-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" id="rate-submit" disabled>Tuma</button>
        <button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="driver-close">Ruka</button>
      </form>`;
  }
  if (ride.status === 'CANCELLED') {
    return `<section class="ride-head ride-none" role="status"><h1>Abiria ameghairi safari</h1>
        <p>${esc(ride.cancelReason ?? '')}</p></section>
      <button class="btn btn-primary btn-block" type="button" data-ride="driver-close">Sawa</button>`;
  }
  const step = steps[ride.status];
  return `<section class="ride-head ride-coming"><h1>${esc(step.title)}</h1><p>${esc(step.sub)}</p></section>
    <section class="card">
      <div class="driver-top">
        <span class="driver-photo">${esc((p?.name ?? '?').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>
        <span class="driver-who"><strong>${esc(p?.name ?? 'Abiria')}</strong><span class="muted">Abiria · ${formatTsh(ride.fare)} taslimu</span></span>
      </div>
      <div class="actions two">
        ${p ? `<a class="btn btn-ghost call" href="${tel(p.phone)}">${ICON.phone} Piga simu</a>` : ''}
        ${step.target ? `<a class="btn btn-ghost call" href="${mapsLink(step.target)}" target="_blank" rel="noopener">${ICON.map} Ramani</a>` : ''}
      </div>
    </section>
    <section class="card">${routeSummary(ride)}</section>
    <p class="alert alert-danger" id="step-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block btn-big" type="button" data-ride="${step.action}" data-id="${ride.id}">${step.label}</button>
    ${
      ride.status !== 'IN_PROGRESS'
        ? cancelOpen
          ? `<form class="card confirm" id="driver-cancel-form">
              <label for="cancel-reason">Kwa nini unaghairi?</label>
              <select id="cancel-reason">
                <option>Abiria hapatikani</option>
                <option>Hitilafu ya chombo / pancha</option>
                <option>Abiria ameniomba nighairi</option>
                <option>Sababu nyingine</option>
              </select>
              <p class="alert alert-danger" id="cancel-error" role="alert" hidden></p>
              <div class="actions"><button class="btn btn-danger" type="submit">Ghairi safari</button>
              <button class="btn btn-ghost" type="button" data-ride="cancel-keep">Hapana</button></div>
            </form>`
          : '<button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="cancel">Ghairi safari</button>'
        : ''
    }`;
}

function ensureDriverPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!ctx.isDriverHome() || document.visibilityState !== 'visible') return;
    if (driverData?.online || driverData?.ride || driverData?.offer) refreshDriver();
  }, 4000);
}

async function refreshDriver() {
  try {
    const before = driverData?.offer?.id;
    driverData = await ctx.api.get('/api/driver/state');
    if (driverData.offer && driverData.offer.id !== before) lastKey = '';
    renderDriverDashboard();
  } catch (err) {
    ctx.handleError(err);
  }
}

// ---- GPS ya dereva: mahali panatumwa kila sekunde 20 akiwa online
function startGps() {
  if (gpsWatch !== null || !navigator.geolocation) return;
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      if (Date.now() - lastPing < 20_000) return;
      lastPing = Date.now();
      ctx.api.post('/api/driver/location', { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {});
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15_000 },
  );
}

export function stopGps() {
  if (gpsWatch !== null) navigator.geolocation?.clearWatch(gpsWatch);
  gpsWatch = null;
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-gps'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
  });
}

async function goOnline(body) {
  onlineError = '';
  try {
    driverData = await ctx.api.post('/api/driver/online', { online: true, ...body });
    standPicker = false;
    startGps();
    ctx.toast('Uko online');
  } catch (err) {
    if (ctx.handleError(err)) return;
    onlineError = err.message;
  }
  renderDriverDashboard();
}

async function showStandPicker() {
  standPicker = true;
  renderDriverDashboard();
  try {
    const places = await ctx.api.get('/api/locations');
    const list = $('stand-list');
    if (!list) return;
    list.innerHTML = places.length
      ? places
          .map((p) => `<button class="place" type="button" data-ride="online-at" data-id="${p.id}">${ICON.pin}<span><strong>${esc(p.name)}</strong>${p.area ? `<span class="muted">${esc(p.area)}</span>` : ''}</span></button>`)
          .join('')
      : '<p class="muted">Hakuna maeneo bado.</p>';
  } catch (err) {
    ctx.handleError(err);
  }
}

// =================================================================== VITUFE

async function onClick(event) {
  const el = event.target.closest('[data-ride]');
  if (!el) return;
  const action = el.dataset.ride;
  const id = el.dataset.id;

  // Abiria
  if (action === 'cancel' || action === 'cancel-keep') {
    cancelOpen = action === 'cancel';
    lastKey = '';
    return passengerRide && ctx.isPassengerHome() ? renderPassengerRide(passengerRide) : renderDriverDashboard();
  }
  if (action === 'cancel-confirm') {
    el.disabled = true;
    try {
      await ctx.api.post(`/api/rides/${passengerRide.id}/cancel`, {});
      cancelOpen = false;
      stopPolling();
      passengerRide = null;
      lastKey = '';
      ctx.toast('Safari imeghairiwa');
      return ctx.onPassengerRideClosed();
    } catch (err) {
      if (ctx.handleError(err, 'cancel-error')) return;
      el.disabled = false;
    }
    return;
  }
  if (action === 'close') {
    el.disabled = true;
    try {
      await closePassengerRide();
    } catch (err) {
      ctx.handleError(err);
      el.disabled = false;
    }
    return;
  }

  // Dereva
  if (action === 'reload') return loadDriverDashboard();
  if (action === 'go-online') {
    el.disabled = true;
    el.textContent = 'Inatafuta mahali ulipo…';
    try {
      const pos = await currentPosition();
      return goOnline({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      return showStandPicker();
    }
  }
  if (action === 'online-at') return goOnline({ locationId: id });
  if (action === 'stand-cancel') {
    standPicker = false;
    return renderDriverDashboard();
  }
  if (action === 'go-offline') {
    el.disabled = true;
    try {
      driverData = await ctx.api.post('/api/driver/online', { online: false });
      onlineError = '';
      stopGps();
      ctx.toast('Uko offline');
    } catch (err) {
      if (ctx.handleError(err)) return;
      onlineError = err.message;
    }
    lastKey = '';
    return renderDriverDashboard();
  }
  if (action === 'accept' || action === 'decline') {
    el.disabled = true;
    try {
      driverData = await ctx.api.post(`/api/driver/offers/${id}/${action}`);
      if (action === 'accept') ctx.toast('Umekubali safari');
    } catch (err) {
      if (ctx.handleError(err)) return;
      ctx.toast(err.message);
      driverData = await ctx.api.get('/api/driver/state');
    }
    lastKey = '';
    return renderDriverDashboard();
  }
  if (['arrive', 'start', 'complete'].includes(action)) {
    el.disabled = true;
    try {
      driverData = await ctx.api.post(`/api/driver/rides/${id}/${action}`);
      cancelOpen = false;
    } catch (err) {
      if (ctx.handleError(err, 'step-error')) return;
      el.disabled = false;
      return;
    }
    lastKey = '';
    return renderDriverDashboard();
  }
  if (action === 'driver-close') {
    el.disabled = true;
    try {
      driverData = await ctx.api.post(`/api/driver/rides/${driverData.ride.id}/close`);
    } catch (err) {
      ctx.handleError(err);
    }
    lastKey = '';
    return renderDriverDashboard();
  }
}

function onChange(event) {
  if (event.target.name === 'rating' && $('rate-submit')) $('rate-submit').disabled = false;
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!['rate-driver-form', 'rate-passenger-form', 'driver-cancel-form'].includes(form.id)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (form.id === 'rate-driver-form') {
      const rating = Number(form.querySelector('input[name="rating"]:checked')?.value);
      await ctx.api.post(`/api/rides/${passengerRide.id}/rate`, { rating, comment: $('rate-comment').value });
      stopPolling();
      passengerRide = null;
      lastKey = '';
      ctx.toast('Asante kwa maoni yako');
      return ctx.onPassengerRideClosed();
    }
    if (form.id === 'rate-passenger-form') {
      const rating = Number(form.querySelector('input[name="rating"]:checked')?.value);
      driverData = await ctx.api.post(`/api/driver/rides/${driverData.ride.id}/rate`, { rating });
      ctx.toast('Asante');
    } else {
      driverData = await ctx.api.post(`/api/driver/rides/${driverData.ride.id}/cancel`, { reason: $('cancel-reason').value });
      cancelOpen = false;
      ctx.toast('Safari imeghairiwa');
    }
    lastKey = '';
    renderDriverDashboard();
  } catch (err) {
    if (ctx.handleError(err, form.id === 'driver-cancel-form' ? 'cancel-error' : 'rate-error')) return;
    button.disabled = false;
  }
});

/** Safari za abiria zilizopita (kwa ukurasa wa nyumbani). */
export function historyHtml(list) {
  if (!list || list.length === 0) return '<p class="empty-state">Bado hujasafiri na NAYA.</p>';
  const label = { COMPLETED: ['ok', 'Imekamilika'], CANCELLED: ['muted', 'Imeghairiwa'], NO_DRIVER: ['muted', 'Hakuna dereva'] };
  return `<ul class="trips">${list
    .slice(0, 5)
    .map(
      (r) => `<li><span><strong>${esc(r.destination.name)}</strong><span class="muted">${esc(formatDate(r.requestedAt, true))} · kutoka ${esc(r.pickup.name)}</span></span>
        <span class="trip-right">${r.status === 'COMPLETED' ? `<strong>${formatTsh(r.fare)}</strong>` : ''}<span class="badge badge-${label[r.status][0]}">${label[r.status][1]}</span></span></li>`,
    )
    .join('')}</ul>`;
}
