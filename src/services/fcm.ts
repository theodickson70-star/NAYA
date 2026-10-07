// Firebase Cloud Messaging (FCM) — arifa kwa app ya Android ya NAYA (APK).
// - Server inatuma "data messages" tu; app ya simu inaamua jinsi ya kulia:
//     type=offer        → kengele ya sekunde 30 (kama simu inayoingia), hata app ikiwa imefungwa
//     type=offer_cancel → simamisha kengele (ombi limeisha / limechukuliwa / limeghairiwa)
//     type=notice       → arifa ya kawaida
// - Inawashwa tu kama FIREBASE_SERVICE_ACCOUNT ipo. Funguo hiyo haitoki nje ya server wala kuandikwa kwenye logs.
// - Haitupi kosa kamwe: arifa ni ziada, si sehemu ya muamala.
import { createSign } from 'node:crypto';
import { env, type ServiceAccount } from '../config/env.js';
import { db, many } from '../db/pool.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TIMEOUT_MS = 10_000;

export interface FcmMessage {
  /** Thamani zote ni maandishi (sharti la FCM). */
  data: Record<string, string>;
  urgent: boolean;
  ttlSeconds: number;
}

export type FcmResult = { ok: true } | { ok: false; unregistered: boolean; error: string };
type Sender = (token: string, message: FcmMessage) => Promise<FcmResult>;

// ------------------------------------------------------------------ Google OAuth (JWT ya service account)

let cached: { token: string; expiresAt: number } | null = null;

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: sa.tokenUri, iat: now, exp: now + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.privateKey).toString('base64url');
  const res = await fetch(sa.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google OAuth ${res.status}: ${body.error ?? 'imeshindwa'}`);
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function googleSend(sa: ServiceAccount, token: string, message: FcmMessage): Promise<FcmResult> {
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/messages:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken(sa)}` },
      body: JSON.stringify({
        message: {
          token,
          data: message.data,
          android: { priority: message.urgent ? 'HIGH' : 'NORMAL', ttl: `${Math.max(0, Math.round(message.ttlSeconds))}s` },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) cached = null;
    const body = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? '';
    return {
      ok: false,
      // Simu imefuta app au token imebadilika → haifai tena.
      unregistered: res.status === 404 || code === 'UNREGISTERED',
      error: `FCM ${res.status} ${code}`.trim().slice(0, 200),
    };
  } catch (error) {
    return { ok: false, unregistered: false, error: `FCM haifikiki: ${(error as Error).message}`.slice(0, 200) };
  }
}

// ------------------------------------------------------------------ Kutuma

let testSender: Sender | null = null;
/** Tests tu: badala ya kutuma kwa Google halisi. */
export function setFcmSenderForTests(sender: Sender | null) {
  testSender = sender;
}

export const fcmEnabled = () => !!testSender || !!env.firebaseServiceAccount;

function sender(): Sender | null {
  if (testSender) return testSender;
  const sa = env.firebaseServiceAccount;
  return sa ? (token, message) => googleSend(sa, token, message) : null;
}

/** Tuma kwa simu zote (zenye app) za mtumiaji. Inarudisha idadi iliyofika. */
export async function sendFcm(userId: string, message: FcmMessage): Promise<number> {
  const send = sender();
  if (!send) return 0;
  try {
    const tokens = await many<{ token: string }>(db, 'SELECT token FROM naya.fcm_tokens WHERE user_id = $1', [userId]);
    let delivered = 0;
    await Promise.all(
      tokens.map(async ({ token }) => {
        const result = await send(token, message);
        if (result.ok) {
          delivered += 1;
          await db.query('UPDATE naya.fcm_tokens SET last_success_at = now(), failures = 0 WHERE token = $1', [token]);
        } else if (result.unregistered) {
          await db.query('DELETE FROM naya.fcm_tokens WHERE token = $1', [token]);
        } else {
          await db.query('UPDATE naya.fcm_tokens SET failures = failures + 1 WHERE token = $1', [token]);
          console.warn(`[fcm] ${result.error}`);
        }
      }),
    );
    return delivered;
  } catch (error) {
    console.error(`[fcm] ${(error as Error).message}`);
    return 0;
  }
}

// ------------------------------------------------------------------ Usajili wa simu

const FCM_TOKEN = /^[A-Za-z0-9_:\-.]{20,4096}$/;
export const isFcmToken = (token: string) => FCM_TOKEN.test(token);

/** Token ni ya simu moja; mtu mwingine akiingia kwenye simu hiyo, arifa zinahamia kwake. */
export async function saveFcmToken(userId: string, token: string, appVersion: string | undefined) {
  await db.query(
    `INSERT INTO naya.fcm_tokens (token, user_id, app_version)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, app_version = EXCLUDED.app_version, failures = 0, updated_at = now()`,
    [token, userId, appVersion?.slice(0, 30) ?? null],
  );
}

export async function removeFcmToken(userId: string, token: string) {
  await db.query('DELETE FROM naya.fcm_tokens WHERE user_id = $1 AND token = $2', [userId, token]);
}

/** Mtumiaji akitoka (logout inafuta vikao vyote), simu zake zisipokee tena arifa zake. */
export async function removeAllFcmTokens(userId: string) {
  await db.query('DELETE FROM naya.fcm_tokens WHERE user_id = $1', [userId]);
}

export async function fcmStats() {
  const row = await many<{ users: string; drivers: string }>(
    db,
    `SELECT count(DISTINCT t.user_id)::text AS users,
            count(DISTINCT d.user_id) FILTER (WHERE d.status = 'APPROVED')::text AS drivers
       FROM naya.fcm_tokens t LEFT JOIN naya.drivers d ON d.user_id = t.user_id`,
  );
  return { enabled: fcmEnabled(), users: Number(row[0]?.users ?? 0), drivers: Number(row[0]?.drivers ?? 0) };
}
