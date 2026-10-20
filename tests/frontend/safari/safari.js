// Ukurasa wa umma wa safari (/safari/#token). Link za aina mbili:
//  - SHARE: ndugu anafuatilia safari — dereva, plate na ramani mpaka abiria afike.
//  - RIDER (0.25.0): anayesafiri kwenye safari aliyoagiziwa na mtu mwingine — pia simu ya dereva, PIN ya ofa,
//    nauli imelipwa au la, na kitufe cha dharura (bila kuhitaji app wala akaunti).
// Token iko baada ya "#", kwa hiyo haitumwi kwenye URL ya server (haiingii kwenye logs); inatumwa ndani ya body.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';
import { rideMap } from '/shared/map.js';
import { initI18n } from '/shared/i18n.js';

initI18n();

const box = document.getElementById('share-content');
const token = location.hash.slice(1);
let map = null;
let lastKey = '';
let timer = null;
let sosSheet = false;
let sosBusy = false;
let sosError = '';
let current = null;

const SHARE_STATUS = {
  ACCEPTED: ['coming', 'Dereva anaenda kumchukua', (r) => `${r.passengerFirstName} anasubiri ${r.pickup.name}.`],
  ARRIVED: ['arrived', 'Dereva amefika kumchukua', (r) => `${r.passengerFirstName} yuko ${r.pickup.name}.`],
  IN_PROGRESS: ['moving', 'Wako safarini', (r) => `${r.passengerFirstName} anaelekea ${r.destination.name}.`],
  COMPLETED: ['done', 'Amefika salama', (r) => `${r.passengerFirstName} amefika ${r.destination.name}.`],
  CANCELLED: ['none', 'Safari imeghairiwa', () => 'Safari hii haiendelei tena.'],
  NO_DRIVER: ['none', 'Safari haikufanyika', () => 'Hakuna dereva aliyepatikana.'],
};
const RIDER_STATUS = {
  SEARCHING: ['searching', 'Tunakutafutia dereva…', (r) => `${r.bookedBy} amekuagizia safari kwenda ${r.destination.name}. Subiri ${r.pickup.name}.`],
  ACCEPTED: ['coming', 'Dereva anakuja', (r) => `Anakuja ${r.pickup.name}. Kabla ya kupanda, hakikisha plate ni sahihi.`],
  ARRIVED: ['arrived', 'Dereva amefika!', (r) => `Yuko ${r.pickup.name}. Tafuta plate iliyo hapa chini.`],
  IN_PROGRESS: ['moving', 'Uko safarini', (r) => `Unaelekea ${r.destination.name}.`],
  COMPLETED: ['done', 'Umefika salama', (r) => `Karibu ${r.destination.name}. Asante kwa kusafiri na NAYA.`],
  CANCELLED: ['none', 'Safari imeghairiwa', (r) => `Safari aliyokuagizia ${r.bookedBy} imeghairiwa. Usimsubiri dereva.`],
  NO_DRIVER: ['none', 'Hakuna dereva aliyepatikana', (r) => `Mjulishe ${r.bookedBy} ajaribu tena baada ya muda mfupi.`],
};
const LIVE = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];
const OPEN = ['SEARCHING', ...LIVE];

async function load() {
  let res;
  try {
    res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
  } catch {
    return note('Hakuna mtandao. Tunajaribu tena…');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    stop();
    return gone(body.message ?? 'Link hii si sahihi au imeisha muda.');
  }
  render(body.data);
}

const keyOf = (r) => [r.status, r.mode, r.driver?.name, r.pin, r.sosOpen, r.fare?.paid, sosSheet, sosBusy, sosError].join('|');

function render(r) {
  current = r;
  const rider = r.mode === 'RIDER';
  const [tone, title, sub] = (rider ? RIDER_STATUS : SHARE_STATUS)[r.status] ?? SHARE_STATUS.CANCELLED;
  const live = LIVE.includes(r.status);
  const key = keyOf(r);
  if (key !== lastKey) {
    map?.destroy();
    map = null;
    lastKey = key;
    const tag = document.querySelector('.share-tag');
    if (tag) tag.textContent = rider ? 'Safari yako' : 'Safari iliyoshirikiwa';
    const d = r.driver;
    box.innerHTML = `
      <section class="ride-head ride-${tone}" role="status">
        <span class="ride-pulse" aria-hidden="true"></span>
        <h1>${esc(title)}</h1>
        <p>${esc(sub(r))}</p>
      </section>
      ${rider && r.sosOpen ? `<p class="alert alert-sos" role="alert"><strong>Dharura imetumwa.</strong> Ofisi ya NAYA imepokea na itakupigia sasa hivi. Ukiwa hatarini piga <a href="tel:112">112</a>.</p>` : ''}
      ${live ? '<div class="ride-map" id="ride-map" role="img" aria-label="Ramani ya safari na dereva"></div>' : ''}
      ${rider && r.pin ? pinHtml(r.pin) : ''}
      ${
        d
          ? `<section class="card">
              <span class="muted">Dereva</span>
              <p class="share-driver"><strong>${esc(d.name)}</strong><span class="plate-chip">${esc(d.plateNumber ?? '')}</span></p>
              <p class="muted">${esc([VEHICLE_TYPES[r.vehicleType], d.vehicle].filter(Boolean).join(' · '))}</p>
              ${d.phone ? `<a class="btn btn-ghost btn-block call" href="tel:+${esc(d.phone)}">Piga simu dereva · ${esc(formatPhone(d.phone))}</a>` : ''}
            </section>`
          : ''
      }
      ${rider && OPEN.includes(r.status) ? fareHtml(r) : ''}
      <section class="card share-route">
        <p><span class="muted">Kutoka</span><br><strong>${esc(r.pickup.name)}</strong></p>
        <p><span class="muted">Kwenda</span><br><strong>${esc(r.destination.name)}</strong></p>
      </section>
      ${rider && live && !r.sosOpen ? sosHtml() : ''}
      <p class="muted share-updated" id="share-updated"></p>
      <p class="share-help">${
        rider
          ? `Umeagiziwa safari hii na ${esc(r.bookedBy)} kupitia NAYA. Dharura: <a href="tel:112">112</a>.`
          : 'Kama una wasiwasi kuhusu usalama wake, mpigie kwanza. Dharura: <a href="tel:112">112</a>.'
      }</p>`;
    if (live) {
      rideMap(document.getElementById('ride-map'), {
        pickup: r.pickup,
        destination: r.destination,
        driver: d?.location,
      }, { focus: r.status === 'IN_PROGRESS' ? 'destination' : 'pickup' })
        .then((m) => {
          map = m;
        })
        .catch(() => {});
    }
  } else if (r.driver?.location) {
    map?.setDriver(r.driver.location);
  }
  const updated = document.getElementById('share-updated');
  if (updated) {
    updated.textContent = live
      ? `Inasasishwa yenyewe · dereva alionekana ${r.driver?.location?.at ? formatDate(r.driver.location.at, true) : '—'}`
      : r.status === 'SEARCHING'
        ? 'Inasasishwa yenyewe'
        : r.endedAt
          ? `Iliisha ${formatDate(r.endedAt, true)}`
          : '';
  }
  if (!OPEN.includes(r.status)) stop();
}

