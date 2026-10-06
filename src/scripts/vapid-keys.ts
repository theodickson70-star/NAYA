// Tengeneza funguo za Web Push (VAPID) MARA MOJA, kisha ziweke kwenye .env na Railway → Variables.
//   npm run vapid-keys
// Usizibadilishe baadaye: simu zilizokwisha kukubali arifa zingeacha kupokea mpaka zikubali upya.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`
Funguo mpya za arifa (VAPID). Nakili mistari hii mitatu kwenye .env yako NA Railway → Variables:

VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:weka-barua-pepe-yako@mfano.com

VAPID_PRIVATE_KEY ni siri — usiiweke GitHub wala kuituma kwa mtu.
`);
