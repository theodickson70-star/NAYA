// App moja ya NAYA: akaunti moja → "Utatumiaje NAYA?" → mode ya Abiria au Dereva → Akaunti → Badili mode.
import { createApi, escapeHtml as esc } from '/shared/api.js';
import {
  DOCUMENT_ORDER,
  DOCUMENT_STATUS,
  DOCUMENTS,
  DRIVER_STATUS,
  formatDate,
  formatPhone,
  formatTsh,
  LOCATION_CATEGORIES,
  VEHICLE_TYPES,
} from '/shared/labels.js';
import { isNativeApp, nativeInfo, openFullScreenSettings, openNotificationSettings, resetNativeRegistration, syncNative, testRing } from '/shared/native.js';
import { disablePush, enablePush, pushState } from '/shared/push.js';
import { connectRealtime } from '/shared/realtime.js';
import { introSeen, setupIntro } from './intro.js';
import { nearbyMap } from '/shared/map.js';
import * as rides from './rides.js';
import * as support from './support.js';
import * as feedback from './feedback.js';
import * as terms from './terms.js';
import { finishSplash, previewSound, setSoundEnabled, soundEnabled, splashActive, splashReady } from './splash.js';

const api = createApi('naya_app_token');
const $ = (id) => document.getElementById(id);
const views = ['view-loading', 'view-intro', 'view-auth', 'view-verify', 'view-role', 'view-offline', 'view-app'];
const MAX_BYTES = 3 * 1024 * 1024;
const VERSION = '0.11.3';

let account = null; // { user, activeMode, driverStatus, canDrive }
let driver = null; // wasifu wa udereva (mode ya Dereva)
let tab = 'home';
let editingVehicle = false;
let uploadingType = null;
let pendingUploadType = null;
const thumbs = new Map();
// Safari inayopangwa na abiria (Phase 4: makadirio ya nauli; kuagiza kunakuja Phase 5).
const trip = { pickup: null, destination: null, estimate: null, estimateError: null, selected: null, gps: 'idle', loading: false };
let places = null; // maeneo ya huduma (cache)
let tripHistory = null; // safari za abiria zilizopita (cache)
let realtime = null; // muunganisho wa taarifa za papo hapo

// Akaunti ya zamani ya app ya dereva: mtu asilazimike kuingia upya.
try {
  const legacy = localStorage.getItem('naya_driver_token');
  if (legacy && !api.token) api.setToken(legacy);
  localStorage.removeItem('naya_driver_token');
} catch {
  // storage imezuiwa
}

// Skrini moja inaonekana kwa wakati mmoja. Animation ya kufunguka ikiwa bado inaendelea, skrini inayofuata inasubiri
// iishe (kisha zinapishana kwa ulaini).
let pendingView = null;
function show(view) {
  if (view !== 'view-loading' && splashActive()) {
    const waiting = pendingView !== null;
    pendingView = view;
    if (!waiting) {
      splashReady().then(() => {
        const next = pendingView;
        pendingView = null;
        finishSplash();
        reveal(next);
      });
    }
    return;
  }
  reveal(view);
}

function reveal(view) {
  for (const v of views) {
    const el = $(v);
    if (v === 'view-loading' && el.classList.contains('splash-out')) continue; // inafifia yenyewe
    const visible = v === view;
    if (visible && el.hidden) {
      el.classList.remove('view-enter');
      void el.offsetWidth; // anza animation upya
      el.classList.add('view-enter');
    }
    el.hidden = !visible;
  }
}

/** Kisanduku cha namba 6 za SMS: kinaonyesha tarakimu zilizoandikwa kwenye input iliyofichika. */
function syncOtp(input) {
  const boxes = input.parentElement.querySelectorAll('.otp-boxes span');
  const v = input.value;
  boxes.forEach((b, i) => {
    b.textContent = v[i] ?? '';
    b.classList.toggle('filled', i < v.length);
    b.classList.toggle('active', document.activeElement === input && i === Math.min(v.length, 5));
  });
}
for (const input of document.querySelectorAll('.otp-input')) {
  for (const type of ['input', 'focus', 'blur']) input.addEventListener(type, () => syncOtp(input));
}

// Sauti ya kufungua NAYA (Akaunti)
document.addEventListener('change', (event) => {
  if (event.target.id !== 'sound-toggle') return;
  setSoundEnabled(event.target.checked);
  toast(event.target.checked ? 'Sauti imewashwa' : 'Sauti imezimwa');
});
document.addEventListener('click', (event) => {
  if (event.target.id !== 'sound-test') return;
  previewSound().catch(() => toast('Simu imezuia sauti. Ongeza sauti ya simu kisha ujaribu tena.'));
});

// Onyesha / ficha password
document.addEventListener('click', (event) => {
  const eye = event.target.closest('[data-eye]');
  if (!eye) return;
  event.preventDefault();
  const input = $(eye.dataset.eye);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  eye.classList.toggle('on', !showing);
  eye.setAttribute('aria-label', showing ? 'Onyesha password' : 'Ficha password');
});

