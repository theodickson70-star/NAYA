// Skrini za safari: abiria (kutafuta → dereva anakuja → safari → nyota) na dereva (online → ombi → safari → mapato).
// Hali mpya inafika papo hapo kupitia realtime (SSE). Polling inabaki kama kinga tu: kila sekunde 4 realtime
// ikiwa imekatika, au kila sekunde 20 ikiwa imeunganishwa (pia ni "mapigo ya moyo" ya dereva aliye online).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';
import { rideMap } from '/shared/map.js';

let ctx = null; // { api, toast, handleError, isPassengerHome, isDriverHome, onPassengerRideClosed, firstName }
const $ = (id) => document.getElementById(id);

let pollTimer = null;
let realtimeUp = false;
let lastFetch = 0;
let pushStatus = null; // 'on' | 'off' | 'denied' | 'server-off' | 'unsupported'
let audio = null;
let tickTimer = null;
let passengerRide = null;
let driverData = null;
let lastKey = '';
let gpsWatch = null;
let lastPing = 0;
let latestPos = null;
let pingTimer = null;
let cancelOpen = false;
let standPicker = false;
let onlineError = '';
let sosSheet = false; // skrini ya "Una dharura?" iko wazi
let sosSending = false;
let shareUrl = ''; // link ya kushiriki (kama simu haina "Share")
let mapView = null; // { rideId, map }
const photos = new Map();
const LIVE = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];

export function init(context) {
  ctx = context;
  ctx.pushState().then((state) => {
    pushStatus = state;
  });
  $('app-content').addEventListener('click', onClick);
  $('app-content').addEventListener('change', onChange);
  $('app-content').addEventListener('input', onInput);
}

export function stopPolling() {
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

/** Realtime imeunganika/imekatika — polling inabadilika kulingana na hilo. */
export function setRealtime(up) {
  realtimeUp = up;
}

/** Tukio la papo hapo kutoka server: chukua hali mpya ya skrini iliyo wazi. */
export function onRealtime(type, data = {}) {
  if (type === 'location') {
    // Dereva amesogea: sogeza pikipiki kwenye ramani na usasishe dakika — bila kupakia skrini upya.
    if (passengerRide && data.rideId === passengerRide.id && ctx.isPassengerHome()) updateLive(data);
    return;
  }
  if (ctx.isPassengerHome() && (type === 'ride' || passengerRide)) return refreshPassenger();
  if (ctx.isDriverHome() && ['offer', 'ride', 'driver'].includes(type)) return refreshDriver();
}

// Polling ya kinga: sekunde 4 bila realtime, sekunde 20 ikiwa realtime iko hai.
const pollDue = () => !realtimeUp || Date.now() - lastFetch >= 20_000;

export function reset() {
  stopPolling();
  stopGps();
  passengerRide = null;
  driverData = null;
  lastKey = '';
  cancelOpen = false;
  standPicker = false;
  sosSheet = false;
  shareUrl = '';
  dropMap();
  for (const url of photos.values()) URL.revokeObjectURL(url);
  photos.clear();
}

function dropMap() {
  mapView?.map?.destroy();
  mapView = null;
}

async function mountMap(ride, points) {
  const el = $('ride-map');
  if (!el) return;
  const view = { rideId: ride.id, map: null };
  mapView = view;
  try {
    view.map = await rideMap(el, points, { focus: ride.status === 'IN_PROGRESS' ? 'destination' : 'pickup' });
  } catch {
    el.innerHTML = '<p class="muted map-fallback">Ramani haikupakia. Angalia internet.</p>';
  }
  if (mapView !== view) view.map?.destroy(); // skrini imebadilika wakati ramani inapakia
}

/** Maandishi ya muda wa kufika (abiria). */
function etaText(ride, eta, km) {
  if (ride.status === 'ACCEPTED') {
    if (eta) return `Anafika baada ya dakika ~${eta}${km != null ? ` · yuko km ${km}` : ''}.`;
    return `Anakuja ${ride.pickup.name}.`;
  }
  if (ride.status === 'IN_PROGRESS') return `Unaelekea ${ride.destination.name}${eta ? ` · dakika ~${eta}` : ''}.`;
  return `Anakusubiri ${ride.pickup.name}.`;
}

function updateLive(data) {
  if (data.lat != null && data.lng != null) mapView?.map?.setDriver({ lat: data.lat, lng: data.lng });
  const el = $('ride-eta');
  if (el && passengerRide) el.textContent = etaText(passengerRide, data.etaMinutes, data.distanceKm);
}

const tel = (phone) => `tel:+${esc(phone)}`;
const mapsLink = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
const ICON = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  dot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.5"/></svg>',
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
  // Umbali/dakika hazimo hapa: zinasasishwa papo hapo bila kuchora skrini upya (ramani isianze upya).
  return [r.status, r.redispatched, r.driver?.name, r.pin, r.sosOpen, r.shared, cancelOpen, sosSheet, shareUrl].join('|');
}

