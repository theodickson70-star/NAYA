// Akaunti ya dereva → "Malipo ya ofa": kiasi NAYA inachomdai kwa safari za ofa, namba zake za kupokea pesa,
// safari za ofa alizobeba na malipo ambayo NAYA imeshamtumia.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast }
let editing = null; // id ya namba inayobadilishwa, 'new' = mpya, null = fomu imefungwa
let wallet = null;

export const NETWORKS = {
  MPESA: 'M-Pesa (Vodacom)',
  MIXX: 'Mixx by Yas (Tigo Pesa)',
  AIRTEL: 'Airtel Money',
  HALOPESA: 'HaloPesa (Halotel)',
  TPESA: 'T-Pesa (TTCL)',
  BANK: 'Benki',
};

export function init(context) {
  ctx = context;
  $('app-content').addEventListener('click', onClick);
  $('app-content').addEventListener('submit', onSubmit);
}

/** Anaweka namba sasa hivi? (usichore upya Akaunti) */
export const isEditing = () => editing !== null;

export function cardHtml() {
  editing = null;
  return `<section class="card wallet-card" aria-labelledby="wallet-title">
    <h2 id="wallet-title">Malipo ya ofa</h2>
    <p class="muted">Ukibeba mteja wa ofa, NAYA inakulipa sehemu iliyopunguzwa kwenye namba yako ya pesa ya simu.</p>
    <div id="wallet-body"><p class="muted">Inaangalia…</p></div>
  </section>`;
}

export async function load() {
  try {
    wallet = await ctx.api.get('/api/driver/promo-wallet');
    render();
  } catch (err) {
    if (ctx.handleError(err)) return;
    if ($('wallet-body')) $('wallet-body').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  }
}

const shownNumber = (a) => (a.network === 'BANK' ? a.phone : formatPhone(a.phone));