function toast(message) {
  for (const old of document.querySelectorAll('.toast')) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

/** Kosa la mtandao/server → ujumbe rafiki; token imekataliwa → rudi kwenye kuingia. */
function handleError(err, boxId) {
  if (err.status === 401) return signOutLocally(), true;
  const box = boxId && $(boxId);
  if (box) {
    box.textContent = err.message;
    box.hidden = false;
  }
  return false;
}

// ---------- Kuingia / kujisajili ----------
function selectTab(name) {
  const register = name === 'register';
  $('tab-register').setAttribute('aria-selected', String(register));
  $('tab-login').setAttribute('aria-selected', String(!register));
  $('register-form').hidden = !register;
  $('login-form').hidden = register;
  document.querySelector('#view-auth .segmented').dataset.active = register ? 'register' : 'login';
  $('auth-title').textContent = register ? 'Karibu NAYA' : 'Karibu tena';
}
$('tab-register').addEventListener('click', () => selectTab('register'));
$('tab-login').addEventListener('click', () => selectTab('login'));

async function submitAuth(event, work, errorId) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const label = button.textContent;
  $(errorId).hidden = true;
  button.disabled = true;
  button.textContent = 'Subiri…';
  try {
    const result = await work();
    api.setToken(result.token);
    await loadAccount();
  } catch (err) {
    $(errorId).textContent = err.message;
    $(errorId).hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$('register-form').addEventListener('submit', (e) =>
  submitAuth(
    e,
    () => {
      if (!$('reg-terms').checked) throw new Error('Weka alama kwenye kisanduku kukubali Masharti ya Huduma na Sera ya Faragha.');
      return api.post('/api/auth/register', {
        fullName: $('reg-name').value,
        phone: $('reg-phone').value,
        password: $('reg-password').value,
        acceptTerms: true,
      });
    },
    'register-error',
  ),
);
$('login-form').addEventListener('submit', (e) =>
  submitAuth(
    e,
    () => api.post('/api/auth/login', { phone: $('login-phone').value, password: $('login-password').value, portal: 'app' }),
    'login-error',
  ),
);

// ---------- Umesahau password (SMS) ----------
const forgot = { phone: '', step: 'phone', timer: null };

function showForgot(open) {
  $('login-form').hidden = open;
  $('forgot-form').hidden = !open;
  document.querySelector('#view-auth .segmented').hidden = open;
  if (open) {
    forgot.step = 'phone';
    $('forgot-step-phone').hidden = false;
    $('forgot-step-code').hidden = true;
    $('forgot-submit').textContent = 'Tuma namba kwa SMS';
    $('forgot-error').hidden = true;
    $('forgot-phone').value = $('login-phone').value;
    $('forgot-phone').focus();
  } else clearInterval(forgot.timer);
}

/** Hesabu ya kurudi nyuma kwenye kitufe cha "Tuma tena". */
function countdown(buttonId, seconds, label, holder) {
  clearInterval(holder.timer);
  const button = $(buttonId);
  let left = seconds;
  const tick = () => {
    button.disabled = left > 0;
    button.textContent = left > 0 ? `${label} (sekunde ${left})` : label;
    left -= 1;
    if (left < -1) clearInterval(holder.timer);
  };
  tick();
  holder.timer = setInterval(tick, 1000);
}

async function requestReset() {
  const { retryAfter } = await api.post('/api/auth/password/forgot', { phone: forgot.phone });
  countdown('forgot-resend', retryAfter, 'Tuma tena', forgot);
}

$('forgot-link').addEventListener('click', () => showForgot(true));
$('forgot-back').addEventListener('click', () => showForgot(false));
$('forgot-resend').addEventListener('click', async () => {
  $('forgot-error').hidden = true;
  try {
    await requestReset();
    toast('SMS imetumwa tena');
  } catch (err) {
    handleError(err, 'forgot-error');
  }
});
$('forgot-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});
$('forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('forgot-submit');
  $('forgot-error').hidden = true;
  button.disabled = true;
  try {
    if (forgot.step === 'phone') {
      forgot.phone = $('forgot-phone').value;
      await requestReset();
      forgot.step = 'code';
      $('forgot-step-phone').hidden = true;
      $('forgot-step-code').hidden = false;
      $('forgot-sent-to').textContent = `Kama ${forgot.phone} imesajiliwa NAYA, utapokea SMS sasa hivi. Andika namba yake na password mpya.`;
      button.textContent = 'Badilisha password';
      $('forgot-code').focus();
    } else {
      const password = $('forgot-password').value;
      await api.post('/api/auth/password/reset', { phone: forgot.phone, code: $('forgot-code').value, password });
      const result = await api.post('/api/auth/login', { phone: forgot.phone, password, portal: 'app' });
      api.setToken(result.token);
      showForgot(false);
      $('forgot-code').value = '';
      $('forgot-password').value = '';
      syncOtp($('forgot-code'));
      toast('Password imebadilishwa');
      await loadAccount();
    }
  } catch (err) {
    handleError(err, 'forgot-error');
  } finally {
    button.disabled = false;
  }
});

// ---------- Kuthibitisha namba ya simu (SMS) ----------
const verify = { timer: null };

function showVerify() {
  show('view-verify');
  $('verify-sent-to').textContent = `Tumetuma SMS yenye namba ya tarakimu 6 kwenda ${formatPhone(account.user.phone)}.`;
  $('verify-code').value = '';
  syncOtp($('verify-code'));
  $('verify-submit').disabled = true;
  $('verify-error').hidden = true;
  countdown('verify-resend', 60, 'Tuma SMS tena', verify);
  $('verify-code').focus();
}

$('verify-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  $('verify-submit').disabled = e.target.value.length !== 6;
});
$('verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('verify-submit');
  $('verify-error').hidden = true;
  button.disabled = true;
  try {
    await api.post('/api/auth/phone/verify', { code: $('verify-code').value });
    clearInterval(verify.timer);
    toast('Namba imethibitishwa');
    await loadAccount();
  } catch (err) {
    if (handleError(err, 'verify-error')) return;
    $('verify-code').value = '';
    $('verify-code').focus();
    syncOtp($('verify-code'));
  }
});
$('verify-resend').addEventListener('click', async () => {
  $('verify-error').hidden = true;
  try {
    const { retryAfter } = await api.post('/api/auth/phone/send-code');
    countdown('verify-resend', retryAfter, 'Tuma SMS tena', verify);
    toast('SMS imetumwa tena');
  } catch (err) {
    if (err.status === 429 && /sekunde (\d+)/.test(err.message)) {
      countdown('verify-resend', Number(err.message.match(/sekunde (\d+)/)[1]), 'Tuma SMS tena', verify);
    }
    handleError(err, 'verify-error');
  }
});
$('verify-logout').addEventListener('click', () => {
  clearInterval(verify.timer);
  signOutLocally();
  selectTab('register');
});

// ---------- Akaunti na mode ----------
async function loadAccount() {
  account = await api.get('/api/account');
  if (account.verificationRequired) return showVerify();
  startRealtime();
  // App ya Android: sajili simu hii kwa kengele ya maombi (kimya; ruhusa ikiwa imeshatolewa).
  syncNative(api).catch(() => {});
  askTermsIfNeeded();
  if (!account.activeMode) return showRoleChoice();
  show('view-app');
  route();
}

/** Watumiaji wa zamani (kabla ya masharti) au toleo jipya la masharti: wakubali kwanza. */
function askTermsIfNeeded() {
  const t = account?.terms;
  if (!t || (t.accepted && t.driverAccepted !== false)) return;
  terms.askToAccept({
    api,
    needDriver: t.driverAccepted === false,
    onDone: (state) => {
      account.terms = state;
      toast('Asante! Umekubali masharti ya NAYA.');
    },
  });
}

function showRoleChoice() {
  show('view-role');
  $('role-form').reset();
  $('role-continue').disabled = true;
  $('role-error').hidden = true;
}

$('role-form').addEventListener('change', () => {
  $('role-continue').disabled = !$('role-form').querySelector('input[name="mode"]:checked');
});

$('role-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = $('role-form').querySelector('input[name="mode"]:checked')?.value;
  if (!mode) return;
  const button = $('role-continue');
  button.disabled = true;
  button.textContent = 'Subiri…';
  try {
    await switchMode(mode, { goHome: true });
  } catch (err) {
    handleError(err, 'role-error');
    button.disabled = false;
  } finally {
    button.textContent = 'Endelea';
  }
});

async function switchMode(mode, { goHome } = {}) {
  account = await api.put('/api/account/mode', { mode });
  rides.stopPolling();
  if (mode === 'PASSENGER') rides.stopGps();
  driver = null;
  editingVehicle = false;
  show('view-app');
  if (goHome && location.hash !== '#/') location.hash = '#/';
  else route();
}

// ---------- Taarifa za papo hapo ----------
function startRealtime() {
  if (realtime) return;
  realtime = connectRealtime(api, {
    onStatus: (up) => {
      rides.setRealtime(up);
      const dot = $('live-dot');
      if (dot) {
        dot.classList.toggle('on', up);
        dot.title = up ? 'Taarifa za papo hapo zimeunganishwa' : 'Inaunganisha upya…';
      }
    },
    onEvent: async (type, data) => {
      if (!account) return;
      if (type === 'support') {
        // Ofisi imejibu / ujumbe au tangazo kutoka ofisi: sasisha alama na ukurasa ulio wazi tu.
        try {
          account = await api.get('/api/account');
          setSupportDot();
          if (support.openTicketId()) support.renderTicket(support.openTicketId());
          else if (tab === 'account' && location.hash === '#/akaunti') {
            // Usifute maoni anayoandika sasa hivi — sasisha orodha tu.
            if (feedback.isTyping()) {
              feedback.loadCardList();
              support.loadCardList();
            } else renderAccount();
          }
        } catch (err) {
          handleError(err);
        }
        return;
      }
      if (type === 'account') {
        // mf. ofisi imekuthibitisha kuwa dereva
        try {
          account = await api.get('/api/account');
          driver = null;
          setSupportDot();
          if (tab === 'home') route();
          else if (tab === 'account' && location.hash === '#/akaunti') renderAccount();
        } catch (err) {
          handleError(err);
        }
        return;
      }
      rides.onRealtime(type, data);
    },
  });
}