export function renderPassengerRide(ride) {
  if (passengerRide?.id !== ride.id || !LIVE.includes(ride.status)) {
    shareUrl = '';
    sosSheet = false;
  }
  passengerRide = ride;
  const key = passengerKey(ride);
  // Usichore upya kama hakuna kilichobadilika (mf. abiria anaandika maoni au anachagua nyota).
  if (key === lastKey && $('ride-screen')) {
    updateLive({ ...(ride.driver?.location ?? {}), etaMinutes: ride.driver?.etaMinutes, distanceKm: ride.driver?.distanceToPickupKm });
    return ensurePassengerPolling();
  }
  lastKey = key;
  dropMap();

  const d = ride.driver;
  const head = {
    SEARCHING: [
      'searching',
      ride.redispatched ? 'Tunakutafutia dereva mwingine' : 'Tunatafuta dereva karibu nawe…',
      ride.redispatched ? 'Dereva wa awali ameghairi. Usijali — tunamtafuta mwingine sasa hivi.' : 'Safari yako imepokelewa. Subiri kidogo.',
    ],
    ACCEPTED: ['coming', 'Dereva anakuja', etaText(ride, d?.etaMinutes, d?.distanceToPickupKm)],
    ARRIVED: ['arrived', 'Dereva amefika!', etaText(ride)],
    IN_PROGRESS: ['moving', 'Safari inaendelea', etaText(ride, d?.etaMinutes)],
    COMPLETED: ['done', `Umefika ${ride.destination.name}!`, `Lipa dereva ${formatTsh(ride.fare)} taslimu.`],
    NO_DRIVER: ['none', 'Hakuna dereva aliyepatikana karibu kwa sasa', 'Jaribu tena baada ya dakika chache.'],
    CANCELLED: ['none', 'Safari imeghairiwa', ride.cancelledBy === 'ADMIN' ? `Ofisi ya NAYA: ${ride.cancelReason ?? ''}` : ride.cancelReason ?? ''],
  }[ride.status];

  const canCancel = ['SEARCHING', 'ACCEPTED', 'ARRIVED'].includes(ride.status);
  const live = LIVE.includes(ride.status);
  $('app-content').innerHTML = `<div id="ride-screen">
    <section class="ride-head ride-${head[0]}" role="status">
      <span class="ride-pulse" aria-hidden="true"></span>
      <h1>${esc(head[1])}</h1>
      <p id="ride-eta">${esc(head[2])}</p>
    </section>
    ${ride.sosOpen ? sosSentHtml() : ''}
    ${ride.status === 'SEARCHING' ? pushPrompt('Washa arifa ujue dereva akipatikana, hata ukifunga app.') : ''}
    ${live ? '<div class="ride-map" id="ride-map" role="img" aria-label="Ramani: mahali pa kuchukuliwa, unakoenda, na dereva"></div>' : ''}
    ${ride.pin ? pinCardHtml(ride.pin) : ''}
    ${d ? driverCardHtml(ride) : ''}
    ${live ? safetyHtml({ share: true, sosOpen: ride.sosOpen }) : ''}
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
  if (live) mountMap(ride, { pickup: ride.pickup, destination: ride.destination, driver: d?.location });
  ensurePassengerPolling();
}

function pinCardHtml(pin) {
  return `<section class="card pin-card" aria-label="PIN ya safari">
    <span class="pin-label">PIN ya safari</span>
    <strong class="pin-digits">${esc(pin.split('').join(' '))}</strong>
    <span class="muted">Mpe dereva PIN hii ukishapanda — kwanza hakikisha plate ni sahihi.</span>
  </section>`;
}

/** Shiriki safari (abiria) + Dharura (abiria na dereva). */
function safetyHtml({ share, sosOpen }) {
  const sheet = sosSheet
    ? `<section class="card sos-sheet" role="alertdialog" aria-labelledby="sos-title">
        <h2 id="sos-title">Una dharura?</h2>
        <p class="muted">Ofisi ya NAYA itapata ujumbe wako papo hapo pamoja na safari hii na mahali ulipo, na itakupigia.</p>
        <p class="alert alert-danger" id="sos-error" role="alert" hidden></p>
        <button class="btn btn-danger btn-block btn-big" type="button" data-ride="sos-send"${sosSending ? ' disabled' : ''}>${
          sosSending ? 'Inatuma…' : 'Tuma dharura kwa ofisi ya NAYA'
        }</button>
        <a class="btn btn-ghost btn-block" href="tel:112">${ICON.phone} Piga Polisi · 112</a>
        <button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="sos-close">Rudi</button>
      </section>`
    : '';
  const shareBox = shareUrl
    ? `<section class="card share-card">
        <p><strong>Tuma link hii kwa ndugu au rafiki</strong><br><span class="muted">Ataona safari yako na dereva kwenye ramani mpaka ufike.</span></p>
        <input id="share-url" readonly value="${esc(shareUrl)}" aria-label="Link ya safari">
        <div class="actions two">
          <a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(`Fuatilia safari yangu ya NAYA: ${shareUrl}`)}" target="_blank" rel="noopener">WhatsApp</a>
          <button class="btn btn-ghost" type="button" data-ride="share-copy">Nakili link</button>
        </div>
      </section>`
    : '';
  return `${sheet}<div class="safety-row">
      ${share ? `<button class="btn btn-ghost" type="button" data-ride="share">${ICON.share} Shiriki safari</button>` : ''}
      ${sosOpen ? '' : `<button class="btn btn-ghost sos-button" type="button" data-ride="sos-open">${ICON.alert} Dharura</button>`}
    </div>${shareBox}`;
}

function sosSentHtml() {
  return `<p class="alert alert-sos" role="alert"><strong>Dharura imetumwa.</strong> Ofisi ya NAYA imepokea na itakupigia sasa hivi. Ukiwa hatarini piga <a href="tel:112">112</a>.</p>`;
}

function quickPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 30_000 },
    );
  });
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
  pollTimer = setInterval(() => {
    if (!ctx.isPassengerHome() || document.visibilityState !== 'visible' || !pollDue()) return;
    refreshPassenger();
  }, 4000);
}

async function refreshPassenger() {
  lastFetch = Date.now();
  try {
    const ride = await fetchCurrentRide();
    if (!ride) {
      if (!passengerRide) return;
      dropMap();
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
}

function pushPrompt(text) {
  if (pushStatus !== 'off') return '';
  return `<div class="push-prompt" role="note">
    <p>${esc(text)}</p>
    <button class="btn btn-ghost" type="button" data-ride="enable-push">Washa arifa</button>
  </div>`;
}

async function closePassengerRide() {
  await ctx.api.post(`/api/rides/${passengerRide.id}/close`);
  dropMap();
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
  return [
    s.online,
    s.offer?.id,
    s.ride?.id,
    s.ride?.status,
    s.ride?.sosOpen,
    s.earnings.today.total,
    s.subscription?.state,
    s.subscription?.daysLeft,
    standPicker,
    cancelOpen,
    sosSheet,
    onlineError,
    pushStatus,
  ].join('|');
}

function renderDriverDashboard() {
  if (!ctx.isDriverHome()) return;
  const s = driverData;
  const key = driverKey(s);
  if (key === lastKey && $('driver-screen')) return;
  lastKey = key;
  clearInterval(tickTimer);
  if (!s.ride || !LIVE.includes(s.ride.status)) sosSheet = false;

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

  if (s.offer && !s.ride) startOfferCountdown(s.offer.secondsLeft, s.offer.totalSeconds || 60);
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
  const sub = s.subscription;
  if (!s.online && sub?.state === 'EXPIRED') return subscriptionBlockHtml(sub);
  if (!s.online) {
    return `<section class="go-online">
      <h1>Habari, ${ctx.firstName()}</h1>
      <p class="muted">Ukiwa online utapokea maombi ya safari yaliyo karibu nawe.</p>
      ${onlineError ? `<p class="alert alert-danger" role="alert">${esc(onlineError)}</p>` : ''}
      <button class="online-button" type="button" data-ride="go-online">NENDA ONLINE</button>
      ${subscriptionNoteHtml(sub)}
      ${pushPrompt('Washa arifa ili simu ilie ombi la safari likiingia, hata app ikiwa imefungwa.')}
    </section>`;
  }
  return `<section class="go-online is-online" role="status">
    <span class="ride-pulse" aria-hidden="true"></span>
    <h1>Uko online</h1>
    <p class="muted">${pushStatus === 'on' ? 'Unasubiri maombi ya safari. Simu italia ombi likiingia.' : 'Unasubiri maombi ya safari. Acha app wazi.'}</p>
    ${onlineError ? `<p class="alert alert-danger" role="alert">${esc(onlineError)}</p>` : ''}
    ${
      s.serviceArea?.far
        ? `<p class="alert alert-warn" role="note">Uko km ${esc(s.serviceArea.km)} kutoka ${esc(s.serviceArea.nearest)}, eneo la karibu la NAYA. Utapokea maombi ya wateja walio ndani ya km ${esc(s.serviceArea.pickupKm)} kutoka ulipo tu.</p>`
        : ''
    }
    ${pushPrompt('Washa arifa ili usikose ombi hata ukifunga app.')}
    <button class="btn btn-ghost btn-block" type="button" data-ride="go-offline">Nenda offline</button>
    ${subscriptionNoteHtml(sub)}
  </section>`;
}

// ---- Ada ya mwezi
function subscriptionNoteHtml(sub) {
  if (!sub || sub.state === 'NONE') return '';
  if (sub.state === 'GRACE' || sub.state === 'EXPIRED') {
    return `<p class="alert alert-warn sub-note" role="note"><strong>Ada yako ya mwezi imeisha.</strong> Lipa ${formatTsh(sub.monthlyFee)} kabla ya ${esc(
      formatDate(sub.graceEndsAt, true),
    )} uendelee kupokea safari. <a href="#/akaunti">Jinsi ya kulipa</a></p>`;
  }
  if (sub.daysLeft <= 3) {
    return `<p class="alert alert-warn sub-note" role="note">Ada yako inaisha ${sub.daysLeft <= 1 ? 'kesho' : `baada ya siku ${sub.daysLeft}`} (${esc(
      formatDate(sub.paidUntil),
    )}). Lipa ${formatTsh(sub.monthlyFee)} mapema. <a href="#/akaunti">Jinsi ya kulipa</a></p>`;
  }
  return `<p class="sub-line">Ada ya mwezi iko hai mpaka ${esc(formatDate(sub.paidUntil))}</p>`;
}

function subscriptionBlockHtml(sub) {
  return `<section class="card sub-block" role="alert">
    <h1>Ada ya mwezi imeisha</h1>
    <p>Lipa <strong>${formatTsh(sub.monthlyFee)}</strong> kwa mwezi ili uendelee kupokea safari za NAYA.</p>
    <p class="sub-how">${esc(sub.paymentInstructions)}</p>
    <p class="muted">Ofisi ikishapokea malipo yako, utaweza kwenda online mara moja.</p>
    <button class="btn btn-primary btn-block" type="button" data-ride="reload">Nimeshalipa — angalia tena</button>
  </section>`;
}

function offerHtml(offer) {
  const r = offer.ride;
  return `<section class="offer" role="alertdialog" aria-labelledby="offer-title">
    <div class="offer-top"><h1 id="offer-title">Ombi jipya la safari</h1><span class="offer-timer" id="offer-seconds" style="--p:${offer.secondsLeft / (offer.totalSeconds || 60)}">${clock(offer.secondsLeft)}</span></div>
    <p class="offer-fare">${formatTsh(r.fare)}</p>
    <p class="muted">${esc(VEHICLE_TYPES[r.vehicleType])} · safari ya km ${r.distanceKm} · abiria yuko km ${offer.distanceToPickupKm} kutoka kwako</p>
    ${routeSummary(r).replace(/<p class="ride-meta">[\s\S]*<\/p>/, '')}
    <p class="alert alert-danger" id="offer-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block btn-big" type="button" data-ride="accept" data-id="${offer.id}">Kubali</button>
    <button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="decline" data-id="${offer.id}">Kataa</button>
  </section>`;
}

/** Kengele fupi ya ombi jipya (AudioContext inafunguliwa dereva anapobonyeza NENDA ONLINE). */
function chime() {
  if (!audio) return;
  try {
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1175, 880].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.21);
    }
  } catch {
    // sauti haipatikani — mtetemo unatosha
  }
}

/** 185 → "3:05"; 42 → "0:42" */
const clock = (sec) => {
  const n = Math.max(0, Math.floor(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function startOfferCountdown(seconds, total) {
  navigator.vibrate?.([300, 150, 300]);
  chime();
  let left = seconds;
  const ring = (n) => $('offer-seconds')?.style.setProperty('--p', String(Math.max(0, n) / total));
  ring(left);
  tickTimer = setInterval(() => {
    left -= 1;
    const el = $('offer-seconds');
    if (el) el.textContent = clock(left);
    ring(left);
    // Ombi linadumu dakika 1: kumbusha dereva kila sekunde 20 (kengele + mtetemo) mpaka akubali au akatae.
    if (left > 0 && (seconds - left) % 20 === 0) {
      navigator.vibrate?.([300, 150, 300]);
      chime();
    }
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
  const needsPin = ride.status === 'ARRIVED' && ride.pinRequired;
  const action = needsPin
    ? `<form class="card pin-form" id="pin-form" novalidate>
        <label for="start-pin">PIN ya abiria</label>
        <input id="start-pin" class="pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="• • • •">
        <p class="muted">Muulize abiria PIN iliyo kwenye app yake, kisha anza safari.</p>
        <p class="alert alert-danger" id="step-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block btn-big" type="submit" id="start-button" data-id="${ride.id}" disabled>Anza safari</button>
      </form>`
    : `<p class="alert alert-danger" id="step-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block btn-big" type="button" data-ride="${step.action}" data-id="${ride.id}">${step.label}</button>`;
  return `${ride.sosOpen ? sosSentHtml() : ''}<section class="ride-head ride-coming"><h1>${esc(step.title)}</h1><p>${esc(step.sub)}</p></section>
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
    ${action}
    ${safetyHtml({ share: false, sosOpen: ride.sosOpen })}
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
    if (!ctx.isDriverHome() || document.visibilityState !== 'visible' || !pollDue()) return;
    if (driverData?.online || driverData?.ride || driverData?.offer) refreshDriver();
  }, 4000);
}

