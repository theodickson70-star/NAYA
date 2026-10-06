// Inaendeshwa kabla ya ukurasa kuchorwa: aina ya animation ya kufunguka.
// - Mara ya kwanza kwenye kikao hiki: animation kamili. Baadaye (refresh): fupi.
// - Mode ya mwisho ilikuwa Dereva: logo ya njano ya NAYA Dereva.
(function () {
  var root = document.documentElement;
  try {
    if (sessionStorage.getItem('naya_splash_seen')) root.classList.add('splash-quick');
    if (localStorage.getItem('naya_last_mode') === 'DRIVER') root.classList.add('splash-driver');
  } catch (e) {
    /* storage imezuiwa — animation kamili */
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('splash-quick');
})();
