// Kadi ya salio la akaunti kuu ya Abliner — kwenye Muhtasari na Fedha → Malipo.
// Salio linasomwa na server (GET /api/admin/payments/wallet; inaliuliza Abliner mara moja kila sekunde 30 tu).
import { escapeHtml as esc } from '/shared/api.js';
import { formatTsh } from '/shared/labels.js';
import { countUp } from './ui.js';

const n = (v) => Number(v ?? 0).toLocaleString('en-US');
const time = (d) => new Date(d).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' });
const shown = new WeakSet(); // namba inahesabu juu mara ya kwanza tu kwa kila kadi

export function walletCardHtml(w, { full = false } = {}) {
  const flow = `<dl class="wc-flow">
      <div><dt>Imeingia leo</dt><dd>${formatTsh(w.today.inAmount)}<small>${n(w.today.inCount)} ${w.today.inCount === 1 ? 'muamala' : 'miamala'}</small></dd></div>
      <div><dt>Imetoka leo</dt><dd>${formatTsh(w.today.outAmount)}<small>${n(w.today.outCount)} ${w.today.outCount === 1 ? 'muamala' : 'miamala'}</small></dd></div>
      <div><dt>Inasubiri uthibitisho</dt><dd>${formatTsh(w.pendingOut.amount)}<small>${n(w.pendingOut.count)} ya kutoka</small></dd></div>
    </dl>`;
  const actions = `<div class="wc-actions">
      <button class="wc-btn" type="button" data-wallet="refresh"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>Sasisha</button>
      ${full ? '<a class="wc-btn" href="#/mipangilio#malipo">Kiwango cha onyo</a>' : '<a class="wc-btn wc-btn-strong" href="#/malipo">Fungua Malipo</a>'}
    </div>`;
  if (!w.connected) {
    return `<section class="wallet-card is-off" aria-label="Salio la Abliner">
      <div class="wc-main">
        <span class="wc-label">Akaunti kuu · ${w.provider === 'abliner' ? 'Abliner' : 'Malipo ya simu'}</span>
        <strong class="wc-balance wc-balance-off">Haipatikani</strong>
        <span class="wc-status"><i></i>${esc(w.message ?? 'Abliner haijaunganishwa.')}</span>
      </div>
      ${flow}${actions}
    </section>`;
  }
  return `<section class="wallet-card${w.low ? ' is-low' : ''}" aria-label="Salio la Abliner">
    <div class="wc-main">
      <span class="wc-label">Salio la akaunti kuu · Abliner</span>
      <strong class="wc-balance" data-value="${Number(w.balance)}">${formatTsh(w.balance)}</strong>
      <span class="wc-status"><i></i>${w.low ? 'Salio dogo' : 'Imeunganishwa'} · ilisasishwa saa ${esc(time(w.checkedAt))}</span>
    </div>
    ${flow}${actions}
    ${
      w.low
        ? `<p class="wc-alert" role="alert"><strong>Salio liko chini ya ${formatTsh(w.lowBalance)}.</strong> Jaza salio la Abliner ili malipo ya ofa kwa madereva yasishindwe.</p>`
        : ''
    }
  </section>`;
}

/** Inachora kadi ndani ya `slot`. Inarudisha data (au null) ili Muhtasari uweke onyo kwenye "Kazi zinazokusubiri". */
export async function loadWallet(slot, { ctx, full = false, refresh = false } = {}) {
  if (!slot) return null;
  try {
    const w = await ctx.api.get(`/api/admin/payments/wallet${refresh ? '?refresh=1' : ''}`);
    if (!slot.isConnected) return w;
    const first = !shown.has(slot);
    slot.innerHTML = walletCardHtml(w, { full });
    const bal = slot.querySelector('.wc-balance[data-value]');
    if (first && bal) countUp(bal, Number(bal.dataset.value), (v) => formatTsh(Math.round(v)));
    shown.add(slot);
    slot.onclick = async (event) => {
      const button = event.target.closest('[data-wallet="refresh"]');
      if (!button) return;
      button.disabled = true;
      button.classList.add('spinning');
      await loadWallet(slot, { ctx, full, refresh: true });
    };
    return w;
  } catch (err) {
    if (ctx.onAuthError?.(err)) return null;
    slot.innerHTML = `<section class="wallet-card is-off"><div class="wc-main"><span class="wc-label">Salio la Abliner</span><strong class="wc-balance wc-balance-off">Haipatikani</strong><span class="wc-status"><i></i>${esc(err.message)}</span></div></section>`;
    return null;
  }
}