async function refreshDriver() {
  lastFetch = Date.now();
  try {
    const before = driverData?.offer?.id;
    driverData = await ctx.api.get('/api/driver/state');
    if (driverData.offer && driverData.offer.id !== before) lastKey = '';
    renderDriverDashboard();
  } catch (err) {
    ctx.handleError(err);
  }
}

// ---- GPS ya dereva: kila sekunde 20 akiwa online; kila sekunde 5 akiwa na safari (abiria anamwona kwenye ramani)
function startGps() {
  if (gpsWatch !== null || !navigator.geolocation) return;
  gpsWatch = navigator.geolocation.watchPosition(
    (pos) => {
      latestPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const onTrip = driverData?.ride && LIVE.includes(driverData.ride.status);
      const wait = (onTrip ? 5_000 : 20_000) - (Date.now() - lastPing);
      // Mahali pa mwisho panatumwa mwisho wa kipindi (hata simu ikiacha kutuma mabadiliko baadaye).
      clearTimeout(pingTimer);
      if (wait <= 0) sendPing();
      else pingTimer = setTimeout(sendPing, wait);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5_000 },
  );
}

function sendPing() {
  if (!latestPos || gpsWatch === null) return;
  lastPing = Date.now();
  ctx.api.post('/api/driver/location', latestPos).catch(() => {});
}

