// Web Push: arifa zinazofika hata app ikiwa imefungwa (Android Chrome, na app iliyosakinishwa kwenye iPhone).
// Inawashwa tu kama VAPID_PUBLIC_KEY na VAPID_PRIVATE_KEY zipo. Bila hizo, kila kitu kingine kinafanya kazi.
import webpush from 'web-push';
import { env } from '../config/env.js';
import { db, many } from '../db/pool.js';

type Sender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency: 'very-low' | 'low' | 'normal' | 'high' },
) => Promise<unknown>;

let sender: Sender | null = null;
if (env.vapidPublicKey && env.vapidPrivateKey) {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  sender = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);
}

export const pushEnabled = () => sender !== null;
export const publicKey = () => (sender && env.vapidPublicKey) || null;

/** Kwa tests tu: badilisha njia ya kutuma (bila mtandao). */
export function setPushSenderForTests(fn: Sender | null) {
  sender = fn;
}

export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | undefined,
) {
  // endpoint ni ya kifaa kimoja; mtu mwingine akiingia kwenye simu hiyo, arifa zinahamia kwake.
  await db.query(
    `INSERT INTO naya.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent, failures = 0`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db.query('DELETE FROM naya.push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}

export interface PushMessage {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
  urgent?: boolean;
  ttlSeconds?: number;
}

/** Tuma arifa kwa vifaa vyote vya mtumiaji. Haitupi kosa kamwe (arifa ni ziada, si sehemu ya muamala). */
export async function sendPush(userId: string, message: PushMessage, log?: { warn: (o: object, m: string) => void }): Promise<number> {
  if (!sender) return 0;
  const subs = await many<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    db,
    'SELECT id, endpoint, p256dh, auth FROM naya.push_subscriptions WHERE user_id = $1',
    [userId],
  );
  const payload = JSON.stringify({
    title: message.title,
    body: message.body ?? '',
    tag: message.tag ?? 'naya',
    url: message.url ?? '/app/',
  });
  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender!({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: message.ttlSeconds ?? 3600,
          urgency: message.urgent ? 'high' : 'normal',
        });
        delivered += 1;
        await db.query('UPDATE naya.push_subscriptions SET last_success_at = now(), failures = 0 WHERE id = $1', [s.id]);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Kifaa kimeondoa ruhusa au app imefutwa → usajili haufai tena.
          await db.query('DELETE FROM naya.push_subscriptions WHERE id = $1', [s.id]);
        } else {
          await db.query('UPDATE naya.push_subscriptions SET failures = failures + 1 WHERE id = $1', [s.id]);
          log?.warn({ status }, 'web push imeshindwa');
        }
      }
    }),
  );
  return delivered;
}