// ---------- Njia (tabs) ----------
function route() {
  if (!account) return;
  rides.stopPolling();
  stopNearby();
  tab = location.hash.startsWith('#/akaunti') ? 'account' : 'home';
  const picker = location.hash.match(/^#\/chagua\/(kwenda|kutoka)/)?.[1] ?? null;
  for (const a of document.querySelectorAll('[data-tab]')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const driverMode = account.activeMode === 'DRIVER';
  document.querySelector('.bar').classList.toggle('driver', driverMode);
  $('bar-icon').src = driverMode ? '/shared/brand/naya-dereva-icon.svg' : '/shared/brand/naya-icon-light.svg';
  document.body.classList.toggle('mode-driver', driverMode);
  try {
    localStorage.setItem('naya_last_mode', account.activeMode);
  } catch {
    // storage imezuiwa
  }
  const content = $('app-content');
  content.classList.remove('page-enter');
  void content.offsetWidth;
  content.classList.add('page-enter');
  $('mode-chip').textContent = driverMode ? 'Dereva' : 'Abiria';
  document.querySelector('meta[name="theme-color"]').content = driverMode ? '#043A22' : '#06502F';
  window.scrollTo(0, 0);
  const supportPath = location.hash.match(/^#\/akaunti\/msaada(?:\/([0-9a-f-]{36}))?/);
  if (supportPath) return supportPath[1] ? support.renderTicket(supportPath[1]) : support.renderNew();
  if (tab === 'account') return renderAccount();
  if (driverMode) return loadDriver();
  if (picker) return renderPicker(picker === 'kwenda' ? 'destination' : 'pickup');
  renderPassengerHome();
}
window.addEventListener('hashchange', route);

const firstName = () => esc(account.user.fullName.split(' ')[0]);
const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Dar_es_Salaam' }).format(new Date()));
  return h < 12 ? 'Habari za asubuhi' : h < 16 ? 'Habari za mchana' : 'Habari za jioni';
};
const VEHICLE_ICON = {
  BODABODA:
    '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="11" cy="33" r="7"/><circle cx="37" cy="33" r="7"/><path d="M11 33l8-13h10l5 8h3"/><path d="M26 12h6l4 8"/><path d="M19 20l-3-5h-5"/></svg>',
  BAJAJI:
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 33V18a8 8 0 0 1 8-8h14l9 11v12"/><path d="M7 21h31"/><path d="M22 10v11"/><circle cx="13" cy="34" r="5"/><circle cx="35" cy="34" r="5"/><path d="M18 34h12"/></svg>',
};

// ---------- Mode ya Abiria ----------
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const DOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg>';
const GPS_MESSAGES = {
  denied: 'Umezuia ruhusa ya mahali. Chagua unapoanzia kwenye orodha.',
  unavailable: 'GPS haipatikani. Washa Location kwenye simu, au chagua unapoanzia kwenye orodha.',
  timeout: 'GPS imechelewa kupata mahali ulipo. Chagua unapoanzia kwenye orodha.',
};

async function loadPlaces() {
  if (places) return places;
  places = await api.get('/api/locations');
  return places;
}

function pickupLabel() {
  if (trip.pickup?.type === 'gps') return 'Mahali ulipo sasa (GPS)';
  if (trip.pickup?.type === 'location') return trip.pickup.name;
  if (trip.gps === 'locating') return 'Inatafuta mahali ulipo…';
  return 'Chagua unapoanzia';
}

const onPassengerHome = () => account?.activeMode === 'PASSENGER' && tab === 'home' && !location.hash.startsWith('#/chagua');

async function renderPassengerHome() {
  const ds = account.driverStatus;
  // Safari inayoendelea (au iliyoisha bila kufungwa) inachukua skrini nzima.
  try {
    const ride = await rides.fetchCurrentRide();
    if (ride) {
      if (onPassengerHome()) rides.renderPassengerRide(ride);
      return;
    }
  } catch (err) {
    if (handleError(err)) return;
  }
  try {
    tripHistory ??= await api.get('/api/rides/history');
  } catch {
    tripHistory = null;
  }
  let planner;
  try {
    const list = await loadPlaces();
    planner = list.length === 0 ? '<p class="muted">NAYA bado inaandaa maeneo ya Urambo. Jaribu tena baadaye.</p>' : tripPlanner();
  } catch (err) {
    if (handleError(err)) return;
    planner = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>
      <button class="btn btn-ghost" type="button" data-action="reload-places">Jaribu tena</button>`;
  }
  if (tab !== 'home' || account.activeMode !== 'PASSENGER' || location.hash.startsWith('#/chagua')) return;
  $('app-content').innerHTML = `
    <section class="home-hero">
      <p class="home-hello">${greeting()}, ${firstName()}</p>
      <h1 id="where-title">Unaenda wapi?</h1>
      <img class="home-hero-photo" src="/shared/img/naya-hero-sm.webp" alt="" width="396" height="233">
    </section>
    <section class="card trip trip-card" aria-labelledby="where-title">
      ${planner}
    </section>
    <section class="card nearby-card" aria-labelledby="nearby-title">
      <div class="nearby-head"><h2 id="nearby-title">NAYA karibu nawe</h2><span class="nearby-live"><i></i>Live</span></div>
      <p class="nearby-summary" id="nearby-summary">Inatafuta bodaboda zilizo karibu…</p>
      <div class="nearby-map" id="nearby-map" role="img" aria-label="Ramani ya bodaboda na bajaji zilizo karibu nawe"></div>
    </section>
    <section class="card">
      <h2>Safari zako</h2>
      ${rides.historyHtml(tripHistory)}
    </section>
    ${
      ds
        ? `<section class="card">
            <h2>Udereva wako</h2>
            <p>${statusBadge(ds)}</p>
            <button class="link-btn" type="button" data-action="to-driver">Fungua mode ya Dereva</button>
          </section>`
        : `<section class="card">
            <h2>Una bodaboda au bajaji?</h2>
            <p class="muted">Endesha na NAYA kwa akaunti hii hii. Pakia nyaraka zako, ofisi ikuthibitishe.</p>
            <button class="btn btn-ghost btn-block" type="button" data-action="to-driver">Kuwa dereva</button>
          </section>`
    }`;
  mountNearby();
}

// ---------- NAYA karibu nawe: bodaboda 3 (na bajaji) zilizo karibu na abiria, zinasasishwa kila sekunde 15 ----------
const nearby = { map: null, timer: null, data: null, key: '' };

function nearbyPoint() {
  if (trip.pickup?.type === 'gps') return { lat: trip.pickup.lat, lng: trip.pickup.lng };
  if (trip.pickup?.type === 'location') {
    const p = places?.find((x) => x.id === trip.pickup.id);
    if (p) return { lat: p.lat, lng: p.lng };
  }
  return null;
}

function stopNearby() {
  clearInterval(nearby.timer);
  nearby.timer = null;
  nearby.map?.destroy();
  nearby.map = null;
}

function paintNearby() {
  const box = $('nearby-summary');
  if (!box || !nearby.data) return;
  const boda = nearby.data.BODABODA;
  const bajaji = nearby.data.BAJAJI;
  box.innerHTML = boda.length
    ? `<strong>Bodaboda ${boda.length}</strong> ${boda.length === 1 ? 'iko' : 'ziko'} karibu nawe · iliyo karibu zaidi inafika baada ya <strong>dakika ~${boda[0].etaMinutes}</strong>${
        bajaji.length ? ` · bajaji ${bajaji.length}` : ''
      }`
    : bajaji.length
      ? `Hakuna bodaboda karibu kwa sasa · <strong>bajaji ${bajaji.length}</strong> ${bajaji.length === 1 ? 'iko' : 'ziko'} karibu`
      : 'Hakuna dereva online karibu nawe kwa sasa. Ukiagiza, tutakutafutia kwa dakika 10.';
  nearby.map?.setDrivers(nearby.data);
}

async function refreshNearby(point) {
  try {
    nearby.data = await api.get(`/api/rides/nearby?lat=${point.lat}&lng=${point.lng}`);
    if (onPassengerHome()) paintNearby();
  } catch (err) {
    handleError(err);
  }
}

async function mountNearby() {
  stopNearby();
  const point = nearbyPoint();
  const mapEl = $('nearby-map');
  if (!mapEl) return;
  if (!point && trip.gps === 'idle') {
    // Mara ya kwanza nyumbani: tafuta mahali ulipo (ndiyo pia "Kutoka" ya safari), kisha onyesha madereva walio karibu.
    $('nearby-summary').textContent = 'Inatafuta mahali ulipo…';
    locateMe().then(() => {
      if (onPassengerHome()) renderPassengerHome();
    });
    return;
  }
  if (!point) {
    mapEl.hidden = true;
    $('nearby-summary').textContent =
      trip.gps === 'locating' ? 'Inatafuta mahali ulipo…' : 'Washa GPS, au chagua unapoanzia, uone bodaboda zilizo karibu nawe.';
    return;
  }
  const key = `${point.lat},${point.lng}`;
  if (key !== nearby.key) nearby.data = null; // mahali pamebadilika
  nearby.key = key;
  paintNearby(); // onyesha mara moja kutoka kumbukumbu, kisha sasisha
  try {
    const m = await nearbyMap(mapEl, point);
    if (!m || !mapEl.isConnected) return m?.destroy();
    nearby.map = m;
    if (nearby.data) m.setDrivers(nearby.data);
  } catch {
    mapEl.hidden = true;
  }
  refreshNearby(point);
  nearby.timer = setInterval(() => {
    if (!onPassengerHome() || !$('nearby-map')) return stopNearby();
    if (document.visibilityState === 'visible') refreshNearby(point);
  }, 15_000);
}

function tripPlanner() {
  const gpsNote = GPS_MESSAGES[trip.gps] && !trip.pickup ? `<p class="alert alert-warn" role="status">${GPS_MESSAGES[trip.gps]}</p>` : '';
  return `
    <div class="route">
      <a class="route-row" href="#/chagua/kutoka">
        <span class="route-icon from">${DOT}</span>
        <span><span class="route-label">Kutoka</span><span class="route-value${trip.pickup ? '' : ' empty'}">${esc(pickupLabel())}</span></span>
      </a>
      <a class="route-row" href="#/chagua/kwenda">
        <span class="route-icon to">${PIN}</span>
        <span><span class="route-label">Kwenda</span><span class="route-value${trip.destination ? '' : ' empty'}">${esc(trip.destination?.name ?? 'Weka unakoenda')}</span></span>
      </a>
    </div>
    ${gpsNote}
    ${estimateBlock()}`;
}

function estimateBlock() {
  if (!trip.pickup || !trip.destination) return '';
  if (trip.loading) return '<p class="muted">Inahesabu nauli…</p>';
  if (trip.estimateError) return `<p class="alert alert-danger" role="alert">${esc(trip.estimateError)}</p>`;
  if (!trip.estimate) return '';
  const { options } = trip.estimate;
  if (options.length === 0) return '<p class="muted">Bei za safari bado hazijawekwa na ofisi ya NAYA. Jaribu tena baadaye.</p>';
  if (!options.some((o) => o.vehicleType === trip.selected)) trip.selected = options[0].vehicleType;
  return `
    <fieldset class="fares">
      <legend>Chagua chombo</legend>
      ${options
        .map(
          (o) => `<label class="fare-option">
            <input type="radio" name="vehicle" value="${o.vehicleType}" ${o.vehicleType === trip.selected ? 'checked' : ''}>
            <span class="fare-body">
              <span class="fare-icon">${VEHICLE_ICON[o.vehicleType] ?? ''}</span>
              <span class="fare-main"><strong>${esc(VEHICLE_TYPES[o.vehicleType])}</strong><span class="muted">km ${o.distanceKm.toLocaleString('en-US')} · ${o.fixed ? 'bei ya njia hii' : 'makadirio'}</span></span>
              <span class="fare-amount">${formatTsh(o.fare)}</span>
            </span>
          </label>`,
        )
        .join('')}
    </fieldset>
    <p class="alert alert-danger" id="book-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block" type="button" data-action="book">Agiza safari</button>
    <p class="muted small" style="margin-top:8px">Malipo: taslimu kwa dereva. Nauli ni makadirio kwa umbali wa barabara.</p>`;
}

async function refreshEstimate() {
  trip.estimate = null;
  trip.estimateError = null;
  // Bila mahali pa kuanzia (mf. GPS imezuiwa) bado chora upya, ili abiria aone ujumbe na achague kwenye orodha.
  if (!trip.pickup || !trip.destination) return renderIfHome();
  trip.loading = true;
  renderIfHome();
  try {
    const pickup = trip.pickup.type === 'gps' ? { lat: trip.pickup.lat, lng: trip.pickup.lng } : { locationId: trip.pickup.id };
    trip.estimate = await api.post('/api/fares/estimate', { pickup, destination: { locationId: trip.destination.id } });
  } catch (err) {
    if (handleError(err)) return;
    trip.estimateError = err.message;
    // Eneo limezimwa na ofisi → orodha mpya
    if (err.status === 404) places = null;
  } finally {
    trip.loading = false;
  }
  renderIfHome();
}

function renderIfHome() {
  if (onPassengerHome()) renderPassengerHome();
}

/** GPS kupitia kivinjari; makosa yanageuzwa kuwa ujumbe rafiki (GPS_MESSAGES). */
function locateMe() {
  if (!navigator.geolocation) {
    trip.gps = 'unavailable';
    return Promise.resolve();
  }
  trip.gps = 'locating';
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        trip.gps = 'ok';
        trip.pickup = { type: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve();
      },
      (err) => {
        trip.gps = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable';
        if (trip.pickup?.type === 'gps') trip.pickup = null;
        resolve();
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

async function renderPicker(kind) {
  const isPickup = kind === 'pickup';
  $('app-content').innerHTML = `
    <a class="back-link" href="#/">Rudi</a>
    <h1>${isPickup ? 'Unaanzia wapi?' : 'Unaenda wapi?'}</h1>
    <label class="sr-only" for="place-q">Tafuta eneo</label>
    <input id="place-q" type="search" placeholder="Tafuta: stendi, soko, hospitali…" autocomplete="off">
    ${isPickup ? `<button class="place place-gps" type="button" data-gps>${DOT}<span><strong>Tumia mahali nilipo sasa</strong><span class="muted">GPS ya simu yako</span></span></button>` : ''}
    <div id="place-list" class="place-list"><p class="muted">Inapakia maeneo…</p></div>`;
  try {
    await loadPlaces();
  } catch (err) {
    if (handleError(err)) return;
    $('place-list').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
    return;
  }
  const draw = () => {
    const q = $('place-q').value.trim().toLowerCase();
    const matches = places.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.area ?? '').toLowerCase().includes(q));
    const other = isPickup ? trip.destination?.id : trip.pickup?.id;
    $('place-list').innerHTML =
      matches.length === 0
        ? '<p class="muted">Hakuna eneo linalolingana. Jaribu jina jingine.</p>'
        : matches
            .filter((p) => p.id !== other)
            .map(
              (p) => `<button class="place" type="button" data-place="${p.id}">${PIN}<span><strong>${esc(p.name)}</strong><span class="muted">${esc(
                LOCATION_CATEGORIES[p.category] ?? '',
              )}${p.area ? ` · ${esc(p.area)}` : ''}</span></span></button>`,
            )
            .join('');
  };
  draw();
  $('place-q').addEventListener('input', draw);
  if (window.matchMedia('(min-width: 600px)').matches) $('place-q').focus();
}

function statusBadge(status) {
  const s = DRIVER_STATUS[status];
  const label = { INCOMPLETE: 'Hujamaliza usajili', PENDING: 'Inasubiri uthibitisho', APPROVED: 'Umethibitishwa', REJECTED: 'Rekebisha taarifa', SUSPENDED: 'Umesimamishwa' }[status];
  return `<span class="badge badge-${s.tone}">${esc(label)}</span>`;
}

// ---------- Akaunti ----------
function setSupportDot() {
  const dot = $('tab-dot');
  if (dot) dot.hidden = !account?.supportUnread;
}

$('app-content').addEventListener('submit', async (event) => {
  if (event.target.id !== 'password-form') return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  $('pw-error').hidden = true;
  button.disabled = true;
  try {
    const { token } = await api.post('/api/account/password', { currentPassword: $('pw-current').value, newPassword: $('pw-new').value });
    api.setToken(token);
    resetNativeRegistration();
    syncNative(api).catch(() => {});
    realtime?.close();
    realtime = null;
    startRealtime();
    toast('Password imebadilishwa');
    renderAccount();
  } catch (err) {
    handleError(err, 'pw-error');
    button.disabled = false;
  }
});

function renderAccount() {
  const { user, activeMode, driverStatus } = account;
  const driverMode = activeMode === 'DRIVER';
  const initials = user.fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const target = driverMode ? 'PASSENGER' : 'DRIVER';
  $('app-content').innerHTML = `
    <h1>Akaunti</h1>
    <section class="card profile">
      <span class="avatar" aria-hidden="true">${esc(initials)}</span>
      <span><strong>${esc(user.fullName)}</strong><span class="muted">${esc(formatPhone(user.phone))}</span></span>
    </section>

    <section class="card" aria-labelledby="mode-title">
      <h2 id="mode-title">Badili mode</h2>
      <div class="mode-row">
        <span><span class="muted">Mode ya sasa</span><br><span class="mode-now">${driverMode ? 'Dereva' : 'Abiria'}</span></span>
        ${driverStatus ? statusBadge(driverStatus) : ''}
      </div>
      <p class="alert alert-danger" id="switch-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="button" data-switch="${target}">${
        driverMode ? 'Badili kwenda Abiria' : driverStatus ? 'Badili kwenda Dereva' : 'Kuwa dereva wa NAYA'
      }</button>
      <p class="muted small" style="margin-top:10px">${
        !driverMode && !driverStatus
          ? 'Utafungua ombi la udereva kwa akaunti hii hii — hakuna akaunti mpya.'
          : 'Ni akaunti ile ile; unaweza kubadili wakati wowote.'
      }</p>
    </section>

    ${
      driverStatus === 'APPROVED' || driverStatus === 'SUSPENDED'
        ? `<section class="card" aria-labelledby="sub-title">
            <h2 id="sub-title">Ada ya mwezi</h2>
            <div id="sub-body"><p class="muted">Inaangalia…</p></div>
          </section>`
        : ''
    }

    <section class="card" aria-labelledby="notify-title">
      <h2 id="notify-title">Arifa</h2>
      <p class="muted" id="push-status">Inaangalia…</p>
      <p class="alert alert-danger" id="push-error" role="alert" hidden></p>
      <div id="push-action"></div>
      <div id="ring-box" hidden></div>
      <ul class="notes" id="note-list"></ul>
    </section>

    ${
      account.androidApkUrl && driverStatus && !isNativeApp() && /Android/i.test(navigator.userAgent)
        ? `<section class="card apk-card" aria-labelledby="apk-title">
            <h2 id="apk-title">App ya NAYA ya Android</h2>
            <p class="muted">Ukiwa na app, simu inalia kengele kwa sekunde 30 ombi la safari likiingia — hata ukiwa unatumia app nyingine au skrini imezimwa.</p>
            <a class="btn btn-primary btn-block" href="${esc(account.androidApkUrl)}" rel="noopener">Pakua app (APK)</a>
          </section>`
        : ''
    }

    ${support.cardHtml(account.supportUnread)}

    ${feedback.cardHtml()}

    <section class="card" aria-labelledby="pw-title">
      <details class="pw-details">
        <summary><h2 id="pw-title">Badilisha password</h2></summary>
        <form id="password-form" class="pw-form" novalidate>
          <label for="pw-current">Password ya sasa</label>
          <input id="pw-current" type="password" autocomplete="current-password">
          <label for="pw-new">Password mpya <span class="muted">(angalau herufi 8)</span></label>
          <input id="pw-new" type="password" autocomplete="new-password" minlength="8">
          <p class="alert alert-danger" id="pw-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Hifadhi password mpya</button>
          <p class="muted small" style="margin-top:8px">Simu nyingine zote zilizoingia kwa akaunti hii zitatolewa.</p>
        </form>
      </details>
    </section>

    <section class="card sound-card" aria-labelledby="sound-title">
      <div class="sound-row">
        <span><h2 id="sound-title">Sauti ya kufungua NAYA</h2><span class="muted">Sauti fupi logo inapojitengeneza app ikifunguka.</span></span>
        <label class="switch"><input type="checkbox" id="sound-toggle"${soundEnabled() ? ' checked' : ''}><span class="sr-only">Washa sauti ya kufungua</span><i aria-hidden="true"></i></label>
      </div>
      <button class="link-btn" type="button" id="sound-test">Sikiliza sauti</button>
    </section>

    <section class="card terms-card" aria-labelledby="terms-title">
      <h2 id="terms-title">Masharti na faragha</h2>
      <ul class="terms-links">
        <li><a href="/masharti/#jumla" data-terms="jumla">Masharti ya Huduma</a></li>
        <li><a href="/masharti/#${driverMode || driverStatus ? 'dereva' : 'abiria'}" data-terms="${driverMode || driverStatus ? 'dereva' : 'abiria'}">${driverMode || driverStatus ? 'Masharti ya Dereva' : 'Masharti ya Abiria'}</a></li>
        <li><a href="/masharti/#faragha" data-terms="faragha">Sera ya Faragha</a></li>
      </ul>
    </section>

    <button class="btn btn-ghost btn-out" type="button" data-action="logout">Toka</button>
    <p class="version">NAYA ${VERSION} · TWENDE PAMOJA</p>`;
  loadNotificationSection();
  support.loadCardList();
  feedback.loadCardList();
  setSupportDot();
  if ($('sub-body')) loadSubscriptionSection();
}

const SUB_STATE = {
  ACTIVE: ['ok', 'Iko hai'],
  GRACE: ['warn', 'Imeisha — siku za kulipa'],
  EXPIRED: ['bad', 'Imeisha'],
  NONE: ['muted', 'Haijaanza'],
};
const PAY_METHODS = { CASH: 'Taslimu', MPESA: 'M-Pesa', AIRTEL: 'Airtel Money', TIGO: 'Mixx by Yas (Tigo Pesa)', HALOPESA: 'HaloPesa', BANK: 'Benki' };

async function loadSubscriptionSection() {
  try {
    const sub = await api.get('/api/driver/subscription');
    if (!$('sub-body')) return;
    const [tone, label] = SUB_STATE[sub.state];
    const line =
      sub.state === 'ACTIVE'
        ? `Mpaka <strong>${esc(formatDate(sub.paidUntil))}</strong> · siku ${sub.daysLeft}`
        : sub.state === 'GRACE'
          ? `Lipa kabla ya <strong>${esc(formatDate(sub.graceEndsAt, true))}</strong> uendelee kupokea safari.`
          : 'Lipa ili uendelee kupokea safari.';
    $('sub-body').innerHTML = `
      <div class="mode-row"><span><span class="muted">Ada</span><br><strong>${formatTsh(sub.monthlyFee)} kwa siku 30</strong></span><span class="badge badge-${tone}">${label}</span></div>
      <p>${line}</p>
      <p class="sub-how"><strong>Jinsi ya kulipa:</strong> ${esc(sub.paymentInstructions)}</p>
      ${
        sub.payments.length
          ? `<h3 class="small-title">Malipo yako</h3><ul class="notes">${sub.payments
              .map(
                (p) => `<li><strong>${formatTsh(p.amount)}</strong> · miezi ${p.months} · ${esc(PAY_METHODS[p.method] ?? p.method)}${
                  p.reference ? ` · ${esc(p.reference)}` : ''
                }<br><span class="muted">${esc(formatDate(p.createdAt))} → mpaka ${esc(formatDate(p.periodEnd))}</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Bado hujalipa ada. Malipo yako yataonekana hapa.</p>'
      }`;
  } catch (err) {
    if (handleError(err)) return;
    if ($('sub-body')) $('sub-body').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  }
}

const PUSH_TEXT = {
  on: 'Arifa zimewashwa kwenye kifaa hiki. Simu italia safari ikibadilika, hata app ikiwa imefungwa.',
  off: 'Arifa zimezimwa. Ziwashe ujue dereva akipatikana, au upate maombi ya safari ukiwa dereva.',
  denied: 'Umezuia arifa kwenye browser hii. Zifungue kwenye mipangilio ya browser (Site settings → Notifications).',
  'server-off': 'Arifa za simu bado hazijawashwa na NAYA. Utaziona hapa zikiwa tayari.',
  unsupported: 'Browser hii haiwezi kupokea arifa. Tumia Chrome kwenye Android, au sakinisha app kwenye iPhone (Add to Home Screen).',
};

/** Dereva ndani ya app ya Android: jaribu kengele, na ruhusa ya kuonyesha ombi juu ya skrini iliyofungwa. */
async function loadRingBox() {
  let info;
  try {
    info = await nativeInfo();
  } catch {
    return;
  }
  const box = $('ring-box');
  if (!box || tab !== 'account') return;
  box.innerHTML = `
    <div class="ring-box">
      <p><strong>Kengele ya maombi</strong><br><span class="muted">Sikia jinsi simu itakavyolia ombi jipya likifika.</span></p>
      <button class="btn btn-ghost btn-block" type="button" data-action="test-ring">Jaribu kengele</button>
      ${
        info.fullScreen
          ? ''
          : `<p class="alert alert-warn" role="note">Ruhusu NAYA ionyeshe ombi juu ya skrini iliyofungwa (kama simu inayoingia).</p>
             <button class="btn btn-primary btn-block" type="button" data-action="fullscreen-settings">Ruhusu</button>`
      }
    </div>`;
  box.hidden = false;
}

const NATIVE_ON = 'Arifa zimewashwa. Ukiwa dereva, simu italia kengele kwa sekunde 30 ombi likiingia — hata app ikiwa imefungwa au skrini imezimwa.';

async function loadNotificationSection() {
  const state = await pushState(api).catch(() => 'server-off');
  if (tab !== 'account' || !$('push-status')) return;
  const native = isNativeApp();
  $('push-status').textContent = native && state === 'on' ? NATIVE_ON : PUSH_TEXT[state];
  $('push-action').innerHTML =
    state === 'off'
      ? '<button class="btn btn-primary btn-block" type="button" data-action="push-on">Washa arifa</button>'
      : state === 'on'
        ? native
          ? '<button class="btn btn-ghost btn-block" type="button" data-action="native-settings">Mipangilio ya arifa za simu</button>'
          : '<button class="btn btn-ghost btn-block" type="button" data-action="push-off">Zima arifa kwenye kifaa hiki</button>'
        : '';
  if (native && state === 'on' && account?.driverStatus) loadRingBox();
  try {
    const notes = await api.get('/api/notifications');
    if (!$('note-list')) return;
    $('note-list').innerHTML = notes.length
      ? notes
          .slice(0, 10)
          .map(
            (n) => `<li class="${n.readAt ? '' : 'unread'}"><strong>${esc(n.title)}</strong>${n.body ? `<br><span>${esc(n.body)}</span>` : ''}<br><span class="muted">${esc(
              formatDate(n.createdAt, true),
            )}</span></li>`,
          )
          .join('')
      : '<li class="muted">Bado huna arifa.</li>';
    if (notes.some((n) => !n.readAt)) api.post('/api/notifications/read').catch(() => {});
  } catch (err) {
    handleError(err);
  }
}

// ---------- Mode ya Dereva ----------
async function loadDriver() {
  if (!driver) $('app-content').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    driver = await api.get('/api/drivers/me');
    account.driverStatus = driver.driver.status;
    renderDriver();
  } catch (err) {
    if (handleError(err)) return;
    $('app-content').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>
      <button class="btn btn-primary btn-block" type="button" data-action="refresh">Jaribu tena</button>`;
  }
}

function renderDriver() {
  if (tab !== 'home' || account.activeMode !== 'DRIVER') return;
  const status = driver.driver.status;
  if (status === 'PENDING') return renderDriverStatus('wait');
  if (status === 'APPROVED') return rides.loadDriverDashboard();
  if (status === 'SUSPENDED') return renderDriverStatus('bad');
  renderOnboarding();
}

const ICONS = {
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
};

const vehicleLine = (d) => [VEHICLE_TYPES[d.vehicleType], d.plateNumber].filter(Boolean).join(' · ');

function recap() {
  const d = driver.driver;
  return `<section class="recap">
    <h2>Taarifa zako</h2>
    <dl>
      <dt>Chombo</dt><dd>${esc(vehicleLine(d))}</dd>
      <dt>Aina</dt><dd>${esc([d.vehicleMake, d.vehicleModel].filter(Boolean).join(' '))}</dd>
      <dt>Rangi</dt><dd>${esc(d.vehicleColor ?? '–')}</dd>
      <dt>Leseni</dt><dd>${esc(d.licenseNumber ?? '–')}</dd>
      <dt>Nyaraka</dt><dd>${driver.documents.length} zimepakiwa</dd>
    </dl>
  </section>`;
}

function renderDriverStatus(kind) {
  const d = driver.driver;
  const content = {
    wait: `<h1>Tumepokea taarifa zako</h1>
      <p class="muted">Ofisi ya NAYA inakagua nyaraka zako. Utaona majibu hapa — rudi baadaye.</p>
      <p class="muted small">Ulituma ${esc(formatDate(d.submittedAt, true))}</p>
      <button class="btn btn-ghost" type="button" data-action="refresh">Angalia tena</button>`,
    ok: `<h1>Umethibitishwa, ${firstName()}!</h1>
      <p class="muted">Karibu NAYA. Kupokea maombi ya safari kutaanza hivi karibuni hapa hapa kwenye mode ya Dereva.</p>`,
    bad: `<h1>Udereva wako umesimamishwa</h1>
      ${d.rejectionReason ? `<p><strong>Sababu:</strong> ${esc(d.rejectionReason)}</p>` : ''}
      <p class="muted">Wasiliana na ofisi ya NAYA kwa maelezo zaidi. Bado unaweza kusafiri kama abiria.</p>`,
  }[kind];
  $('app-content').innerHTML = `<section class="status-card">
      <div class="status-mark mark-${kind}">${ICONS[kind]}</div>
      ${content}
    </section>${recap()}`;
}

function renderOnboarding() {
  const { driver: d, requirements: req } = driver;
  const docs = new Map(driver.documents.map((doc) => [doc.type, doc]));
  const step1Done = req.vehicleComplete;
  const step2Done = req.missingDocuments.length === 0 && req.rejectedDocuments.length === 0;
  const current = !step1Done ? 1 : !step2Done ? 2 : 3;
  const stepClass = (n, done) => `step${done ? ' done' : ''}${current === n ? ' current' : ''}`;
  const showForm = !step1Done || editingVehicle;

  $('app-content').innerHTML = `
    ${d.status === 'REJECTED' ? `<p class="alert alert-warn" role="alert"><strong>Ofisi imeomba urekebishe:</strong> ${esc(d.rejectionReason ?? '')}</p>` : ''}
    <h1>Kuwa dereva wa NAYA</h1>
    <p class="lead">${d.status === 'REJECTED' ? 'Rekebisha kilichoombwa, kisha tuma tena.' : 'Kamilisha hatua hizi tatu ili ofisi ikuthibitishe.'}</p>

    <ol class="steps">
      <li class="${stepClass(1, step1Done)}">
        <div class="step-head"><span class="step-num">1</span><h2>Chombo chako</h2>${step1Done && !editingVehicle ? '<span class="badge badge-ok">Tayari</span>' : ''}</div>
        <div class="step-body">${showForm ? vehicleForm(d) : vehicleSummary(d)}</div>
      </li>
      <li class="${stepClass(2, step2Done)}">
        <div class="step-head"><span class="step-num">2</span><h2>Nyaraka</h2>${step2Done ? '<span class="badge badge-ok">Tayari</span>' : ''}</div>
        <div class="step-body">
          <ul class="docs">${DOCUMENT_ORDER.map((type) => documentRow(type, docs.get(type), req.requiredDocuments.includes(type))).join('')}</ul>
        </div>
      </li>
      <li class="${stepClass(3, false)}">
        <div class="step-head"><span class="step-num">3</span><h2>Tuma kwa uthibitisho</h2></div>
        <div class="step-body">
          ${
            req.canSubmit
              ? '<p class="muted" style="margin:0">Kila kitu kiko tayari. Ofisi ya NAYA itakagua na kukujibu hapa.</p>'
              : `<ul class="todo">${[
                  !step1Done ? '<li>Jaza taarifa za chombo</li>' : '',
                  ...req.missingDocuments.map((t) => `<li>Pakia: ${esc(DOCUMENTS[t].label)}</li>`),
                  ...req.rejectedDocuments.map((t) => `<li>Badilisha: ${esc(DOCUMENTS[t].label)}</li>`),
                ].join('')}</ul>`
          }
          <label class="terms-check" for="driver-terms">
            <input type="checkbox" id="driver-terms">
            <span>Nimesoma na ninakubali <a href="/masharti/#dereva" data-terms="dereva">Masharti ya Dereva</a> wa NAYA: kofia mbili, bei ya app tu, PIN kabla ya safari, na ada ya mwezi.</span>
          </label>
          <p class="alert alert-danger" id="submit-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="button" data-action="submit" ${req.canSubmit ? '' : 'disabled'}>Tuma kwa uthibitisho</button>
        </div>
      </li>
    </ol>`;

  if (showForm) bindVehicleForm();
  loadThumbs(docs);
}

function vehicleSummary(d) {
  return `<p class="summary">${esc(vehicleLine(d))}</p>
    <p class="muted">${esc([d.vehicleMake, d.vehicleModel, d.vehicleColor].filter(Boolean).join(', '))} · Leseni ${esc(d.licenseNumber)}</p>
    <button class="link-btn" type="button" data-action="edit-vehicle">Badilisha</button>`;
}

function vehicleForm(d) {
  const v = (x) => esc(x ?? '');
  const type = d.vehicleType ?? 'BODABODA';
  return `<form id="vehicle-form" novalidate>
    <fieldset class="choice">
      <legend>Aina ya chombo</legend>
      <label><input type="radio" name="vehicleType" value="BODABODA" ${type === 'BODABODA' ? 'checked' : ''}><span>Bodaboda</span></label>
      <label><input type="radio" name="vehicleType" value="BAJAJI" ${type === 'BAJAJI' ? 'checked' : ''}><span>Bajaji</span></label>
    </fieldset>
    <label for="v-plate">Namba ya plate</label>
    <input id="v-plate" name="plateNumber" value="${v(d.plateNumber)}" placeholder="MC 123 ABC" autocapitalize="characters" required>
    <label for="v-make">Kampuni / aina</label>
    <input id="v-make" name="vehicleMake" value="${v(d.vehicleMake)}" placeholder="Mf. Boxer, TVS, Bajaj" required>
    <label for="v-model">Modeli <span class="optional">(si lazima)</span></label>
    <input id="v-model" name="vehicleModel" value="${v(d.vehicleModel)}" placeholder="Mf. BM 150">
    <label for="v-color">Rangi</label>
    <input id="v-color" name="vehicleColor" value="${v(d.vehicleColor)}" placeholder="Mf. Nyekundu" required>
    <label for="v-license">Namba ya leseni ya udereva</label>
    <input id="v-license" name="licenseNumber" value="${v(d.licenseNumber)}" autocapitalize="characters" required>
    <label for="v-nida">Namba ya NIDA <span class="optional">(si lazima)</span></label>
    <input id="v-nida" name="nationalIdNumber" value="${v(d.nationalIdNumber)}" inputmode="numeric" placeholder="Tarakimu 20">
    <p class="alert alert-danger" id="vehicle-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block" type="submit">Hifadhi chombo</button>
  </form>`;
}

function bindVehicleForm() {
  $('vehicle-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    $('vehicle-error').hidden = true;
    button.disabled = true;
    button.textContent = 'Inahifadhi…';
    try {
      driver = await api.put('/api/drivers/me/vehicle', Object.fromEntries(new FormData(form)));
      editingVehicle = false;
      renderDriver();
      toast('Chombo kimehifadhiwa');
    } catch (err) {
      handleError(err, 'vehicle-error');
      button.disabled = false;
      button.textContent = 'Hifadhi chombo';
    }
  });
}

