// Ukurasa wa kupakua NAYA: ukubwa wa APK, ujumbe wa "upakuaji umeanza", na lugha mbili.
import { initI18n } from '/shared/i18n.js';

initI18n();

const $ = (id) => document.getElementById(id);

fetch('/api/pakua')
  .then((r) => (r.ok ? r.json() : null))
  .then((res) => {
    const mb = res?.data?.sizeMb;
    if (mb) $('pk-size').textContent = `MB ${String(mb).replace('.', ',')} · Bure`;
  })
  .catch(() => {});

$('pk-download')?.addEventListener('click', () => {
  setTimeout(() => {
    $('pk-started').hidden = false;
    document.querySelector('.pk-steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 1200);
});
