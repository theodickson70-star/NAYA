// NAYA Staff (0.19.0) — ndani ya app ya NAYA. Akaunti hutengenezwa na ofisi; staff anapata kazi zake tu:
//   #/            Mwanzo: takwimu za kazi zake + vitufe vikuu
//   #/s/sajili    Sajili bodaboda (akaunti + chombo) → password ya muda ya dereva inaonyeshwa MARA MOJA
//   #/s/d/<id>    Dereva mmoja: picha za nyaraka (kamera), tuma kwa uthibitisho, hali yake
//   #/s/eneo      Pendekeza eneo (GPS ya simu) → linasubiri ofisi iliidhinishe
//   #/s/kazi      Kazi zangu: madereva na maeneo
// Staff hawezi kuthibitisha dereva wala kuona pesa / mipangilio — hizo ni za ofisi tu.
// 0.19.1: abiria/dereva aliyepewa ruhusa ya staff (account.staffAccess) anafungua kazi hizi kwa #/s — mwanzo wake ni #/s,
// na "Rudi kwenye Dereva/Abiria" inamrudisha kwenye app yake ya kawaida (#/).
import { escapeHtml as esc } from '/shared/api.js';
import { DOCUMENT_ORDER, DOCUMENT_STATUS, formatDate, formatPhone, LOCATION_CATEGORIES } from '/shared/labels.js';
import { preparePhoto } from './photo.js';
import { watchPhone } from '/shared/namelookup.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, toast, handleError, logout, account() }
let fileInput = null;
let pending = null; // { driverId, type }
let lastCreated = null; // { id, fullName, phone, tempPassword } — inaonyeshwa mara moja tu
const thumbs = new Map(); // `${driverId}:${type}` → { key, url }

const DOC_LABEL = {
  PROFILE_PHOTO: ['Picha ya dereva', 'Uso wake wazi, bila miwani ya jua wala kofia.'],
  DRIVING_LICENSE: ['Leseni ya udereva', 'Upande wa mbele, maandishi yasomeke.'],
  NATIONAL_ID: ['Kitambulisho (NIDA)', 'Kitambulisho cha taifa cha dereva.'],
  VEHICLE_PHOTO: ['Picha ya chombo', 'Chombo kizima, plate ionekane wazi.'],
  INSURANCE: ['Bima ya chombo', 'Si lazima.'],
};
const DRIVER_STATE = {
  INCOMPLETE: ['warn', 'Haijakamilika'],
  PENDING: ['muted', 'Inasubiri ofisi'],
  APPROVED: ['ok', 'Amethibitishwa'],
  REJECTED: ['bad', 'Rekebisha'],
  SUSPENDED: ['bad', 'Amesimamishwa'],
};
const LOC_STATE = { PENDING: ['muted', 'Inasubiri ofisi'], APPROVED: ['ok', 'Imeidhinishwa'], REJECTED: ['bad', 'Imekataliwa'] };
const badge = (map, k) => `<span class="badge badge-${(map[k] ?? ['muted'])[0]}">${esc((map[k] ?? [, k])[1])}</span>`;