function documentRow(type, doc, required) {
  const info = DOCUMENTS[type];
  const rejected = doc?.status === 'REJECTED';
  const busy = uploadingType === type;
  return `<li class="doc${rejected ? ' rejected' : ''}">
    <div class="doc-thumb${doc ? ' has-file' : ''}" data-thumb="${type}">${doc ? (doc.mimeType === 'application/pdf' ? 'PDF' : '') : 'Bado'}</div>
    <div>
      <div class="doc-title"><strong>${esc(info.label)}${required ? '' : ' <span class="optional">(si lazima)</span>'}</strong>${
        doc ? `<span class="badge badge-${DOCUMENT_STATUS[doc.status].tone}">${esc(DOCUMENT_STATUS[doc.status].label)}</span>` : ''
      }</div>
      <p class="doc-hint">${esc(info.hint)}</p>
      ${rejected && doc.reviewNote ? `<p class="doc-note">${esc(doc.reviewNote)}</p>` : ''}
      <p class="alert alert-danger" id="doc-error-${type}" role="alert" hidden></p>
      <button class="btn ${doc && !rejected ? 'btn-ghost' : 'btn-primary'}" type="button" data-upload="${type}" ${busy ? 'disabled' : ''}>${
        busy ? 'Inapakia…' : doc ? 'Badilisha picha' : 'Pakia picha'
      }</button>
    </div>
  </li>`;
}

