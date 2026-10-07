// Inaendeshwa kabla ya ukurasa kuchorwa: aina ya animation ya kufunguka, na sauti yake.
// - Mara ya kwanza kwenye kikao hiki: animation kamili (na sauti). Baadaye (refresh): fupi, bila sauti.
// - Mode ya mwisho ilikuwa Dereva: logo ya njano ya NAYA Dereva.
(function () {
  var root = document.documentElement;
  // Lugha: English → ficha ukurasa kwa muda mfupi mpaka tafsiri iwe tayari (shared/i18n.js inaondoa darasa hili).
  try {
    if (localStorage.getItem('naya_lang') === 'en') {
      root.lang = 'en';
      root.classList.add('i18n-pending');
      setTimeout(function () { root.classList.remove('i18n-pending'); }, 2500);
    }
  } catch (e) {
    /* storage imezuiwa — Kiswahili */
  }
  var quick = false;
  var soundOn = true;
  try {
    quick = !!sessionStorage.getItem('naya_splash_seen');
    soundOn = localStorage.getItem('naya_sound') !== 'off';
    if (localStorage.getItem('naya_last_mode') === 'DRIVER') root.classList.add('splash-driver');
  } catch (e) {
    /* storage imezuiwa — animation kamili */
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) quick = true;
  if (quick) root.classList.add('splash-quick');

  // Sauti ya logo: inaanza pamoja na animation. Browser ikizuia sauti kabla mtu hajagusa skrini,
  // splash.js inajaribu tena mara ya kwanza mtu akigusa (bado wakati logo inajitengeneza).
  if (!quick && soundOn && window.Audio) {
    try {
      var audio = new Audio('/shared/sounds/naya-intro.mp3');
      audio.preload = 'auto';
      audio.volume = 0.85;
      window.__nayaIntroAudio = audio;
      var p = audio.play();
      if (p && p.catch) p.catch(function () { audio.__blocked = true; });
    } catch (e) {
      /* hakuna sauti — sawa */
    }
  }
})();