function pinHtml(pin) {
  return `<section class="card pin-card" aria-label="PIN ya safari">
    <span class="pin-label">PIN ya safari</span>
    <strong class="pin-digits">${esc(pin.split('').join(' '))}</strong>
    <span class="muted">Safari ya ofa: mpe dereva PIN hii ukishapanda — kwanza hakikisha plate ni sahihi.</span>
  </section>`;
}

function fareHtml(r) {
  return `<section class="card">
    <span class="muted">Nauli</span>
    <p class="share-driver"><strong>${formatTsh(r.fare.amount)}</strong>${r.fare.paid ? '<span class="badge badge-ok">Imelipwa ✓</span>' : ''}</p>
    <p class="muted">${
      r.fare.paid
        ? `${esc(r.bookedBy)} ameshalipa nauli. Usimlipe dereva.`
        : `${esc(r.bookedBy)} ndiye analipa nauli. Kama hajalipa kwenye app yake, dereva atakuomba taslimu.`
    }</p>
  </section>`;
}

function sosHtml() {
  if (!sosSheet) {
    return `<button class="btn btn-ghost btn-block sos-button" type="button" data-share="sos-open">Dharura</button>`;
  }
  return `<section class="card sos-sheet" role="alertdialog" aria-labelledby="sos-title">
    <h2 id="sos-title">Una dharura?</h2>
    <p class="muted">Ofisi ya NAYA itapata ujumbe wako papo hapo pamoja na safari hii na mahali ulipo, na itakupigia.</p>
    ${sosError ? `<p class="alert alert-danger" role="alert">${esc(sosError)}</p>` : ''}
    <button class="btn btn-danger btn-block btn-big" type="button" data-share="sos-send"${sosBusy ? ' disabled' : ''}>${sosBusy ? 'Inatuma…' : 'Tuma dharura kwa ofisi ya NAYA'}</button>
    <a class="btn btn-ghost btn-block" href="tel:112">Piga Polisi · 112</a>
    <button class="btn btn-ghost btn-block btn-plain" type="button" data-share="sos-close">Rudi</button>
  </section>`;
}

function quickPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    // Ombi la ruhusa ya GPS likiachwa bila jibu, "timeout" hapa chini haianzi — dharura isisubiri zaidi ya sekunde 3.
    setTimeout(() => resolve(null), 3500);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 30_000 },
    );
  });
}

async function sendSos() {
  sosBusy = true;
  sosError = '';
  render(current);
  const pos = await quickPosition();
  try {
    const res = await fetch('/api/share/sos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...(pos ?? {}) }),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? 'Haikutumwa. Piga 112.');
    sosSheet = false;
    current = { ...current, sosOpen: true };
  } catch (err) {
    sosError = err.message === 'Failed to fetch' ? 'Hakuna mtandao. Piga 112 au ofisi ya NAYA.' : err.message;
  }
  sosBusy = false;
  render(current);
}

box.addEventListener('click', (event) => {
  const action = event.target.closest('[data-share]')?.dataset.share;
  if (!action || !current) return;
  if (action === 'sos-open') sosSheet = true;
  if (action === 'sos-close') {
    sosSheet = false;
    sosError = '';
  }
  if (action === 'sos-send') return sendSos();
  render(current);
});

function note(text) {
  const el = document.getElementById('share-updated');
  if (el) el.textContent = text;
  else box.innerHTML = `<p class="muted">${esc(text)}</p>`;
}

function gone(message) {
  map?.destroy();
  map = null;
  box.innerHTML = `<section class="ride-head ride-none"><h1>Safari haipatikani</h1><p>${esc(message)}</p></section>
    <p class="share-help">Link ya safari ya NAYA inafanya kazi wakati safari inaendelea tu.</p>`;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
  gone('Link hii si sahihi.');
} else {
  load();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, 10_000);
}
