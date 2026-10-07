// Ofisi: ada ya mwezi ya madereva — mipangilio, orodha (zilizoisha / zinazokaribia), na kurekodi malipo kwa dereva mmoja.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError }
let filter = 'expired';

export const METHODS = {
  CASH: 'Taslimu',
  MPESA: 'M-Pesa',
  AIRTEL: 'Airtel Money',
  TIGO: 'Mixx by Yas (Tigo Pesa)',
  HALOPESA: 'HaloPesa',
  BANK: 'Benki',
};
const STATE = {
  ACTIVE: ['ok', 'Iko hai'],
  GRACE: ['warn', 'Siku za kulipa'],
  EXPIRED: ['bad', 'Imeisha'],
  NONE: ['muted', 'Haijaanza'],
};
const badge = (state) => `<span class="badge badge-${STATE[state][0]}">${STATE[state][1]}</span>`;

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  const box = $(boxId);
  if (!box) return;
  box.textContent = err.message;
  box.hidden = false;
}

export function setup(context) {
  ctx = context;
  $('sub-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    for (const c of document.querySelectorAll('#sub-filters [data-filter]')) c.setAttribute('aria-pressed', String(c === chip));
    loadList();
  });
  $('sub-settings-form').addEventListener('submit', saveSettings);
}

// ------------------------------------------------------------------ Ukurasa wa "Ada"

export async function loadPage() {
  $('sub-error').hidden = true;
  await Promise.all([loadList(), loadSettings()]);
}

export async function loadList() {
  try {
    const { drivers, stats } = await ctx.api.get(`/api/admin/subscriptions?filter=${filter}`);
    $('sub-month').textContent = formatTsh(stats.monthTotal);
    $('sub-month-count').textContent = `Malipo ${stats.monthPayments} mwezi huu`;
    $('sub-expired').textContent = stats.expiredDrivers;
    $('sub-due').textContent = stats.dueSoonDrivers;
    $('sub-list').innerHTML =
      drivers.length === 0
        ? `<p class="empty">${
            { expired: 'Hakuna dereva mwenye ada iliyoisha. 👍', due: 'Hakuna ada inayoisha ndani ya siku 7.', all: 'Bado hakuna dereva aliyethibitishwa.' }[filter]
          }</p>`
        : drivers
            .map(
              (d) => `<a class="driver-row" href="#/madereva/${esc(d.id)}">
                <span><span class="driver-name">${esc(d.name)}</span><br><span class="driver-sub">${esc(formatPhone(d.phone))}</span></span>
                <span class="col-vehicle">${d.plateNumber ? `<span class="plate">${esc(d.plateNumber)}</span>` : ''}</span>
                <span class="col-date driver-sub">${
                  d.paidUntil ? `${d.state === 'ACTIVE' ? 'Mpaka' : 'Iliisha'} ${esc(formatDate(d.paidUntil))}${d.state === 'ACTIVE' ? ` · siku ${d.daysLeft}` : ''}` : 'Hajawahi kulipa'
                }</span>
                <span>${badge(d.state)}</span>
              </a>`,
            )
            .join('');
  } catch (err) {
    fail(err, 'sub-error');
  }
}

