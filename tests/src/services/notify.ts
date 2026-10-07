// Sehemu moja ya kumjulisha mtumiaji: tukio la papo hapo (app iliyo wazi) + arifa ya kudumu + Web Push (app iliyofungwa).
// App ya Android (APK) inapokea pia kupitia Firebase: ombi jipya → kengele ya sekunde 30 hata app ikiwa imefungwa.
// Inaitwa BAADA ya transaction kukamilika, na haitupi kosa kamwe — kushindwa kwa arifa hakuvunji safari.
import { db, many, one } from '../db/pool.js';
import { type EventType, publish } from '../realtime/hub.js';
import { sendFcm } from './fcm.js';
import { sendPush } from './push.js';
import { sendSms, smsEnabled } from './sms.js';

export interface Notice {
  userId: string;
  event: EventType;
  rideId?: string | null;
  /** Kama ipo: inahifadhiwa kwenye arifa za mtumiaji na kutumwa kama Web Push. */
  title?: string;
  body?: string;
  kind?: string;
  urgent?: boolean;
  ttlSeconds?: number;
  /** Kama ipo: inatumwa pia kama SMS (kwa taarifa muhimu tu — kila SMS inalipiwa). */
  sms?: string;
}

export async function notify(n: Notice): Promise<void> {
  try {
    await publish({ type: n.event, userId: n.userId, rideId: n.rideId ?? null });
    if (n.title) {
      await db.query('INSERT INTO naya.notifications (user_id, kind, title, body, ride_id) VALUES ($1, $2, $3, $4, $5)', [
        n.userId,
        n.kind ?? n.event,
        n.title,
        n.body ?? null,
        n.rideId ?? null,
      ]);
      await sendPush(n.userId, {
        title: n.title,
        body: n.body,
        tag: n.kind ?? n.event,
        urgent: n.urgent,
        ttlSeconds: n.ttlSeconds,
      });
      const ttl = n.ttlSeconds ?? 3600;
      if (n.event === 'offer') {
        await sendFcm(n.userId, {
          data: {
            type: 'offer',
            rideId: n.rideId ?? '',
            title: n.title,
            body: n.body ?? '',
            expiresAt: String(Date.now() + ttl * 1000),
          },
          urgent: true,
          ttlSeconds: ttl,
        });
      } else {
        await sendFcm(n.userId, {
          data: { type: 'notice', title: n.title, body: n.body ?? '', tag: n.kind ?? n.event, rideId: n.rideId ?? '' },
          urgent: !!n.urgent,
          ttlSeconds: ttl,
        });
      }
    } else if (n.event === 'offer') {
      // Ombi limeisha muda, limeghairiwa au limepewa dereva mwingine → simu ya dereva inyamaze.
      await sendFcm(n.userId, { data: { type: 'offer_cancel', rideId: n.rideId ?? '' }, urgent: true, ttlSeconds: 300 });
    }
    if (n.sms && smsEnabled()) {
      const user = await one<{ phone: string }>(db, 'SELECT phone FROM naya.users WHERE id = $1', [n.userId]);
      if (user) await sendSms(user.phone, n.sms, n.kind ?? n.event);
    }
  } catch (error) {
    console.error(`[notify] ${(error as Error).message}`);
  }
}

/** Ofisi: kitu kimebadilika (safari, dereva) — dashboard na orodha zijisasishe. */
export async function notifyAdmins(rideId?: string | null): Promise<void> {
  await publish({ type: 'admin', admins: true, rideId: rideId ?? null });
}

export async function listNotifications(userId: string) {
  return many(
    db,
    `SELECT id, kind, title, body, ride_id AS "rideId", read_at AS "readAt", created_at AS "createdAt"
       FROM naya.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
}

export async function markNotificationsRead(userId: string) {
  await db.query('UPDATE naya.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}