const ICON = {
  bike: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="16" r="3"/><circle cx="18.5" cy="16" r="3"/><path d="M5.5 16l4-6h5l2.5 4h1.5"/><path d="M13 6.5h3l2 4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

export function init(c) {
  ctx = c;
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.setAttribute('capture', 'environment'); // kamera ya nyuma moja kwa moja
  fileInput.hidden = true;
  document.body.append(fileInput);
  fileInput.addEventListener('change', onFile);
  $('app-content').addEventListener('click', onClick);
  $('app-content').addEventListener('submit', onSubmit);
}

export function reset() {
  lastCreated = null;
  pending = null;
  for (const t of thumbs.values()) URL.revokeObjectURL(t.url);
  thumbs.clear();
}

/** Inaitwa na app.js badala ya route ya abiria/dereva akaunti ikiwa ya staff. */
export function route() {
  document.body.classList.add('mode-staff');
  $('mode-chip').textContent = 'NAYA Staff';
  const acc = ctx.account();
  if (acc.mustChangePassword) return renderPassword(true);
  const h = location.hash;
  const driver = h.match(/^#\/s\/d\/([0-9a-f-]{36})/);
  if (h.startsWith('#/s/sajili')) return renderRegister();
  if (driver) return renderDriver(driver[1]);
  if (h.startsWith('#/s/eneo')) return renderLocation();
  if (h.startsWith('#/s/kazi')) return renderWork(new URLSearchParams(h.split('?')[1] ?? '').get('aina') === 'maeneo' ? 'loc' : 'drv');
  if (h.startsWith('#/s/password')) return renderPassword(false);
  return renderHome();
}

const content = () => $('app-content');
/** Akaunti ya staff tu (role STAFF) → true. Abiria/dereva mwenye ruhusa ya staff → false. */
const staffOnlyAccount = () => !!ctx.account()?.staff;
const home = () => (staffOnlyAccount() ? '#/' : '#/s');
const back = (href = home(), label = 'Rudi') => `<a class="sf-back" href="${href}">← ${label}</a>`;
function fail(err, boxId) {
  if (ctx.handleError(err, boxId)) return true;
  return false;
}

// ------------------------------------------------------------------ mwanzo

async function renderHome() {
  const acc = ctx.account();
  content().innerHTML = `<section class="sf-hero">
      <p class="sf-role">NAYA Staff</p>
      <h1>Habari, ${esc(acc.user.fullName.split(' ')[0])}</h1>
      <p class="lead">Sajili bodaboda na pendekeza maeneo. Ofisi ya NAYA inakagua na kuthibitisha.</p>
    </section>
    <div class="sf-actions">
      <a class="sf-action sf-action-main" href="#/s/sajili">${ICON.bike}<span><strong>Sajili bodaboda</strong><small>Akaunti, chombo na picha za nyaraka</small></span></a>
      <a class="sf-action" href="#/s/eneo">${ICON.pin}<span><strong>Ongeza eneo</strong><small>Stendi, soko, hospitali…</small></span></a>
      <a class="sf-action" href="#/s/kazi">${ICON.list}<span><strong>Kazi zangu</strong><small>Madereva na maeneo niliyoongeza</small></span></a>
    </div>
    <section class="sf-stats" id="sf-stats" aria-label="Kazi zako"><p class="muted">Inapakia…</p></section>
    <section class="card sf-recent"><h2>Madereva wa karibuni</h2><div id="sf-recent"><p class="muted">Inapakia…</p></div></section>
    <div class="sf-foot">${
      staffOnlyAccount()
        ? `<a class="btn btn-ghost btn-block" href="#/s/password">Badilisha password</a>
      <button class="btn btn-ghost btn-block" type="button" data-sf="logout">Toka</button>`
        : `<a class="btn btn-primary btn-block" href="#/" id="sf-leave">Rudi kwenye ${acc.activeMode === 'DRIVER' ? 'Dereva' : 'Abiria'}</a>`
    }</div>`;
  try {
    const [home, drivers] = await Promise.all([ctx.api.get('/api/staff/home'), ctx.api.get('/api/staff/drivers')]);
    if (!$('sf-stats')) return;
    const c = home.counts;
    $('sf-stats').innerHTML = `
      <a class="sf-stat" href="#/s/kazi"><strong>${c.driversIncomplete ?? 0}</strong><span>Hazijakamilika</span></a>
      <a class="sf-stat" href="#/s/kazi"><strong>${c.driversPending ?? 0}</strong><span>Zinasubiri ofisi</span></a>
      <a class="sf-stat sf-stat-ok" href="#/s/kazi"><strong>${c.driversApproved ?? 0}</strong><span>Wamethibitishwa</span></a>
      <a class="sf-stat" href="#/s/kazi?aina=maeneo"><strong>${c.locationsPending ?? 0}</strong><span>Maeneo yanasubiri</span></a>`;
    $('sf-recent').innerHTML = drivers.length ? driverList(drivers.slice(0, 5)) : '<p class="muted">Bado hujasajili dereva. Anza na "Sajili bodaboda".</p>';
  } catch (err) {
    fail(err);
  }
}

function driverList(rows) {
  return `<ul class="sf-list">${rows
    .map(
      (d) => `<li><a href="#/s/d/${esc(d.id)}">
        <span><strong>${esc(d.fullName)}</strong><small>${esc(d.plateNumber ?? '')} · ${esc(formatPhone(d.phone))}</small></span>
        ${badge(DRIVER_STATE, d.status)}</a></li>`,
    )
    .join('')}</ul>`;
}

// ------------------------------------------------------------------ sajili

function renderRegister() {
  content().innerHTML = `${back()}
    <h1>Sajili bodaboda</h1>
    <p class="lead">Jaza taarifa za dereva na chombo chake. Hatua inayofuata ni kupiga picha za nyaraka.</p>
    <form class="card sf-form" id="sf-register" novalidate>
      <h2>Dereva</h2>
      <label for="sf-phone">Namba ya simu ya dereva</label>
      <input id="sf-phone" name="phone" inputmode="tel" placeholder="07XX XXX XXX" required>
      <p class="sf-who" id="sf-who" aria-live="polite" hidden></p>
      <label for="sf-name">Jina kamili <span class="optional">(linajazwa lenyewe kutoka mtandaoni)</span></label>
      <input id="sf-name" name="fullName" autocomplete="off" required>
      <h2>Chombo</h2>
      <fieldset class="choice">
        <legend>Aina ya chombo</legend>
        <label><input type="radio" name="vehicleType" value="BODABODA" checked><span>Bodaboda</span></label>
        <label><input type="radio" name="vehicleType" value="BAJAJI"><span>Bajaji</span></label>
      </fieldset>
      <label for="sf-plate">Namba ya plate</label>
      <input id="sf-plate" name="plateNumber" placeholder="MC 123 ABC" autocapitalize="characters" required>
      <label for="sf-make">Kampuni / aina</label>
      <input id="sf-make" name="vehicleMake" placeholder="Mf. Boxer, TVS, Bajaj" required>
      <label for="sf-color">Rangi</label>
      <input id="sf-color" name="vehicleColor" placeholder="Mf. Nyekundu" required>
      <label for="sf-license">Namba ya leseni ya udereva</label>
      <input id="sf-license" name="licenseNumber" autocapitalize="characters" required>
      <label for="sf-nida">Namba ya NIDA <span class="optional">(si lazima)</span></label>
      <input id="sf-nida" name="nationalIdNumber" inputmode="numeric" placeholder="Tarakimu 20">
      <p class="alert alert-danger" id="sf-register-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Sajili na endelea kwa picha</button>
    </form>`;
  const name = $('sf-name');
  name.addEventListener('input', () => delete name.dataset.auto);
  watchPhone($('sf-phone'), {
    api: ctx.api,
    purpose: 'DRIVER_REG',
    onState: (st) => {
      const box = $('sf-who');
      if (!box) return;
      if (st.state === 'idle') return (box.hidden = true);
      box.hidden = false;
      if (st.state === 'loading') {
        box.className = 'sf-who is-loading';
        box.textContent = 'Inatafuta jina la mwenye namba…';
        return;
      }
      const r = st.result;
      if (st.state === 'error' || !r?.available) {
        box.className = 'sf-who is-muted';
        box.textContent = 'Jina halikupatikana kwa sasa — liandike mwenyewe.';
        return;
      }
      if (!r.found) {
        box.className = 'sf-who is-bad';
        box.textContent = 'Mtandao haujathibitisha namba hii. Hakikisha ni namba sahihi ya dereva.';
        return;
      }
      box.className = 'sf-who is-found';
      box.innerHTML = `Jina kwenye ${esc(r.networkLabel ?? 'mtandao')}: <strong>${esc(r.name)}</strong>`;
      // Jaza jina kama halijaandikwa (au lilijazwa na sisi); staff anaweza kulirekebisha.
      if (!name.value.trim() || name.dataset.auto) {
        name.value = r.displayName;
        name.dataset.auto = '1';
      }
    },
  });
}

// ------------------------------------------------------------------ dereva mmoja

async function renderDriver(id) {
  content().innerHTML = `${back('#/s/kazi', 'Kazi zangu')}<p class="muted">Inapakia…</p>`;
  let d;
  try {
    d = await ctx.api.get(`/api/staff/drivers/${id}`);
  } catch (err) {
    if (!fail(err)) content().innerHTML = `${back('#/s/kazi', 'Kazi zangu')}<p class="alert alert-danger">${esc(err.message)}</p>`;
    return;
  }
  if (!location.hash.includes(id)) return;
  const fresh = lastCreated?.id === id ? lastCreated : null;
  const docs = new Map(d.documents.map((x) => [x.type, x]));
  const req = d.requirements;
  const st = d.driver.status;
  content().innerHTML = `${back('#/s/kazi', 'Kazi zangu')}
    ${
      fresh
        ? `<section class="sf-secret" role="alert">
            <h2>Akaunti ya ${esc(fresh.fullName)} imetengenezwa</h2>
            <p>Mpe dereva password hii ya muda. Ataingia kwenye app ya NAYA kwa namba <strong>${esc(formatPhone(fresh.phone))}</strong> na kuibadilisha.</p>
            <p class="sf-password" aria-label="Password ya muda">${esc(fresh.tempPassword)}</p>
            <p class="small">Inaonyeshwa <strong>mara moja tu</strong>. Iandike sasa.</p>
          </section>`
        : ''
    }
    <div class="sf-head">
      <div><h1>${esc(d.fullName)}</h1><p class="muted">${esc(d.driver.plateNumber ?? '')} · ${esc(formatPhone(d.phone))}</p></div>
      ${badge(DRIVER_STATE, st)}
    </div>
    ${st === 'REJECTED' && d.driver.rejectionReason ? `<p class="alert alert-warn"><strong>Ofisi imeomba urekebishe:</strong> ${esc(d.driver.rejectionReason)}</p>` : ''}
    ${st === 'PENDING' ? '<p class="alert alert-ok">Imetumwa. Ofisi ya NAYA inakagua — utaona majibu hapa.</p>' : ''}
    ${st === 'APPROVED' ? `<p class="alert alert-ok">Amethibitishwa! ${d.driverLoggedIn ? 'Ameshaingia kwenye app.' : 'Bado hajaingia kwenye app — mkumbushe atumie password ya muda.'}</p>` : ''}
    <section class="card">
      <h2>Picha za nyaraka</h2>
      <ul class="docs">${DOCUMENT_ORDER.map((type) => docRow(d.id, type, docs.get(type), req.requiredDocuments.includes(type), req.editable)).join('')}</ul>
    </section>
    ${
      req.editable
        ? `<section class="card">
            <h2>Tuma kwa ofisi</h2>
            ${
              req.canSubmit
                ? '<p class="muted">Kila kitu kiko tayari. Ofisi itakagua na kuthibitisha.</p>'
                : `<ul class="todo">${[
                    ...req.missingDocuments.map((t) => `<li>Piga picha: ${esc(DOC_LABEL[t][0])}</li>`),
                    ...req.rejectedDocuments.map((t) => `<li>Badilisha: ${esc(DOC_LABEL[t][0])}</li>`),
                  ].join('')}</ul>`
            }
            <p class="alert alert-danger" id="sf-submit-error" role="alert" hidden></p>
            <button class="btn btn-primary btn-block" type="button" data-sf="submit" data-id="${esc(d.id)}" ${req.canSubmit ? '' : 'disabled'}>Tuma kwa uthibitisho</button>
          </section>`
        : ''
    }`;
  if (fresh) lastCreated = null; // password haionyeshwi tena ukirudi
  loadThumbs(d.id, docs);
}

function docRow(driverId, type, doc, required, editable) {
  const [label, hint] = DOC_LABEL[type];
  const rejected = doc?.status === 'REJECTED';
  const busy = pending?.driverId === driverId && pending?.type === type && pending.busy;
  return `<li class="doc${rejected ? ' rejected' : ''}">
    <div class="doc-thumb${doc ? ' has-file' : ''}" data-sf-thumb="${type}">${doc ? '' : 'Bado'}</div>
    <div>
      <div class="doc-title"><strong>${esc(label)}${required ? '' : ' <span class="optional">(si lazima)</span>'}</strong>${
        doc ? `<span class="badge badge-${DOCUMENT_STATUS[doc.status].tone}">${esc(DOCUMENT_STATUS[doc.status].label)}</span>` : ''
      }</div>
      <p class="doc-hint">${esc(hint)}</p>
      ${rejected && doc.reviewNote ? `<p class="doc-note">${esc(doc.reviewNote)}</p>` : ''}
      <p class="alert alert-danger" id="sf-doc-error-${type}" role="alert" hidden></p>
      ${
        editable
          ? `<button class="btn ${doc && !rejected ? 'btn-ghost' : 'btn-primary'} sf-cam" type="button" data-sf="photo" data-id="${esc(driverId)}" data-type="${type}" ${busy ? 'disabled' : ''}>${ICON.cam}${
              busy ? 'Inapakia…' : doc ? 'Piga upya' : 'Piga picha'
            }</button>`
          : ''
      }
    </div>
  </li>`;
}

function loadThumbs(driverId, docs) {
  for (const [type, doc] of docs) {
    if (doc.mimeType === 'application/pdf') continue;
    const key = `${driverId}:${type}`;
    const place = (url) => {
      const el = document.querySelector(`[data-sf-thumb="${type}"]`);
      if (el) el.innerHTML = `<img src="${url}" alt="">`;
    };
    const cached = thumbs.get(key);
    if (cached?.at === doc.uploadedAt) {
      place(cached.url);
      continue;
    }
    ctx.api
      .blob(`/api/staff/drivers/${driverId}/documents/${type}/file`)
      .then((blob) => {
        if (cached) URL.revokeObjectURL(cached.url);
        const url = URL.createObjectURL(blob);
        thumbs.set(key, { at: doc.uploadedAt, url });
        place(url);
      })
      .catch(() => {});
  }
}

async function onFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !pending) return;
  const { driverId, type } = pending;
  pending = { driverId, type, busy: true };
  const button = document.querySelector(`[data-sf="photo"][data-type="${type}"]`);
  if (button) {
    button.disabled = true;
    button.lastChild.textContent = 'Inapakia…';
  }
  try {
    await ctx.api.upload(`/api/staff/drivers/${driverId}/documents/${type}`, await preparePhoto(file));
    pending = null;
    ctx.toast(`${DOC_LABEL[type][0]}: imehifadhiwa`);
    renderDriver(driverId);
  } catch (err) {
    pending = null;
    renderDriver(driverId).then(() => fail(err, `sf-doc-error-${type}`));
  }
}