function accountForm(a) {
  const options = Object.entries(NETWORKS)
    .map(([k, l]) => `<option value="${k}"${a?.network === k ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');
  return `<form class="wallet-form" id="wallet-form" data-id="${esc(a?.id ?? '')}" novalidate>
    <label for="wl-network">Mtandao</label>
    <select id="wl-network">${options}</select>
    <label for="wl-phone">Namba ya kupokea pesa</label>
    <input id="wl-phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" value="${esc(a ? shownNumber(a) : '')}">
    <label for="wl-name">Jina la mwenye namba <span class="muted">(kama lilivyosajiliwa)</span></label>
    <input id="wl-name" autocomplete="name" value="${esc(a?.accountName ?? '')}">
    ${wallet.accounts.length > (a ? 1 : 0) ? `<label class="check"><input type="checkbox" id="wl-primary"${a?.primary ? ' checked' : ''}> Namba kuu (NAYA itatuma hapa)</label>` : ''}
    <p class="alert alert-danger" id="wl-error" role="alert" hidden></p>
    <div class="wallet-form-actions">
      <button class="btn btn-primary" type="submit">Hifadhi namba</button>
      <button class="btn btn-ghost" type="button" data-wallet="cancel">Acha</button>
    </div>
  </form>`;
}

function render() {
  const box = $('wallet-body');
  if (!box || !wallet) return;
  const w = wallet;
  const noNumber = w.accounts.length === 0;
  const accounts = w.accounts
    .map((a) =>
      editing === a.id
        ? accountForm(a)
        : `<li class="wallet-acc">
            <span><strong>${esc(a.networkLabel)}</strong>${a.primary ? ' <span class="badge badge-ok">Kuu</span>' : ''}<br>
              <span class="muted">${esc(shownNumber(a))} · ${esc(a.accountName)}</span></span>
            <span class="wallet-acc-actions">
              <button class="link-btn" type="button" data-wallet="edit" data-id="${esc(a.id)}">Badilisha</button>
              <button class="link-btn link-danger" type="button" data-wallet="delete" data-id="${esc(a.id)}">Futa</button>
            </span>
          </li>`,
    )
    .join('');
  const trips = w.trips
    .slice(0, 10)
    .map(
      (t) => `<li><span><strong>${esc(t.to)}</strong><span class="muted">${esc(formatDate(t.completedAt, true))} · ${esc(t.promoTitle ?? 'Ofa')}</span></span>
        <span class="wallet-amt">+${formatTsh(t.nayaPays)}</span></li>`,
    )
    .join('');
  const payouts = w.payouts
    .slice(0, 10)
    .map(
      (p) => `<li><span><strong>${esc(p.networkLabel)} ${esc(formatPhone(p.phone))}</strong><span class="muted">${esc(formatDate(p.paidAt, true))} · ${esc(p.reference)}</span></span>
        <span class="wallet-amt wallet-paid">${formatTsh(p.amount)}</span></li>`,
    )
    .join('');
  box.innerHTML = `
    <div class="wallet-balance${w.balance > 0 ? ' is-owed' : ''}">
      <span>${w.balance > 0 ? 'NAYA itakutumia' : 'Salio'}</span>
      <strong>${formatTsh(w.balance)}</strong>
      <small>Safari za ofa ${w.rides} · Jumla ${formatTsh(w.earned)} · Umeshatumiwa ${formatTsh(w.paid)}</small>
    </div>
    ${noNumber && editing === null ? `<p class="alert alert-warn" role="status">Weka namba yako ya kupokea pesa ili NAYA ikutumie malipo ya ofa.</p>` : ''}
    <h3 class="wallet-h">Namba za kupokea malipo</h3>
    ${accounts ? `<ul class="wallet-accs">${accounts}</ul>` : ''}
    ${editing === 'new' ? accountForm(null) : w.accounts.length < 3 && editing === null ? `<button class="btn btn-${noNumber ? 'primary' : 'ghost'} btn-block" type="button" data-wallet="add">${noNumber ? 'Weka namba ya kupokea pesa' : 'Ongeza namba nyingine'}</button>` : ''}
    ${trips ? `<details class="wallet-more"><summary>Safari za ofa ulizobeba</summary><ul class="wallet-list">${trips}</ul></details>` : ''}
    ${payouts ? `<details class="wallet-more"><summary>Malipo uliyotumiwa na NAYA</summary><ul class="wallet-list">${payouts}</ul></details>` : ''}`;
  if (editing) $('wl-phone')?.focus();
}

async function onClick(event) {
  const btn = event.target.closest('[data-wallet]');
  if (!btn || !wallet) return;
  const what = btn.dataset.wallet;
  if (what === 'add') editing = 'new';
  else if (what === 'edit') editing = btn.dataset.id;
  else if (what === 'cancel') editing = null;
  else if (what === 'delete') {
    if (!confirm('Futa namba hii ya kupokea malipo?')) return;
    try {
      wallet.accounts = await ctx.api.post(`/api/driver/payout-accounts/${btn.dataset.id}/delete`, {});
      ctx.toast('Namba imefutwa');
    } catch (err) {
      if (!ctx.handleError(err)) ctx.toast(err.message);
    }
  }
  render();
}

async function onSubmit(event) {
  if (event.target.id !== 'wallet-form') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  $('wl-error').hidden = true;
  button.disabled = true;
  try {
    const body = {
      network: $('wl-network').value,
      phone: $('wl-phone').value,
      accountName: $('wl-name').value,
      ...(form.dataset.id ? { id: form.dataset.id } : {}),
      ...($('wl-primary') ? { primary: $('wl-primary').checked } : {}),
    };
    wallet.accounts = await ctx.api.post('/api/driver/payout-accounts', body);
    editing = null;
    ctx.toast('Namba imehifadhiwa');
    render();
  } catch (err) {
    if (ctx.handleError(err, 'wl-error')) return;
    button.disabled = false;
  }
}