function loadThumbs(docs) {
  for (const [type, doc] of docs) {
    if (doc.mimeType === 'application/pdf') continue;
    const key = doc.uploadedAt;
    const cached = thumbs.get(type);
    const place = (url) => {
      const el = document.querySelector(`[data-thumb="${type}"]`);
      if (el) el.innerHTML = `<img src="${url}" alt="">`;
    };
    if (cached?.key === key) {
      place(cached.url);
      continue;
    }
    api
      .blob(`/api/drivers/me/documents/${type}/file`)
      .then((blob) => {
        if (cached) URL.revokeObjectURL(cached.url);
        const url = URL.createObjectURL(blob);
        thumbs.set(type, { key, url });
        place(url);
      })
      .catch(() => {});
  }
}

/** Picha za simu ni kubwa: tunazipunguza hadi upande mrefu = 1600px, JPEG — kawaida KB 200–400. */
async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error('PDF ni kubwa mno (mwisho MB 3). Piga picha ya nyaraka badala yake.');
    return file;
  }
  if (!file.type.startsWith('image/')) throw new Error('Chagua picha au PDF.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Picha hii haifunguki. Jaribu picha nyingine (JPG au PNG).');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Picha ni kubwa mno. Jaribu kupiga picha upya.');
}

$('file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  const type = pendingUploadType;
  pendingUploadType = null;
  if (!file || !type) return;
  uploadingType = type;
  renderDriver();
  try {
    const prepared = await prepareFile(file);
    driver = await api.upload(`/api/drivers/me/documents/${type}`, prepared);
    uploadingType = null;
    renderDriver();
    toast(`${DOCUMENTS[type].label}: imepakiwa`);
  } catch (err) {
    uploadingType = null;
    if (err.status === 401) return signOutLocally();
    if (err.status === 403) return loadDriver();
    renderDriver();
    handleError(err, `doc-error-${type}`);
  }
});