// ------------------------------------------------------------------ eneo

let gps = null; // { lat, lng, accuracy }

function renderLocation() {
  gps = null;
  content().innerHTML = `${back()}
    <h1>Ongeza eneo</h1>
    <p class="lead">Simama mahali penyewe, bonyeza "Niko hapa", kisha weka jina. Ofisi italiidhinisha kabla wateja hawajaliona.</p>
    <form class="card sf-form" id="sf-location" novalidate>
      <button class="btn btn-ghost btn-block sf-gps" type="button" data-sf="gps">${ICON.pin}Niko hapa — chukua mahali (GPS)</button>
      <p class="sf-gps-state muted" id="sf-gps-state">Bado hujachukua mahali.</p>
      <label for="sf-loc-name">Jina la eneo</label>
      <input id="sf-loc-name" name="name" placeholder="Mf. Stendi ya Kaliua Road" required>
      <label for="sf-loc-cat">Aina</label>
      <select id="sf-loc-cat" name="category">${Object.entries(LOCATION_CATEGORIES)
        .map(([k, v]) => `<option value="${k}"${k === 'STAND' ? ' selected' : ''}>${esc(v)}</option>`)
        .join('')}</select>
      <label for="sf-loc-area">Mtaa / kata <span class="optional">(si lazima)</span></label>
      <input id="sf-loc-area" name="area" placeholder="Mf. Urambo mjini">
      <p class="alert alert-danger" id="sf-location-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit" id="sf-loc-submit" disabled>Tuma eneo kwa ofisi</button>
    </form>`;
}

