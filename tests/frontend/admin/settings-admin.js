// Ofisi → Mipangilio ya mfumo (#/mipangilio): maombi ya safari (mfumo huru), malipo ya simu (Abliner), ada, bei na maeneo.
// Mfumo huru na ada vinachorwa na subscriptions-admin.js (vipengele vyake viko kwenye ukurasa huu).
import { escapeHtml as esc } from '/shared/api.js';
import { formatTsh } from '/shared/labels.js';
import * as subsAdmin from './subscriptions-admin.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError, toast }

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  const box = $(boxId);
  if (!box) return;
  box.textContent = err.message;
  box.hidden = false;
}

export function setup(context) {
  ctx = context;
  $('set-check').addEventListener('click', checkConnection);
  $('set-autopay-form').addEventListener('submit', saveAutoPay);
}

/** section: 'maombi' | 'malipo' | 'ada' | 'mengine' — sehemu ya kuonyesha (kutoka #/mipangilio#ada). */
export async function open(section) {
  $('ap-error').hidden = true;
  $('set-check-out').innerHTML = '';
  await Promise.all([subsAdmin.loadSettingsSection(), loadPayments()]);
  if (section) {
    const el = $(`set-${section}`);
    if (el) {
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      el.classList.remove('flash');
      void el.offsetWidth; // anzisha animation upya
      el.classList.add('flash');
    }
  }
}

async function loadPayments() {
  try {
    const [o, w] = await Promise.all([ctx.api.get('/api/admin/payments/overview'), ctx.api.get('/api/admin/payments/wallet')]);
    const provider = o.config.provider === 'abliner' ? 'Abliner' : o.config.provider;
    $('set-provider').innerHTML = o.config.enabled
      ? `Kampuni ya malipo: <strong>${esc(provider)}</strong>${w.connected && w.balance != null ? ` · salio ${esc(formatTsh(w.balance))}` : ''}`
      : 'Kampuni ya malipo haijaunganishwa (PAYMENT_PROVIDER kwenye Railway). Malipo yanafanywa kwa mkono.';
    $('ap-enabled').checked = !!o.settings.enabled;
    $('ap-enabled').disabled = !o.config.canDisburse;
    $('ap-limit').value = o.settings.dailyLimit;
    $('wl-low').value = w.lowBalance;
  } catch (err) {
    fail(err, 'ap-error');
  }
}

async function checkConnection() {
  const out = $('set-check-out');
  const button = $('set-check');
  button.disabled = true;
  out.innerHTML = '<p class="small muted">Inakagua…</p>';
  try {
    const r = await ctx.api.get('/api/admin/payments/provider-check');
    const lines = [];
    if (r.problem) lines.push(`<p class="alert alert-danger">${esc(r.problem)}</p>`);
    if (r.check?.ok) {
      lines.push(`<p class="alert alert-ok">Muunganiko uko sawa${r.check.balance != null ? ` — salio la Abliner: <strong>${esc(r.check.currency ?? 'TZS')} ${esc(Number(r.check.balance).toLocaleString('en-US'))}</strong>` : ''}.</p>`);
    } else if (r.check) {
      lines.push(`<p class="alert alert-danger">${esc(r.check.message)}</p>`);
    } else if (!r.problem) {
      lines.push('<p class="alert alert-warn">PAYMENT_PROVIDER haijawekwa — malipo ya simu yamezimwa.</p>');
    }
    lines.push(`<p class="small">Webhook URL ya kuweka Abliner → API Keys: <code>${esc(r.webhookUrl ?? `${location.origin}/api/payments/callback/abliner`)}</code></p>`);
    out.innerHTML = lines.join('');
  } catch (err) {
    out.innerHTML = '';
    fail(err, 'ap-error');
  } finally {
    button.disabled = false;
  }
}

async function saveAutoPay(event) {
  event.preventDefault();
  const button = event.submitter;
  $('ap-error').hidden = true;
  if (button) button.disabled = true;
  try {
    const writes = [ctx.api.put('/api/admin/payments/wallet-settings', { lowBalance: Number($('wl-low').value) })];
    if (!$('ap-enabled').disabled || $('ap-limit').value) {
      writes.push(ctx.api.put('/api/admin/payments/auto-payout', { enabled: $('ap-enabled').checked, dailyLimit: Number($('ap-limit').value) }));
    }
    await Promise.all(writes);
    ctx.toast('Mipangilio ya malipo imehifadhiwa');
    await loadPayments();
  } catch (err) {
    fail(err, 'ap-error');
  } finally {
    if (button) button.disabled = false;
  }
}