async function loadSettings() {
  try {
    const s = await ctx.api.get('/api/admin/settings/subscription');
    $('set-fee').value = s.monthlyFee;
    $('set-trial').value = s.trialDays;
    $('set-grace').value = s.graceDays;
    $('set-instructions').value = s.paymentInstructions;
  } catch (err) {
    fail(err, 'sub-settings-error');
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const button = event.submitter;
  $('sub-settings-error').hidden = true;
  button.disabled = true;
  try {
    await ctx.api.put('/api/admin/settings/subscription', {
      monthlyFee: Number($('set-fee').value),
      trialDays: Number($('set-trial').value),
      graceDays: Number($('set-grace').value),
      paymentInstructions: $('set-instructions').value,
    });
    $('sub-settings-saved').hidden = false;
    setTimeout(() => ($('sub-settings-saved').hidden = true), 2500);
    loadList();
  } catch (err) {
    fail(err, 'sub-settings-error');
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ Dereva mmoja (ndani ya ukurasa wa dereva)

export async function loadDriverPanel(driverId) {
  const box = $('driver-sub');
  if (!box) return;
  try {
    renderDriverPanel(driverId, await ctx.api.get(`/api/admin/drivers/${driverId}/subscription`));
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    box.innerHTML = `<h2>Ada ya mwezi</h2><p class="alert alert-danger">${esc(err.message)}</p>`;
  }
}

function renderDriverPanel(driverId, sub) {
  const box = $('driver-sub');
  if (!box) return;
  const line =
    sub.state === 'ACTIVE'
      ? `Iko hai mpaka <strong>${esc(formatDate(sub.paidUntil))}</strong> (siku ${sub.daysLeft}).`
      : sub.state === 'GRACE'
        ? `Iliisha ${esc(formatDate(sub.paidUntil))}. Anaweza kuendelea kupokea safari mpaka ${esc(formatDate(sub.graceEndsAt, true))}.`
        : sub.paidUntil
          ? `Iliisha ${esc(formatDate(sub.paidUntil))}. <strong>Hapokei safari</strong> mpaka alipe.`
          : 'Bado hajaanza kulipa.';
  const months = [1, 2, 3, 6, 12];
  box.innerHTML = `
    <div class="detail-head"><h2>Ada ya mwezi</h2>${badge(sub.state)}</div>
    <p>${line}</p>
    <form class="pay-form" id="pay-form" novalidate>
      <h3>Rekodi malipo</h3>
      <div class="pay-grid">
        <div><label for="pay-months">Miezi</label>
          <select id="pay-months">${months.map((m) => `<option value="${m}">${m} — ${formatTsh(sub.monthlyFee * m)}</option>`).join('')}</select></div>
        <div><label for="pay-method">Njia</label>
          <select id="pay-method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div><label for="pay-ref">Namba ya muamala <span class="muted" id="pay-ref-hint">(si lazima kwa taslimu)</span></label>
          <input id="pay-ref" maxlength="40" autocomplete="off" placeholder="Mf. QJK7Y2M1ZP"></div>
      </div>
      <label for="pay-note">Maelezo <span class="muted">(si lazima)</span></label>
      <input id="pay-note" maxlength="300">
      <p class="muted small">Rekodi malipo baada ya kuona pesa imeingia kweli (taslimu mkononi, au SMS ya muamala). Kiasi kinahesabiwa na mfumo.</p>
      <p class="alert alert-danger" id="pay-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-primary" type="submit">Rekodi malipo</button></div>
    </form>
    <h3>Historia ya malipo</h3>
    ${
      sub.payments.length === 0
        ? '<p class="muted">Bado hakuna malipo.</p>'
        : `<ul class="history">${sub.payments
            .map(
              (p) => `<li class="${p.voidedAt ? 'voided' : ''}">
                <span><strong>${formatTsh(p.amount)}</strong> · miezi ${p.months} · ${esc(METHODS[p.method] ?? p.method)}${p.reference ? ` · ${esc(p.reference)}` : ''}</span>
                <span class="muted">${esc(formatDate(p.createdAt, true))} · na ${esc(p.recordedBy)} · mpaka ${esc(formatDate(p.periodEnd))}</span>
                ${p.note ? `<span class="note">${esc(p.note)}</span>` : ''}
                ${p.voidedAt ? `<span class="note">Yamebatilishwa na ${esc(p.voidedBy ?? '')}: ${esc(p.voidReason ?? '')}</span>` : ''}
                ${
                  p.id === sub.voidableId
                    ? `<button class="btn btn-ghost btn-small void-button" type="button" data-void="${p.id}">Batilisha</button>`
                    : ''
                }
              </li>`,
            )
            .join('')}</ul>`
    }
    <form class="reject-form" id="void-form" hidden>
      <label for="void-reason">Kwa nini unabatilisha malipo haya?</label>
      <input id="void-reason" maxlength="300" placeholder="Mf. Nilirekodi mara mbili">
      <p class="alert alert-danger" id="void-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-danger" type="submit">Batilisha malipo</button>
      <button class="btn btn-ghost" type="button" data-void-cancel>Acha</button></div>
    </form>`;

  $('pay-method').addEventListener('change', () => {
    $('pay-ref-hint').textContent = $('pay-method').value === 'CASH' ? '(si lazima kwa taslimu)' : '(lazima)';
  });
  $('pay-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    $('pay-error').hidden = true;
    button.disabled = true;
    try {
      const result = await ctx.api.post(`/api/admin/drivers/${driverId}/subscription/payments`, {
        months: Number($('pay-months').value),
        method: $('pay-method').value,
        reference: $('pay-ref').value || undefined,
        note: $('pay-note').value || undefined,
      });
      renderDriverPanel(driverId, result);
    } catch (err) {
      fail(err, 'pay-error');
      button.disabled = false;
    }
  });
  let voidId = null;
  box.querySelector('[data-void]')?.addEventListener('click', (event) => {
    voidId = event.currentTarget.dataset.void;
    $('void-form').hidden = false;
    $('void-reason').focus();
  });
  box.querySelector('[data-void-cancel]')?.addEventListener('click', () => {
    $('void-form').hidden = true;
  });
  $('void-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      renderDriverPanel(
        driverId,
        await ctx.api.post(`/api/admin/drivers/${driverId}/subscription/payments/${voidId}/void`, { reason: $('void-reason').value }),
      );
    } catch (err) {
      fail(err, 'void-error');
      button.disabled = false;
    }
  });
}