function takeGps() {
  const state = $('sf-gps-state');
  if (!navigator.geolocation) {
    state.textContent = 'Simu hii haina GPS kwenye app.';
    return;
  }
  state.textContent = 'Inatafuta mahali…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gps = { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)), accuracy: Math.round(pos.coords.accuracy) };
      if (!$('sf-gps-state')) return;
      $('sf-gps-state').innerHTML = `<strong>Mahali pamechukuliwa</strong> · usahihi wa takriban mita ${gps.accuracy}${
        gps.accuracy > 60 ? ' <span class="sf-warn">— sogea nje ya jengo kwa usahihi zaidi, kisha bonyeza tena</span>' : ''
      }`;
      $('sf-loc-submit').disabled = false;
    },
    (err) => {
      if (!$('sf-gps-state')) return;
      $('sf-gps-state').textContent =
        err.code === 1 ? 'Umezuia ruhusa ya mahali. Iruhusu kwenye mipangilio ya simu, kisha jaribu tena.' : 'GPS haikupata mahali. Washa Location na ujaribu tena.';
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
}

// ------------------------------------------------------------------ kazi zangu

async function renderWork(tab) {
  content().innerHTML = `${back()}
    <h1>Kazi zangu</h1>
    <nav class="sf-tabs" aria-label="Kazi zangu">
      <a href="#/s/kazi"${tab === 'drv' ? ' aria-current="page"' : ''}>Madereva</a>
      <a href="#/s/kazi?aina=maeneo"${tab === 'loc' ? ' aria-current="page"' : ''}>Maeneo</a>
    </nav>
    <div id="sf-work"><p class="muted">Inapakia…</p></div>`;
  try {
    if (tab === 'drv') {
      const rows = await ctx.api.get('/api/staff/drivers');
      if ($('sf-work')) $('sf-work').innerHTML = rows.length ? driverList(rows) : '<p class="muted">Bado hujasajili dereva.</p>';
    } else {
      const rows = await ctx.api.get('/api/staff/locations');
      if ($('sf-work'))
        $('sf-work').innerHTML = rows.length
          ? `<ul class="sf-list">${rows
              .map(
                (l) => `<li><div><span><strong>${esc(l.name)}</strong><small>${esc(LOCATION_CATEGORIES[l.category] ?? l.category)} · ${esc(formatDate(l.createdAt))}${
                  l.reviewNote ? ` · ${esc(l.reviewNote)}` : ''
                }</small></span>${badge(LOC_STATE, l.reviewStatus)}</div></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Bado hujaongeza eneo.</p>';
    }
  } catch (err) {
    fail(err);
  }
}

