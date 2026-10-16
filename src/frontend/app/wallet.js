// Akaunti ya dereva → "Malipo ya ofa": kiasi NAYA inachomdai kwa safari za ofa, namba zake za kupokea pesa,
// safari za ofa alizobeba na malipo ambayo NAYA imeshamtumia.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';
import { watchPhone } from '/shared/namelookup.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast }
let editing = null; // id ya namba inayobadilishwa, 'new' = mpya, null = fomu imefungwa
let deleting = null; // id ya namba inayofutwa (inasubiri PIN)
let wallet = null;
let lookup = null; // watchPhone ya fomu iliyo wazi
let who = null; // { phone, result } — jina la namba kutoka mtandao (0.20.0)
const MOBILE = ['MPESA', 'MIXX', 'AIRTEL', 'HALOPESA'];
const lookupOn = () => !!wallet?.nameLookup && MOBILE.includes($('wl-network')?.value);

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

const AUTO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
const shownNumber = (a) => (a.network === 'BANK' ? a.phone : formatPhone(a.phone));

function accountForm(a) {
  const options = Object.entries(NETWORKS)
    .map(([k, l]) => `<option value="${k}"${a?.network === k ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');
  const auto = !!wallet.nameLookup;
  return `<form class="wallet-form" id="wallet-form" data-id="${esc(a?.id ?? '')}" novalidate>
    <label for="wl-network">Mtandao</label>
    <select id="wl-network">${options}</select>
    <label for="wl-phone">Namba ya kupokea pesa</label>
    <input id="wl-phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" value="${esc(a ? shownNumber(a) : '')}">
    ${auto ? '<p class="muted small wl-hint" id="wl-hint">Andika namba tu — jina la mwenye namba litatokea lenyewe kutoka mtandaoni.</p>' : ''}
    <div class="wl-who" id="wl-who" aria-live="polite" hidden></div>
    <div id="wl-name-wrap"${auto && (!a || MOBILE.includes(a.network)) ? ' hidden' : ''}>
      <label for="wl-name">Jina la mwenye namba <span class="muted">(kama lilivyosajiliwa)</span></label>
      <input id="wl-name" autocomplete="name" value="${esc(a?.accountName ?? '')}">
    </div>
    ${wallet.accounts.length > (a ? 1 : 0) ? `<label class="check"><input type="checkbox" id="wl-primary"${a?.primary ? ' checked' : ''}> Namba kuu (NAYA itatuma hapa)</label>` : ''}
    ${
      wallet.walletPin
        ? `<label for="wl-pin">PIN ya wallet</label>
    <input class="mw-pin" id="wl-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••">
    ${wallet.accounts.length ? '<p class="small muted">Ukibadilisha namba kuu, kutoa pesa kutasubiri saa 24 kwa usalama.</p>' : ''}`
        : ''
    }
    <p class="alert alert-danger" id="wl-error" role="alert" hidden></p>
    <div class="wallet-form-actions">
      <button class="btn btn-primary" type="submit">Hifadhi namba</button>
      <button class="btn btn-ghost" type="button" data-wallet="cancel">Acha</button>
    </div>
  </form>`;
}

/** Hali ya jina la namba kwenye fomu (inaitwa na watchPhone). */
function showWho(s) {
  const box = $('wl-who');
  if (!box) return;
  const nameWrap = $('wl-name-wrap');
  if (!lookupOn()) {
    box.hidden = true;
    nameWrap.hidden = false;
    who = null;
    return;
  }
  if (s.state === 'idle') {
    who = null;
    box.hidden = true;
    nameWrap.hidden = true;
    return;
  }
  box.hidden = false;
  if (s.state === 'loading') {
    who = null;
    box.className = 'wl-who is-loading';
    box.innerHTML = '<span class="wl-spin" aria-hidden="true"></span> Inatafuta jina la mwenye namba…';
    return;
  }
  const r = s.state === 'done' ? s.result : null;
  if (!r || !r.available) {
    // Huduma haipatikani (au kikomo cha leo) → aandike jina mwenyewe
    who = null;
    box.className = 'wl-who is-muted';
    box.textContent = s.state === 'error' ? s.message : 'Jina halikupatikana kwa sasa — liandike mwenyewe kama lilivyosajiliwa.';
    nameWrap.hidden = false;
    return;
  }
  if (!r.found) {
    who = { phone: s.phone, result: r };
    box.className = 'wl-who is-bad';
    box.innerHTML = '<strong>Mtandao haujathibitisha namba hii.</strong> Hakikisha umeandika namba sahihi yenye akaunti ya pesa ya simu.';
    nameWrap.hidden = true;
    return;
  }
  who = { phone: s.phone, result: r };
  if (r.network && $('wl-network').value !== r.network && MOBILE.includes(r.network)) $('wl-network').value = r.network;
  box.className = 'wl-who is-found';
  box.innerHTML = `<span class="wl-who-name"><small>Jina kwenye ${esc(r.networkLabel ?? 'mtandao')}</small><strong>${esc(r.name)}</strong></span>
    <label class="check wl-mine"><input type="checkbox" id="wl-mine"> Ndiyo, jina hili ni sahihi</label>`;
  nameWrap.hidden = true;
}

function attachLookup() {
  lookup?.stop();
  lookup = null;
  who = null;
  const input = $('wl-phone');
  if (!input || !wallet?.nameLookup) return;
  lookup = watchPhone(input, { api: ctx.api, purpose: 'PAYOUT', onState: showWho });
  $('wl-network').addEventListener('change', () => {
    if (lookupOn()) lookup.retry();
    else showWho({ state: 'idle' });
  });
}

function render() {
  const box = $('wallet-body');
  if (!box || !wallet) return;
  if (!editing) {
    lookup?.stop();
    lookup = null;
  }
  const w = wallet;
  const noNumber = w.accounts.length === 0;
  const accounts = w.accounts
    .map((a) =>
      editing === a.id
        ? accountForm(a)
        : `<li class="wallet-acc">
            <span><strong>${esc(a.networkLabel)}</strong>${a.primary ? ' <span class="badge badge-ok">Kuu</span>' : ''}${
              a.verified && !a.nameChanged ? ' <span class="badge badge-ok wl-verified" title="Jina limethibitishwa na mtandao">✓ Imethibitishwa</span>' : ''
            }<br>
              <span class="muted">${esc(shownNumber(a))} · ${esc(a.accountName)}</span>${
                a.nameChanged
                  ? `<span class="wl-changed" role="alert"><strong>Jina la namba hii limebadilika kwenye mtandao${a.nameChanged.to ? `: ${esc(a.nameChanged.to)}` : ''}.</strong> NAYA imesimamisha malipo kwenda namba hii mpaka uithibitishe upya.
                      <button class="btn btn-small btn-primary" type="button" data-wallet="edit" data-id="${esc(a.id)}">Thibitisha upya</button></span>`
                  : ''
              }</span>
            <span class="wallet-acc-actions">
              <button class="link-btn" type="button" data-wallet="edit" data-id="${esc(a.id)}">Badilisha</button>
              <button class="link-btn link-danger" type="button" data-wallet="delete" data-id="${esc(a.id)}">Futa</button>
            </span>
            ${
              deleting === a.id
                ? `<span class="wl-del">
                    <label for="wl-del-pin">Weka PIN ya wallet kufuta namba hii${a.primary && w.accounts.length > 1 ? ' (namba nyingine itakuwa kuu; kutoa kutasubiri saa 24)' : ''}</label>
                    <input class="mw-pin" id="wl-del-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••">
                    <p class="alert alert-danger" id="wl-del-error" role="alert" hidden></p>
                    <span class="wallet-form-actions"><button class="btn btn-small btn-danger" type="button" data-wallet="delete-confirm">Futa namba</button>
                    <button class="btn btn-small btn-ghost" type="button" data-wallet="delete-cancel">Acha</button></span>
                  </span>`
                : ''
            }
          </li>`,
    )
    .join('');
  const STATE = {
    PENDING: ['warn', 'Inatumwa…'],
    PAID: ['ok', 'Imetumwa'],
    HELD: ['warn', 'Inasubiri ukaguzi'],
    WAITING: ['muted', 'Inakusanywa'],
    FAILED: ['bad', 'Imeshindwa — ofisi itatuma tena'],
    REJECTED: ['muted', 'Imekataliwa'],
  };
  const trips = w.trips
    .slice(0, 10)
    .map((t) => {
      const st = STATE[t.payoutState];
      return `<li><span><strong>${esc(t.to)}</strong><span class="muted">${esc(formatDate(t.completedAt, true))} · ${esc(t.promoTitle ?? 'Ofa')}</span>${
        st ? `<span class="wallet-state"><span class="badge badge-${st[0]}">${esc(st[1])}</span>${t.payoutState === 'HELD' || t.payoutState === 'REJECTED' ? ` <span class="muted small">${esc(t.payoutNote ?? '')}</span>` : ''}</span>` : ''
      }</span>
        <span class="wallet-amt">+${formatTsh(t.nayaPays)}</span></li>`;
    })
    .join('');
  const payouts = w.payouts
    .slice(0, 10)
    .map(
      (p) => `<li><span><strong>${esc(p.networkLabel)} ${esc(formatPhone(p.phone))}</strong><span class="muted">${esc(formatDate(p.paidAt, true))} · ${esc(p.reference)}${p.automatic ? ' · moja kwa moja' : ''}</span></span>
        <span class="wallet-amt wallet-paid">${formatTsh(p.amount)}</span></li>`,
    )
    .join('');
  box.innerHTML = `
    <div class="wallet-balance${w.balance > 0 ? ' is-owed' : ''}">
      <span>${w.balance > 0 ? 'NAYA itakutumia' : 'Salio'}</span>
      <strong>${formatTsh(w.balance)}</strong>
      <small>Safari za ofa ${w.rides} · Jumla ${formatTsh(w.earned)} · Umeshatumiwa ${formatTsh(w.paid)}</small>
    </div>
    ${
      w.toWallet
        ? `<p class="wallet-auto">${AUTO_ICON}<span><strong>Malipo ya ofa yanaingia kwenye Wallet yako</strong> Safari ya ofa ikikamilika, NAYA inaweka sehemu yake kwenye wallet yako papo hapo. Toa pesa wakati wowote. <a href="#/akaunti/wallet">Fungua Wallet yangu</a></span></p>`
        : w.auto?.enabled
        ? `<p class="wallet-auto">${AUTO_ICON}<span><strong>Malipo ya papo hapo</strong> Safari ya ofa ikikamilika, NAYA inatuma sehemu yake kwenye namba yako kuu ya pesa ya simu yenyewe (hadi ${formatTsh(w.auto.dailyLimit)} kwa siku; zaidi ya hapo ofisi inakagua kwanza).</span></p>`
        : ''
    }
    ${noNumber && editing === null ? `<p class="alert alert-warn" role="status">Weka namba yako ya kupokea pesa ili NAYA ikutumie malipo ya ofa.</p>` : ''}
    ${w.auto?.enabled && !noNumber && w.accounts.some((a) => a.primary && ['BANK', 'TPESA'].includes(a.network)) ? '<p class="alert alert-warn" role="status">Malipo ya papo hapo yanaenda kwa M-Pesa, Mixx, Airtel au HaloPesa tu. Weka mojawapo kuwa namba kuu.</p>' : ''}
    <h3 class="wallet-h">Namba za kupokea malipo</h3>
    ${accounts ? `<ul class="wallet-accs">${accounts}</ul>` : ''}
    ${editing === 'new' ? accountForm(null) : w.accounts.length < 3 && editing === null ? `<button class="btn btn-${noNumber ? 'primary' : 'ghost'} btn-block" type="button" data-wallet="add">${noNumber ? 'Weka namba ya kupokea pesa' : 'Ongeza namba nyingine'}</button>` : ''}
    ${trips ? `<details class="wallet-more"><summary>Safari za ofa ulizobeba</summary><ul class="wallet-list">${trips}</ul></details>` : ''}
    ${payouts ? `<details class="wallet-more"><summary>Malipo uliyotumiwa na NAYA</summary><ul class="wallet-list">${payouts}</ul></details>` : ''}`;
  if (editing) {
    attachLookup();
    $('wl-phone')?.focus();
  }
}

async function onClick(event) {
  const btn = event.target.closest('[data-wallet]');
  if (!btn || !wallet) return;
  const what = btn.dataset.wallet;
  if (what === 'add') editing = 'new';
  else if (what === 'edit') editing = btn.dataset.id;
  else if (what === 'cancel') editing = null;
  else if (what === 'delete') {
    if (wallet.walletPin) {
      deleting = btn.dataset.id;
      render();
      $('wl-del-pin')?.focus();
      return;
    }
    if (!confirm('Futa namba hii ya kupokea malipo?')) return;
    try {
      wallet.accounts = await ctx.api.post(`/api/driver/payout-accounts/${btn.dataset.id}/delete`, {});
      ctx.toast('Namba imefutwa');
    } catch (err) {
      if (!ctx.handleError(err)) ctx.toast(err.message);
    }
  } else if (what === 'delete-cancel') {
    deleting = null;
  } else if (what === 'delete-confirm') {
    btn.disabled = true;
    try {
      wallet.accounts = await ctx.api.post(`/api/driver/payout-accounts/${deleting}/delete`, { pin: $('wl-del-pin').value });
      deleting = null;
      ctx.toast('Namba imefutwa');
    } catch (err) {
      btn.disabled = false;
      if (!ctx.handleError(err, 'wl-del-error')) return;
      return;
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
  if (lookupOn() && !who && $('wl-who') && ($('wl-who').hidden || $('wl-who').classList.contains('is-loading'))) {
    // Jina la mwenye namba bado halijatokea — lisubiri (mtumiaji athibitishe jina kabla ya kuhifadhi)
    lookup?.retry();
    $('wl-error').textContent = 'Subiri kidogo — jina la mwenye namba linatafutwa.';
    $('wl-error').hidden = false;
    return;
  }
  const verifiedHere = lookupOn() && who?.result?.found;
  if (lookupOn() && who?.result && !who.result.found) {
    $('wl-error').textContent = 'Mtandao haujathibitisha namba hii. Andika namba sahihi.';
    $('wl-error').hidden = false;
    return;
  }
  if (verifiedHere && !$('wl-mine')?.checked) {
    $('wl-error').textContent = 'Thibitisha kwamba jina la mwenye namba ni sahihi (weka alama).';
    $('wl-error').hidden = false;
    return;
  }
  button.disabled = true;
  try {
    const body = {
      network: $('wl-network').value,
      phone: $('wl-phone').value,
      accountName: $('wl-name-wrap').hidden ? '' : $('wl-name').value,
      ...(form.dataset.id ? { id: form.dataset.id } : {}),
      ...($('wl-primary') ? { primary: $('wl-primary').checked } : {}),
      ...($('wl-pin') ? { pin: $('wl-pin').value } : {}),
    };
    wallet.accounts = await ctx.api.post('/api/driver/payout-accounts', body);
    editing = null;
    lookup?.stop();
    lookup = null;
    ctx.toast('Namba imehifadhiwa');
    render();
  } catch (err) {
    if (ctx.handleError(err, 'wl-error')) return;
    button.disabled = false;
  }
}
