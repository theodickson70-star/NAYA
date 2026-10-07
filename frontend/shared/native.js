// App ya Android ya NAYA (APK): ukurasa huu huu unafunguliwa ndani ya app, na simu inaongeza vitu ambavyo
// browser haiwezi — hasa kengele ya ombi la safari ya sekunde 30 hata app ikiwa imefungwa (Firebase).
// Kwenye browser ya kawaida kila kitu hapa kinarudisha "si app" na hakuna kinachobadilika.

const PLUGIN = 'NayaNative';

function bridge() {
  const cap = window.Capacitor;
  if (!cap || typeof cap.nativePromise !== 'function') return null;
  if (cap.getPlatform?.() !== 'android') return null;
  return cap;
}

/** Je, ukurasa uko ndani ya app ya Android ya NAYA? */
export const isNativeApp = () => bridge() !== null;

function call(method, options = {}) {
  const cap = bridge();
  if (!cap) return Promise.reject(new Error('Si app ya NAYA'));
  return cap.nativePromise(PLUGIN, method, options);
}

/** { native, appVersion, firebase, notifications, fullScreen, token, sdk } */
export async function nativeInfo() {
  return call('getInfo');
}

let serverPromise = null;
function serverEnabled(api) {
  serverPromise ??= api
    .get('/api/push/fcm')
    .then((r) => !!r.enabled)
    .catch((err) => {
      serverPromise = null;
      throw err;
    });
  return serverPromise;
}

let registeredToken = null;

/** Sajili simu hii kwenye server (kimya). Inaitwa kila app inapofunguka mtumiaji akiwa ameingia. */
export async function syncNative(api) {
  if (!isNativeApp()) return null;
  const info = await nativeInfo();
  if (!info.firebase || !info.notifications) return info;
  const { token } = await call('getToken');
  if (token && token !== registeredToken) {
    await api.post('/api/push/fcm', { token, appVersion: info.appVersion });
    registeredToken = token;
  }
  return { ...info, token };
}

/** Hali ya arifa ndani ya app — majina sawa na ya Web Push ('server-off' | 'off' | 'on'). */
export async function nativePushState(api) {
  const info = await nativeInfo();
  if (!info.firebase) return 'server-off';
  try {
    if (!(await serverEnabled(api))) return 'server-off';
  } catch {
    return 'server-off';
  }
  return info.notifications ? 'on' : 'off';
}

/** Omba ruhusa ya arifa (Android 13+), kisha sajili simu. */
export async function enableNativePush(api) {
  let info = await call('requestNotifications');
  if (!info.notifications) {
    await call('openNotificationSettings').catch(() => {});
    throw new Error('Ruhusu arifa za NAYA kwenye mipangilio ya simu, kisha rudi hapa.');
  }
  if (!info.firebase) throw new Error('Toleo hili la app halina huduma ya arifa. Pakua toleo jipya la NAYA.');
  info = await syncNative(api);
  return info;
}

/** Mtumiaji akitoka: simu hii isipokee tena arifa zake (server pia inafuta zote kwenye logout). */
export async function forgetNative(api) {
  if (!isNativeApp()) return;
  await call('stopRinging').catch(() => {});
  if (registeredToken) await api.post('/api/push/fcm/remove', { token: registeredToken }).catch(() => {});
  registeredToken = null;
}

export const openNotificationSettings = () => call('openNotificationSettings');
export const openFullScreenSettings = () => call('openFullScreenSettings');
export const testRing = (seconds = 8) => call('testRing', { seconds });
export const stopRinging = () => call('stopRinging');