// ------------------------------------------------------------------ password

/** Password ya muda: staff, au dereva aliyesajiliwa na staff (app.js inaita hii kabla ya kitu kingine). */
export function renderPasswordScreen() {
  document.body.classList.add('mode-forcepw');
  renderPassword(true);
}

const active = () => document.body.classList.contains('mode-staff') || document.body.classList.contains('mode-forcepw');

function renderPassword(forced) {
  content().innerHTML = `${forced ? '' : back()}
    <h1>${forced ? 'Weka password yako' : 'Badilisha password'}</h1>
    <p class="lead">${forced ? 'Umeingia kwa password ya muda kutoka ofisi ya NAYA. Weka password yako mwenyewe ili uanze kazi.' : 'Chagua password mpya ya angalau herufi 8.'}</p>
    <form class="card sf-form" id="sf-password" novalidate>
      <label for="sf-pw-old">${forced ? 'Password ya muda' : 'Password ya sasa'}</label>
      <input id="sf-pw-old" type="password" autocomplete="current-password" required>
      <label for="sf-pw-new">Password mpya</label>
      <input id="sf-pw-new" type="password" autocomplete="new-password" minlength="8" required>
      <label for="sf-pw-new2">Rudia password mpya</label>
      <input id="sf-pw-new2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="alert alert-danger" id="sf-password-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Hifadhi password</button>
    </form>
    ${forced ? '<button class="btn btn-ghost btn-block sf-foot" type="button" data-sf="logout">Toka</button>' : ''}`;
}

