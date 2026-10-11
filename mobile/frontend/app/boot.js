// Inaendeshwa kabla ya ukurasa kuchorwa: aina ya animation ya kufunguka, na sauti yake.
// - Mara ya kwanza kwenye kikao hiki: animation kamili (na sauti). Baadaye (refresh): fupi, bila sauti.
// - Mode ya mwisho ilikuwa Dereva: logo ya njano ya NAYA Dereva.
(function () {
  var root = document.documentElement;
  // Simu ya Android kwenye browser (si ndani ya app ya NAYA): mshauri kupakua app kwanza (/pakua/).
  // "Tumia NAYA kwenye browser" (?web=1) inamruhusu kuendelea, na hatumuulizi tena kwa siku 7.
  try {
    var ua = navigator.userAgent || '';
    var cap = window.Capacitor;
    // Ndani ya APK: Capacitor ipo, au (ikichelewa kupakia) WebView ya Android ("; wv)" kwenye user agent).
    var inApp = !!(cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android') || /;\s*wv\)/.test(ua);
    if (/android/i.test(ua) && !inApp) {
      var chose = /[?&]web=1/.test(location.search);
      var okAt = 0;
      try {
        if (chose) localStorage.setItem('naya_web_ok', String(Date.now()));
        okAt = Number(localStorage.getItem('naya_web_ok')) || 0;
      } catch (e) {
        okAt = chose ? Date.now() : 0;
      }
      if (!chose && Date.now() - okAt > 7 * 864e5) {
        location.replace('/pakua/');
        return;
      }
    }
  } catch (e) {
    /* endelea kawaida */
  }
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