export function stopGps() {
  clearTimeout(pingTimer);
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
    if (err.status === 402) {
      // ada imeisha — onyesha skrini ya kulipa
      driverData = await ctx.api.get('/api/driver/state').catch(() => driverData);
      standPicker = false;
    } else onlineError = err.message;
  }
  lastKey = '';
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
      dropMap();
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

  // Usalama (abiria na dereva)
  if (action === 'share') {
    el.disabled = true;
    try {
      const { path } = await ctx.api.post(`/api/rides/${passengerRide.id}/share`);
      const url = `${location.origin}${path}`;
      const d = passengerRide.driver;
      const text = `Fuatilia safari yangu ya NAYA${d ? ` (${d.name}, ${d.plateNumber})` : ''}:`;
      let shared = false;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Safari yangu ya NAYA', text, url });
          shared = true;
        } catch {
          // mtumiaji ameghairi au haiwezekani — onyesha link
        }
      }
      if (shared) ctx.toast('Link ya safari imetumwa');
      else shareUrl = url;
    } catch (err) {
      if (ctx.handleError(err)) return;
      ctx.toast(err.message);
    }
    el.disabled = false;
    lastKey = '';
    return renderPassengerRide(passengerRide);
  }
  if (action === 'share-copy') {
    try {
      await navigator.clipboard.writeText(shareUrl);
      ctx.toast('Link imenakiliwa');
    } catch {
      $('share-url')?.select();
      ctx.toast('Bonyeza link kwa muda, kisha "Copy"');
    }
    return;
  }
  if (action === 'sos-open' || action === 'sos-close') {
    sosSheet = action === 'sos-open';
    lastKey = '';
    return rerender();
  }
  if (action === 'sos-send') {
    const rideId = passengerRide && ctx.isPassengerHome() ? passengerRide.id : driverData?.ride?.id;
    if (!rideId || sosSending) return;
    sosSending = true;
    lastKey = '';
    rerender();
    try {
      const where = await quickPosition();
      await ctx.api.post('/api/sos', { rideId, ...(where ?? {}) });
      sosSheet = false;
      navigator.vibrate?.(300);
      ctx.toast('Dharura imetumwa kwa ofisi ya NAYA');
      if (passengerRide && ctx.isPassengerHome()) passengerRide = { ...passengerRide, sosOpen: true };
      else if (driverData?.ride) driverData = { ...driverData, ride: { ...driverData.ride, sosOpen: true } };
    } catch (err) {
      if (ctx.handleError(err)) return;
      sosSending = false;
      lastKey = '';
      rerender();
      const box = $('sos-error');
      if (box) {
        box.textContent = err.message;
        box.hidden = false;
      }
      return;
    }
    sosSending = false;
    lastKey = '';
    return rerender();
  }

  // Dereva
  if (action === 'reload') return loadDriverDashboard();
  if (action === 'enable-push') {
    el.disabled = true;
    try {
      await ctx.enablePush();
      pushStatus = 'on';
      ctx.toast('Arifa zimewashwa');
    } catch (err) {
      ctx.toast(err.message);
      pushStatus = await ctx.pushState();
    }
    lastKey = '';
    return passengerRide && ctx.isPassengerHome() ? renderPassengerRide(passengerRide) : renderDriverDashboard();
  }
  if (action === 'go-online') {
    // Kubonyeza huku kunafungua sauti ya kengele ya maombi (browsers zinahitaji mtumiaji aguse kwanza).
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      audio.resume?.();
    } catch {
      audio = null;
    }
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

