// Ofisi: safari zinazoendelea na zote, historia ya kila safari, na kughairi safari iliyokwama.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError }
let scope = 'active';
let refreshTimer = null;

export const RIDE_STATUS = {
  SEARCHING: ['warn', 'Inatafuta dereva'],
  ACCEPTED: ['ok', 'Dereva anakuja'],
  ARRIVED: ['ok', 'Dereva amefika'],
  IN_PROGRESS: ['ok', 'Safarini'],
  COMPLETED: ['muted', 'Imekamilika'],
  CANCELLED: ['bad', 'Imeghairiwa'],
  NO_DRIVER: ['bad', 'Hakuna dereva'],
};
const badge = (status) => `<span class="badge badge-${RIDE_STATUS[status][0]}">${RIDE_STATUS[status][1]}</span>`;
const BY = { PASSENGER: 'abiria', DRIVER: 'dereva', ADMIN: 'ofisi', SYSTEM: 'mfumo' };

export function setup(context) {
  ctx = context;
  document.querySelector('#page-rides .filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-scope]');
    if (!chip) return;
    scope = chip.dataset.scope;
    for (const c of document.querySelectorAll('#page-rides [data-scope]')) c.setAttribute('aria-pressed', String(c === chip));
    loadRides();
  });
}

export function stop() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  $(boxId).textContent = err.message;
  $(boxId).hidden = false;
}

export async function loadRides() {
  stop();
  $('rides-error').hidden = true;
  await drawList();
  refreshTimer = setInterval(() => {
    if (!$('page-rides').hidden && document.visibilityState === 'visible') drawList();
  }, 10_000);
}

/** Kwa matukio ya papo hapo: sasisha orodha bila kuanzisha upya kipima-muda. */
export const refreshList = () => drawList();

async function drawList() {
  try {
    const rides = await ctx.api.get(`/api/admin/rides?scope=${scope}`);
    $('ride-list').innerHTML =
      rides.length === 0
        ? `<p class="empty">${scope === 'active' ? 'Hakuna safari inayoendelea sasa hivi.' : 'Bado hakuna safari.'}</p>`
        : rides
            .map(
              (r) => `<a class="ride-row" href="#/safari/${esc(r.id)}">
                <span class="col-time"><strong>${esc(formatDate(r.requestedAt, true))}</strong><br><span class="driver-sub">${esc(VEHICLE_TYPES[r.vehicleType])} · ${formatTsh(r.fare)}</span></span>
                <span class="ride-route"><strong>${esc(r.pickupName)} → ${esc(r.destinationName)}</strong><span class="driver-sub">km ${r.distanceKm}</span></span>
                <span class="col-people driver-sub">Abiria: ${esc(r.passengerName)}<br>Dereva: ${r.driverName ? `${esc(r.driverName)} (${esc(r.plateNumber ?? '')})` : '—'}</span>
                <span>${badge(r.status)}</span>
              </a>`,
            )
            .join('');
  } catch (err) {
    fail(err, 'rides-error');
  }
}

export async function loadRide(id) {
  stop();
  $('ride-error').hidden = true;
  $('ride-detail').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    render(await ctx.api.get(`/api/admin/rides/${encodeURIComponent(id)}`));
  } catch (err) {
    $('ride-detail').innerHTML = '';
    fail(err, 'ride-error');
  }
}

