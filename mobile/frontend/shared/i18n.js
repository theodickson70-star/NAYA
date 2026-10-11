// Lugha mbili za NAYA: Kiswahili (asili ya maandishi yote) na English.
// Maandishi ya app yameandikwa kwa Kiswahili; mtumiaji akichagua English, kila maandishi yanayoonekana
// kwenye ukurasa (pamoja na yanayochorwa baadaye) yanatafsiriwa kwa kamusi moja: /shared/i18n/en.json
// (kamusi hiyo hiyo inatumiwa na server kwa makosa, arifa na SMS).
// Kitu chochote ndani ya [translate="no"] (majina, maoni ya watu, masharti yaliyoandikwa tayari) hakiguswi.

const KEY = 'naya_lang';
export const LANGS = { sw: 'Kiswahili', en: 'English' };

let lang = 'sw';
try {
  lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'sw';
} catch {
  lang = 'sw';
}

let dict = null; // { exact: Map, patterns: [RegExp, string][] }
let observer = null;
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE']);

export const getLang = () => lang;

function compile(raw) {
  const exact = new Map(Object.entries(raw.exact));
  const patterns = raw.patterns.map(([sw, en]) => {
    const source = sw
      .split('{}')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('(.+?)');
    return [new RegExp(`^${source}$`, 's'), en];
  });
  return { exact, patterns };
}

/** Tafsiri maandishi (bila kubadilisha nafasi za mwanzo/mwisho). Yasiyojulikana yanabaki kama yalivyo. */
export function t(text) {
  if (lang === 'sw' || !dict || typeof text !== 'string') return text;
  const core = text.trim();
  if (!core) return text;
  const hit = translateCore(core);
  if (hit === core) return text;
  const lead = text.slice(0, text.indexOf(core[0]));
  const trail = text.slice(text.lastIndexOf(core[core.length - 1]) + 1);
  return lead + hit + trail;
}

function translateCore(core) {
  const norm = core.replace(/\s+/g, ' ');
  const direct = dict.exact.get(norm);
  if (direct !== undefined) return direct;
  for (const [re, en] of dict.patterns) {
    const m = re.exec(norm);
    if (!m) continue;
    let i = 1;
    return en.replace(/\{\}/g, () => {
      const part = m[i++] ?? '';
      return dict.exact.get(part.trim()) ?? part;
    });
  }
  return core;
}

function skipped(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (SKIP.has(n.tagName) || n.getAttribute('translate') === 'no') return true;
  }
  return false;
}

function doText(node) {
  // Maandishi ndani ya textarea ni ya mtumiaji — usiyaguse (placeholder yake inatafsiriwa kwenye doAttrs).
  if (!node.parentElement || node.parentElement.tagName === 'TEXTAREA' || skipped(node.parentElement)) return;
  if (node.__nayaEn !== undefined && node.data === node.__nayaEn) return;
  const original = node.data;
  const out = t(original);
  if (out !== original) {
    node.__nayaSw = original;
    node.__nayaEn = out;
    node.data = out;
  }
}

function doAttrs(el) {
  if (skipped(el)) return;
  el.__nayaAttrs ??= {};
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (!value || value === el.__nayaAttrs[name]?.en) continue;
    const out = t(value);
    if (out !== value) {
      el.__nayaAttrs[name] = { sw: value, en: out };
      el.setAttribute(name, out);
    }
  }
}

function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1 || skipped(root)) return;
  doAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else if (SKIP.has(n.tagName) || n.getAttribute('translate') === 'no') continue;
    else doAttrs(n);
  }
}

function start() {
  walk(document.documentElement);
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
      else for (const n of r.addedNodes) walk(n);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Rudisha Kiswahili cha asili kwa vitu vilivyotafsiriwa (bila kupakia ukurasa upya). */
function restore() {
  observer?.disconnect();
  observer = null;
  const it = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) {
      if (n.__nayaSw !== undefined && n.data === n.__nayaEn) n.data = n.__nayaSw;
      n.__nayaSw = n.__nayaEn = undefined;
    } else if (n.__nayaAttrs) {
      for (const [name, v] of Object.entries(n.__nayaAttrs)) if (n.getAttribute(name) === v.en) n.setAttribute(name, v.sw);
      n.__nayaAttrs = undefined;
    }
  }
}

async function loadDict() {
  if (dict) return;
  const res = await fetch('/shared/i18n/en.json');
  if (!res.ok) throw new Error('i18n');
  dict = compile(await res.json());
}

function syncSwitches() {
  for (const b of document.querySelectorAll('.lang-switch [data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

function reveal() {
  syncSwitches();
  document.documentElement.classList.remove('i18n-pending');
}

/** Inaitwa mara moja ukurasa ukianza. English: pakia kamusi, tafsiri, kisha onyesha ukurasa. */
export async function initI18n() {
  document.documentElement.lang = lang;
  if (lang === 'en') {
    try {
      await loadDict();
      start();
    } catch {
      /* kamusi haikupakia — ukurasa unabaki Kiswahili */
    }
  }
  reveal();
}

const listeners = new Set();
export const onLangChange = (fn) => listeners.add(fn);

export async function setLang(next) {
  next = next === 'en' ? 'en' : 'sw';
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage imezuiwa — lugha inabaki kwa kikao hiki tu */
  }
  if (next === 'en') {
    await loadDict();
    lang = 'en';
    document.documentElement.lang = 'en';
    start();
  } else {
    restore();
    lang = 'sw';
    document.documentElement.lang = 'sw';
  }
  for (const fn of listeners) fn(lang);
}

/** Kitufe cha kubadili lugha (KISWAHILI | ENGLISH). Kinajichora upya lugha ikibadilika. */
export function langSwitchHtml(extraClass = '') {
  return `<div class="lang-switch ${extraClass}" role="group" aria-label="Lugha / Language" translate="no">
    ${Object.entries(LANGS)
      .map(([code, label]) => `<button type="button" data-lang="${code}" aria-pressed="${code === lang}" lang="${code}">${label}</button>`)
      .join('')}
  </div>`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.lang-switch [data-lang]');
  if (!button) return;
  setLang(button.dataset.lang).then(syncSwitches);
});
