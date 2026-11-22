// Inaendeshwa kabla ukurasa haujachorwa: aina ya simu (Android / iPhone / kompyuta) na lugha.
(function () {
  var root = document.documentElement;
  var ua = navigator.userAgent || '';
  var cap = window.Capacitor;
  // Tayari ndani ya app ya NAYA (APK)? Hakuna cha kupakua — ingia moja kwa moja.
  if ((cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android') || /;\s*wv\)/.test(ua)) {
    location.replace('/app/?web=1');
    return;
  }
  var platform = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 'ontouchend' in document) ? 'ios' : 'desktop';
  root.setAttribute('data-platform', platform);
  try {
    if (localStorage.getItem('naya_lang') === 'en') {
      root.lang = 'en';
      root.classList.add('i18n-pending');
      setTimeout(function () { root.classList.remove('i18n-pending'); }, 2500);
    }
  } catch (e) {
    /* storage imezuiwa — Kiswahili */
  }
})();