function render(r) {
  const active = ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status);
  $('ride-detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h1>${esc(r.pickup.name)} → ${esc(r.destination.name)}</h1>
        <p class="muted">${esc(VEHICLE_TYPES[r.vehicleType])} · km ${r.distanceKm} · ${formatTsh(r.fare)} taslimu · Imeagizwa ${esc(formatDate(r.requestedAt, true))}</p>
      </div>
      ${badge(r.status)}
    </div>
    ${r.cancelledBy ? `<p class="alert alert-warn">Imeghairiwa na ${BY[r.cancelledBy] ?? r.cancelledBy}${r.cancelReason ? `: ${esc(r.cancelReason)}` : ''}</p>` : ''}
    ${(r.sos ?? []).some((x) => x.status === 'OPEN') ? '<p class="alert alert-danger"><strong>Dharura iko wazi kwenye safari hii.</strong> <a href="#/dharura">Ishughulikie</a></p>' : ''}
    ${
      r.pinAttempts >= 5
        ? '<p class="alert alert-warn"><strong>PIN imekosewa mara 5</strong> — dereva hawezi kuanza safari. Wapigie wote wawili; ghairi safari ikibidi.</p>'
        : r.pinAttempts > 0
          ? `<p class="muted small">PIN imekosewa mara ${r.pinAttempts}.</p>`
          : ''
    }
    ${r.shared ? '<p class="muted small">Abiria ameshiriki safari hii na ndugu/rafiki.</p>' : ''}
    <div class="people">
      <div class="panel-box"><h2>Abiria</h2>${
        r.passenger ? `<p><strong>${esc(r.passenger.name)}</strong><br><a href="tel:+${esc(r.passenger.phone)}">${esc(formatPhone(r.passenger.phone))}</a></p>` : '—'
      }${r.ratingForPassenger ? `<p class="muted">Nyota kutoka kwa dereva: ${'★'.repeat(r.ratingForPassenger)}</p>` : ''}</div>
      <div class="panel-box"><h2>Dereva</h2>${
        r.driver
          ? `<p><strong>${esc(r.driver.name)}</strong> · ${esc(r.driver.plateNumber)}<br><a href="tel:+${esc(r.driver.phone)}">${esc(formatPhone(r.driver.phone))}</a></p>`
          : '<p class="muted">Bado hakuna dereva.</p>'
      }${r.ratingForDriver ? `<p class="muted">Nyota kutoka kwa abiria: ${'★'.repeat(r.ratingForDriver)}</p>` : ''}</div>
    </div>
    <section class="panel">
      <h2>Mwenendo wa safari</h2>
      <ol class="timeline">${r.timeline
        .map(
          (t) => `<li><strong>${RIDE_STATUS[t.to][1]}</strong> <span class="muted">· ${esc(formatDate(t.at, true))}${t.actorName ? ` · ${esc(t.actorName)}` : ''}</span>${
            t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ''
          }</li>`,
        )
        .join('')}</ol>
    </section>
    ${
      (r.sos ?? []).length
        ? `<section class="panel"><h2>Dharura</h2><ul class="history">${r.sos
            .map(
              (x) => `<li><span><strong>${x.role === 'PASSENGER' ? 'Abiria' : 'Dereva'}: ${esc(x.name)}</strong> · ${x.status === 'OPEN' ? 'Wazi' : 'Imeshughulikiwa'}</span><span class="muted">${esc(
                formatDate(x.createdAt, true),
              )}</span>${x.note ? `<span class="note">${esc(x.note)}</span>` : ''}</li>`,
            )
            .join('')}</ul></section>`
        : ''
    }
    <section class="panel">
      <h2>Maombi kwa madereva</h2>
      ${
        r.offers.length === 0
          ? '<p class="muted">Hakuna dereva aliyepewa ombi.</p>'
          : `<ul class="history">${r.offers
              .map(
                (o) => `<li><span><strong>${esc(o.driverName)}</strong> · km ${o.distanceKm ?? '–'} kutoka kwa abiria</span><span class="muted">${
                  { PENDING: 'Linasubiri', ACCEPTED: 'Amekubali', DECLINED: 'Amekataa', EXPIRED: 'Muda umeisha' }[o.status]
                } · ${esc(formatDate(o.offeredAt, true))}</span></li>`,
              )
              .join('')}</ul>`
      }
    </section>
    ${
      active
        ? `<form class="decision" id="ride-cancel-form">
            <h2>Ghairi safari hii</h2>
            <p class="muted">Tumia tu safari ikiwa imekwama (mf. abiria au dereva hapatikani kwa simu).</p>
            <label for="ride-cancel-reason">Sababu</label>
            <textarea id="ride-cancel-reason" maxlength="300"></textarea>
            <p class="alert alert-danger" id="ride-cancel-error" role="alert" hidden></p>
            <div class="actions"><button class="btn btn-danger" type="submit">Ghairi safari</button></div>
          </form>`
        : ''
    }`;
  $('ride-cancel-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      render(await ctx.api.post(`/api/admin/rides/${r.id}/cancel`, { reason: $('ride-cancel-reason').value }));
    } catch (err) {
      fail(err, 'ride-cancel-error');
      button.disabled = false;
    }
  });
}