function rerender() {
  return passengerRide && ctx.isPassengerHome() ? renderPassengerRide(passengerRide) : renderDriverDashboard();
}

function onInput(event) {
  if (event.target.id !== 'start-pin') return;
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
  const button = $('start-button');
  if (button) button.disabled = event.target.value.length !== 4;
}

function onChange(event) {
  if (event.target.name === 'rating' && $('rate-submit')) $('rate-submit').disabled = false;
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!['rate-driver-form', 'rate-passenger-form', 'driver-cancel-form', 'pin-form'].includes(form.id)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  if (form.id === 'pin-form') {
    try {
      driverData = await ctx.api.post(`/api/driver/rides/${button.dataset.id}/start`, { pin: $('start-pin').value });
      cancelOpen = false;
      lastKey = '';
      ctx.toast('Safari imeanza');
      renderDriverDashboard();
    } catch (err) {
      if (ctx.handleError(err, 'step-error')) return;
      $('start-pin').value = '';
      $('start-pin').focus();
    }
    return;
  }
  try {
    if (form.id === 'rate-driver-form') {
      const rating = Number(form.querySelector('input[name="rating"]:checked')?.value);
      await ctx.api.post(`/api/rides/${passengerRide.id}/rate`, { rating, comment: $('rate-comment').value });
      dropMap();
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