// ------------------------------------------------------------------ matukio

async function onClick(event) {
  if (!active()) return;
  const b = event.target.closest('[data-sf]');
  if (!b) return;
  const action = b.dataset.sf;
  if (action === 'logout') return ctx.logout();
  if (action === 'gps') return takeGps();
  if (action === 'photo') {
    pending = { driverId: b.dataset.id, type: b.dataset.type };
    fileInput.click();
    return;
  }
  if (action === 'submit') {
    b.disabled = true;
    $('sf-submit-error').hidden = true;
    try {
      await ctx.api.post(`/api/staff/drivers/${b.dataset.id}/submit`, {});
      ctx.toast('Imetumwa kwa ofisi ya NAYA');
      renderDriver(b.dataset.id);
    } catch (err) {
      b.disabled = false;
      fail(err, 'sf-submit-error');
    }
  }
}

async function onSubmit(event) {
  if (!active()) return;
  const form = event.target;
  if (!['sf-register', 'sf-location', 'sf-password'].includes(form.id)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const errorId = `${form.id}-error`;
  $(errorId).hidden = true;
  button.disabled = true;
  try {
    if (form.id === 'sf-register') {
      const created = await ctx.api.post('/api/staff/drivers', Object.fromEntries(new FormData(form)));
      lastCreated = created;
      location.hash = `#/s/d/${created.id}`;
      return;
    }
    if (form.id === 'sf-location') {
      if (!gps) throw new Error('Bonyeza "Niko hapa" kwanza ili kuchukua mahali.');
      const data = Object.fromEntries(new FormData(form));
      await ctx.api.post('/api/staff/locations', { name: data.name, category: data.category, area: data.area || undefined, lat: gps.lat, lng: gps.lng });
      ctx.toast('Eneo limetumwa — ofisi italiidhinisha');
      location.hash = '#/s/kazi?aina=maeneo';
      return;
    }
    if (form.id === 'sf-password') {
      const next = $('sf-pw-new').value;
      if (next !== $('sf-pw-new2').value) throw new Error('Password mpya hazifanani.');
      const r = await ctx.api.post('/api/account/password', { currentPassword: $('sf-pw-old').value, newPassword: next });
      ctx.api.setToken(r.token);
      document.body.classList.remove('mode-forcepw');
      ctx.toast('Password imebadilishwa');
      const toStaffHome = !staffOnlyAccount() && location.hash.startsWith('#/s');
      if (location.hash && location.hash !== '#/') history.replaceState(null, '', location.pathname + (toStaffHome ? '#/s' : ''));
      await ctx.reloadAccount(); // app.js inachora tena (staff au dereva)
    }
  } catch (err) {
    button.disabled = false;
    fail(err, errorId);
  }
}
