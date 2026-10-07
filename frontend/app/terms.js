// Masharti ya NAYA ndani ya app: (1) kusoma masharti bila kuacha ukurasa (link yoyote yenye data-terms),
// (2) watumiaji wa zamani / toleo jipya: dirisha la "Nakubali" kabla ya kuendelea.
// Maandishi yenyewe yako /masharti/index.html (ukurasa mmoja kwa wote — app, tovuti, ofisi).
const $ = (id) => document.getElementById(id);
let docHtml = null;
let lastFocus = null;

async function loadDoc() {
  if (docHtml) return docHtml;
  const res = await fetch('/masharti/', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Masharti hayakupatikana. Jaribu tena.');
  const page = new DOMParser().parseFromString(await res.text(), 'text/html');
  docHtml = page.getElementById('masharti-doc').innerHTML;
  return docHtml;
}

/** Fungua masharti kwenye dirisha la juu (section: jumla | abiria | dereva | faragha). */
export async function openTerms(section = 'jumla') {
  closeTerms();
  lastFocus = document.activeElement;
  const sheet = document.createElement('div');
  sheet.className = 'terms-sheet';
  sheet.id = 'terms-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Masharti ya NAYA');
  sheet.innerHTML = `<header class="terms-bar">
      <span class="terms-brand"><img src="/shared/brand/naya-icon.svg" alt="" width="32" height="32"><img src="/shared/brand/naya-wordmark-white.svg" alt="NAYA" width="76" height="22"></span>
      <button class="terms-back" type="button" data-terms-close>Funga</button>
    </header>
    <div class="terms-scroll"><div class="terms-doc"><p class="muted">Inapakia masharti…</p></div></div>`;
  document.body.append(sheet);
  sheet.querySelector('[data-terms-close]').focus();
  const doc = sheet.querySelector('.terms-doc');
  try {
    doc.innerHTML = await loadDoc();
    // Link za ndani (#abiria …) zisogeze ndani ya dirisha tu, zisibadilishe route ya app.
    for (const a of doc.querySelectorAll('.terms-nav a')) a.dataset.termsJump = a.getAttribute('href').slice(1);
    jump(section);
  } catch (err) {
    doc.innerHTML = `<p class="alert alert-danger" role="alert">${err.message}</p>`;
  }
}

function jump(section) {
  const target = document.querySelector(`#terms-sheet [id="${section}"]`);
  if (target) target.scrollIntoView({ block: 'start' });
}

export function closeTerms() {
  const sheet = $('terms-sheet');
  if (!sheet) return;
  sheet.remove();
  lastFocus?.focus?.();
}

document.addEventListener('click', (event) => {
  const open = event.target.closest('[data-terms]');
  if (open) {
    event.preventDefault();
    openTerms(open.dataset.terms);
    return;
  }
  const hop = event.target.closest('[data-terms-jump]');
  if (hop) {
    event.preventDefault();
    jump(hop.dataset.termsJump);
    return;
  }
  if (event.target.closest('[data-terms-close]')) closeTerms();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('terms-sheet')) closeTerms();
});

/**
 * Mtumiaji hajakubali toleo la sasa (aliyejisajili kabla ya masharti, au masharti yamebadilika).
 * Dirisha hili haliwezi kufungwa bila kukubali. needDriver = pia masharti ya dereva.
 */
export function askToAccept({ api, needDriver, onDone }) {
  if ($('terms-accept')) return;
  const box = document.createElement('div');
  box.className = 'terms-gate';
  box.id = 'terms-accept';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'terms-gate-title');
  box.innerHTML = `<form class="terms-gate-card" novalidate>
      <img src="/shared/brand/naya-icon.svg" alt="" width="48" height="48">
      <h2 id="terms-gate-title">Masharti ya NAYA</h2>
      <p>Tumeweka masharti ya huduma na sera ya faragha ili kulinda abiria na madereva wote. Yasome, kisha ukubali ili kuendelea kutumia NAYA.</p>
      <ul class="terms-gate-links">
        <li><a href="/masharti/#jumla" data-terms="jumla">Masharti ya Huduma</a></li>
        ${needDriver ? '<li><a href="/masharti/#dereva" data-terms="dereva">Masharti ya Dereva</a></li>' : ''}
        <li><a href="/masharti/#faragha" data-terms="faragha">Sera ya Faragha</a></li>
      </ul>
      <label class="terms-check" for="terms-gate-check">
        <input type="checkbox" id="terms-gate-check">
        <span>Nimesoma na ninakubali masharti${needDriver ? ' (pamoja na Masharti ya Dereva)' : ''} na sera ya faragha ya NAYA.</span>
      </label>
      <p class="alert alert-danger" id="terms-gate-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Nakubali, endelea</button>
    </form>`;
  document.body.append(box);
  const form = box.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('terms-gate-error');
    error.hidden = true;
    if (!$('terms-gate-check').checked) {
      error.textContent = 'Weka alama kwenye kisanduku kukubali masharti.';
      error.hidden = false;
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const state = await api.post('/api/account/terms', { accept: true, driver: needDriver });
      box.remove();
      onDone?.(state);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
}
