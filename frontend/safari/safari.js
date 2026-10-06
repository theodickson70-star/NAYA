// Ukurasa wa umma wa safari iliyoshirikiwa: ndugu anaona dereva, plate na ramani mpaka abiria afike.
// Token iko baada ya "#", kwa hiyo haitumwi kwenye URL ya server (haiingii kwenye logs); inatumwa ndani ya body.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, VEHICLE_TYPES } from '/shared/labels.js';
import { rideMap } from '/shared/map.js';

const box = document.getElementById('share-content');
const token = location.hash.slice(1);
let map = null;
let lastStatus = '';
let timer = null;

const STATUS = {
  ACCEPTED: ['coming', 'Dereva anaenda kumchukua', (r) => `${r.passengerFirstName} anasubiri ${r.pickup.name}.`],
  ARRIVED: ['arrived', 'Dereva amefika kumchukua', (r) => `${r.passengerFirstName} yuko ${r.pickup.name}.`],
  IN_PROGRESS: ['moving', 'Wako safarini', (r) => `${r.passengerFirstName} anaelekea ${r.destination.name}.`],
  COMPLETED: ['done', 'Amefika salama', (r) => `${r.passengerFirstName} amefika ${r.destination.name}.`],
  CANCELLED: ['none', 'Safari imeghairiwa', () => 'Safari hii haiendelei tena.'],
  NO_DRIVER: ['none', 'Safari haikufanyika', () => 'Hakuna dereva aliyepatikana.'],
};
const LIVE = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];

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
    return note('Hakuna mtandao. Tunajaribu tena…', true);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    stop();
    return gone(body.message ?? 'Link hii si sahihi au imeisha muda.');
  }
  render(body.data);
}

function render(r) {
  const [tone, title, sub] = STATUS[r.status] ?? STATUS.CANCELLED;
  const live = LIVE.includes(r.status);
  if (r.status !== lastStatus) {
    map?.destroy();
    map = null;
    lastStatus = r.status;
    const d = r.driver;
    box.innerHTML = `
      <section class="ride-head ride-${tone}" role="status">
        <span class="ride-pulse" aria-hidden="true"></span>
        <h1>${esc(title)}</h1>
        <p>${esc(sub(r))}</p>
      </section>
      ${live ? '<div class="ride-map" id="ride-map" role="img" aria-label="Ramani ya safari na dereva"></div>' : ''}
      ${
        d
          ? `<section class="card">
              <span class="muted">Dereva</span>
              <p class="share-driver"><strong>${esc(d.name)}</strong><span class="plate-chip">${esc(d.plateNumber ?? '')}</span></p>
              <p class="muted">${esc([VEHICLE_TYPES[r.vehicleType], d.vehicle].filter(Boolean).join(' · '))}</p>
            </section>`
          : ''
      }
      <section class="card share-route">
        <p><span class="muted">Kutoka</span><br><strong>${esc(r.pickup.name)}</strong></p>
        <p><span class="muted">Kwenda</span><br><strong>${esc(r.destination.name)}</strong></p>
      </section>
      <p class="muted share-updated" id="share-updated"></p>
      <p class="share-help">Kama una wasiwasi kuhusu usalama wake, mpigie kwanza. Dharura: <a href="tel:112">112</a>.</p>`;
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
      : r.endedAt
        ? `Iliisha ${formatDate(r.endedAt, true)}`
        : '';
  }
  if (!live) stop();
}

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