// ---------- Vitufe ----------
$('app-content').addEventListener('click', async (event) => {
  const upload = event.target.closest('[data-upload]');
  if (upload) {
    pendingUploadType = upload.dataset.upload;
    $('file-input').click();
    return;
  }
  const switchTo = event.target.closest('[data-switch]');
  if (switchTo) {
    switchTo.disabled = true;
    try {
      await switchMode(switchTo.dataset.switch, { goHome: true });
      toast(switchTo.dataset.switch === 'DRIVER' ? 'Uko kwenye mode ya Dereva' : 'Uko kwenye mode ya Abiria');
    } catch (err) {
      handleError(err, 'switch-error');
      switchTo.disabled = false;
    }
    return;
  }
  const placeBtn = event.target.closest('[data-place]');
  if (placeBtn) {
    const place = places.find((p) => p.id === placeBtn.dataset.place);
    const kind = location.hash.includes('kutoka') ? 'pickup' : 'destination';
    if (kind === 'pickup') trip.pickup = { type: 'location', id: place.id, name: place.name };
    else trip.destination = { id: place.id, name: place.name };
    location.hash = '#/';
    if (kind === 'destination' && !trip.pickup && trip.gps === 'idle') await locateMe();
    return refreshEstimate();
  }
  if (event.target.closest('[data-gps]')) {
    location.hash = '#/';
    await locateMe();
    return refreshEstimate();
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'reload-places') {
    places = null;
    return renderPassengerHome();
  }
  if (action === 'refresh') return loadDriver();
  if (action === 'book') {
    const button = event.target.closest('[data-action]');
    button.disabled = true;
    button.textContent = 'Inaagiza…';
    try {
      const pickup = trip.pickup.type === 'gps' ? { lat: trip.pickup.lat, lng: trip.pickup.lng } : { locationId: trip.pickup.id };
      await rides.book({ pickup, destination: { locationId: trip.destination.id }, vehicleType: trip.selected });
      tripHistory = null;
    } catch (err) {
      if (handleError(err, 'book-error')) return;
      button.disabled = false;
      button.textContent = 'Agiza safari';
    }
    return;
  }
  if (action === 'to-driver') {
    return switchMode('DRIVER', { goHome: true })
      .then(() => toast('Uko kwenye mode ya Dereva'))
      .catch((err) => handleError(err));
  }
  if (action === 'logout') return logout();
  if (action === 'native-settings') return openNotificationSettings().catch(() => {});
  if (action === 'fullscreen-settings') return openFullScreenSettings().catch(() => {});
  if (action === 'test-ring') {
    return testRing(8)
      .then(() => toast('Sikiliza kengele — gusa skrini kuizima'))
      .catch(() => toast('Kengele haikuweza kulia. Angalia ruhusa ya arifa.'));
  }
  if (action === 'push-on' || action === 'push-off') {
    const button = event.target.closest('[data-action]');
    button.disabled = true;
    $('push-error').hidden = true;
    try {
      if (action === 'push-on') await enablePush(api);
      else await disablePush(api);
      toast(action === 'push-on' ? 'Arifa zimewashwa' : 'Arifa zimezimwa');
    } catch (err) {
      $('push-error').textContent = err.message;
      $('push-error').hidden = false;
    }
    return loadNotificationSection();
  }
  if (action === 'edit-vehicle') {
    editingVehicle = true;
    return renderDriver();
  }
  if (action === 'submit') {
    const button = event.target.closest('[data-action]');
    if (!$('driver-terms')?.checked) {
      $('submit-error').textContent = 'Weka alama kukubali Masharti ya Dereva kwanza.';
      $('submit-error').hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Inatuma…';
    try {
      driver = await api.post('/api/drivers/me/submit', { acceptDriverTerms: true });
      account.driverStatus = driver.driver.status;
      renderDriver();
      window.scrollTo(0, 0);
    } catch (err) {
      handleError(err, 'submit-error');
      button.disabled = false;
      button.textContent = 'Tuma kwa uthibitisho';
    }
  }
});

$('app-content').addEventListener('change', (event) => {
  if (event.target.name === 'vehicle') trip.selected = event.target.value;
});

// Ukisubiri uthibitisho, hali inaangaliwa tena kila dakika moja.
setInterval(() => {
  if (account?.activeMode === 'DRIVER' && tab === 'home' && driver?.driver.status === 'PENDING' && document.visibilityState === 'visible') {
    loadDriver();
  }
}, 60_000);

// ---------- Kutoka ----------
async function logout() {
  // Arifa za mtu aliyetoka zisiendelee kufika kwenye simu hii.
  await disablePush(api).catch(() => {});
  try {
    await api.post('/api/auth/logout');
  } catch {
    // toka kwenye kifaa hiki hata server isipofikika
  }
  signOutLocally();
}

function signOutLocally() {
  realtime?.close();
  realtime = null;
  rides.reset();
  tripHistory = null;
  account = null;
  driver = null;
  places = null;
  Object.assign(trip, { pickup: null, destination: null, estimate: null, estimateError: null, selected: null, gps: 'idle', loading: false });
  editingVehicle = false;
  api.setToken(null);
  for (const { url } of thumbs.values()) URL.revokeObjectURL(url);
  thumbs.clear();
  if (location.hash) history.replaceState(null, '', location.pathname);
  show('view-auth');
}

$('retry-button').addEventListener('click', start);

support.init({ api, handleError, toast, isDriver: () => account?.activeMode === 'DRIVER' });
feedback.init({ api, handleError, toast });
rides.init({
  api,
  pushState: () => pushState(api),
  enablePush: () => enablePush(api),
  toast,
  handleError,
  firstName: () => firstName(),
  isPassengerHome: onPassengerHome,
  isDriverHome: () => account?.activeMode === 'DRIVER' && tab === 'home' && driver?.driver.status === 'APPROVED',
  onPassengerRideClosed: () => {
    tripHistory = null;
    trip.estimate = null;
    refreshEstimate();
  },
});

// ---------- Mwanzo ----------
function showWelcome() {
  if (introSeen()) return show('view-auth');
  show('view-intro');
}
setupIntro(() => {
  selectTab('register');
  show('view-auth');
});

async function start() {
  if (!api.token) return showWelcome();
  show('view-loading');
  try {
    await loadAccount();
  } catch (err) {
    // 403 = akaunti ya ofisi au iliyosimamishwa → kuingia upya
    if (err.status === 401 || err.status === 403) return signOutLocally();
    $('offline-reason').textContent = err.status === 0 ? 'Internet haipo. Tafadhali hakikisha umeunganishwa.' : err.message;
    show('view-offline');
  }
}

start();
