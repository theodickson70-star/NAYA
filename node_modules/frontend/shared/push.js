// Arifa za simu (Web Push): simu ilie ombi la safari likiingia, hata app ikiwa imefungwa.
// Ndani ya app ya Android (APK) arifa zinapita Firebase badala yake — angalia /shared/native.js.
// Service worker (/app/sw.js) inaonyesha arifa tu — haihifadhi kurasa (kwa hiyo hakuna toleo la zamani linalokwama).

import { enableNativePush, forgetNative, isNativeApp, nativePushState } from '/shared/native.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let keyPromise = null; // funguo ya server haibadiliki ukurasa ukiwa wazi — iulize mara moja tu
function serverKey(api) {
  keyPromise ??= api.get('/api/push/public-key').then((r) => r.publicKey).catch((err) => {
    keyPromise = null;
    throw err;
  });
  return keyPromise;
}

/** 'unsupported' | 'server-off' | 'denied' | 'on' | 'off' */
export async function pushState(api) {
  if (isNativeApp()) return nativePushState(api);
  if (!supported()) return 'unsupported';
  try {
    if (!(await serverKey(api))) return 'server-off';
  } catch {
    return 'server-off';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/app/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Lazima iitwe ndani ya kubonyeza kitufe (browsers zinahitaji hivyo kuomba ruhusa). */
export async function enablePush(api) {
  if (isNativeApp()) return enableNativePush(api);
  if (!supported()) throw new Error('Simu au browser hii haiwezi kupokea arifa. Tumia Chrome kwenye Android, au sakinisha app kwenye iPhone.');
  const key = await serverKey(api);
  if (!key) throw new Error('Arifa bado hazijawashwa kwenye server ya NAYA.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Umekataa ruhusa ya arifa. Ifungue kwenye mipangilio ya browser (Site settings → Notifications).');
  }
  const reg = await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) });
  await api.post('/api/push/subscribe', sub.toJSON());
}

export async function disablePush(api) {
  if (isNativeApp()) return forgetNative(api);
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/app/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
