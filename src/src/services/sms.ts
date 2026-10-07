// SMS kupitia Beem Africa (https://apisms.beem.africa).
// - Funguo (BEEM_API_KEY / BEEM_SECRET_KEY) zinakaa kwenye server tu; hazitumwi kwa app wala kuandikwa kwenye logs.
// - Kila SMS inaandikwa kwenye naya.sms_log (aina na matokeo tu — kamwe si maandishi, kwa sababu OTP ni siri).
// - Bila funguo, SMS zimezimwa: sendSms inarudisha false bila kosa.
import { env } from '../config/env.js';
import { db, one } from '../db/pool.js';

const SEND_URL = `${env.beemBaseUrl}/v1/send`;
const BALANCE_URL = `${env.beemBaseUrl}/public/v1/vendors/balance`;
const TIMEOUT_MS = 10_000;

export interface SmsResult {
  ok: boolean;
  requestId?: string;
  error?: string;
}
type Sender = (phone: string, message: string) => Promise<SmsResult>;

const authHeader = () => `Basic ${Buffer.from(`${env.beemApiKey}:${env.beemSecretKey}`).toString('base64')}`;

async function beemSend(phone: string, message: string): Promise<SmsResult> {
  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader() },
      body: JSON.stringify({
        source_addr: env.beemSenderId,
        encoding: 0,
        message,
        recipients: [{ recipient_id: 1, dest_addr: phone }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { successful?: boolean; code?: number; message?: string; request_id?: string | number };
    if (res.ok && body.successful !== false && (body.code === undefined || body.code === 100)) {
      return { ok: true, requestId: body.request_id !== undefined ? String(body.request_id) : undefined };
    }
    return { ok: false, error: `Beem ${res.status}${body.code ? ` (code ${body.code})` : ''}: ${body.message ?? 'imeshindwa'}`.slice(0, 200) };
  } catch (error) {
    return { ok: false, error: `Beem haifikiki: ${(error as Error).name === 'TimeoutError' ? 'muda umeisha' : (error as Error).message}`.slice(0, 200) };
  }
}

let testSender: Sender | null = null;
/** Tests tu: badala ya kutuma kwa Beem halisi. */
export function setSmsSenderForTests(sender: Sender | null) {
  testSender = sender;
}

export const smsEnabled = () => !!testSender || !!(env.beemApiKey && env.beemSecretKey);

/**
 * Herufi zisizo za GSM (mf. "—", "·", herufi za mapambo) zinafanya SMS iwe Unicode — fupi zaidi na ghali zaidi.
 * Tunazibadilisha kuwa herufi za kawaida kabla ya kutuma.
 */
export function toGsm(text: string): string {
  return text
    .replace(/[—–]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '');
}

/** Tuma SMS moja. Inarudisha true ikifika kwa Beem. Haitupi kosa kamwe. */
export async function sendSms(phone: string, message: string, kind: string): Promise<boolean> {
  if (!smsEnabled()) return false;
  const result = await (testSender ?? beemSend)(phone, toGsm(message));
  try {
    await db.query('INSERT INTO naya.sms_log (phone, kind, status, request_id, error) VALUES ($1, $2, $3, $4, $5)', [
      phone,
      kind,
      result.ok ? 'SENT' : 'FAILED',
      result.requestId ?? null,
      result.error ?? null,
    ]);
  } catch {
    // kumbukumbu ikishindwa, SMS bado imetumwa
  }
  if (!result.ok) console.error(`[sms] ${kind} haikutumwa: ${result.error}`);
  return result.ok;
}

let balanceCache: { value: number | null; at: number } | null = null;

/** Salio la SMS kwenye akaunti ya Beem (kwa ofisi). null = haijulikani. Linahifadhiwa dakika 5 (Beem isiulizwe kila sekunde). */
export async function smsBalance(): Promise<number | null> {
  if (!env.beemApiKey || !env.beemSecretKey) return null;
  if (balanceCache && Date.now() - balanceCache.at < 5 * 60_000) return balanceCache.value;
  const value = await fetchBalance();
  balanceCache = { value, at: Date.now() };
  return value;
}

async function fetchBalance(): Promise<number | null> {
  try {
    const res = await fetch(BALANCE_URL, { headers: { authorization: authHeader() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { credit_balance?: number } };
    return typeof body.data?.credit_balance === 'number' ? body.data.credit_balance : null;
  } catch {
    return null;
  }
}

export async function smsOverview() {
  const [stats, recent, balance] = await Promise.all([
    one<{ sent_today: number; failed_today: number; sent_month: number }>(
      db,
      `WITH t AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') AS day,
                         (date_trunc('month', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') AS month)
       SELECT count(*) FILTER (WHERE status = 'SENT' AND created_at >= t.day)::int AS sent_today,
              count(*) FILTER (WHERE status = 'FAILED' AND created_at >= t.day)::int AS failed_today,
              count(*) FILTER (WHERE status = 'SENT' AND created_at >= t.month)::int AS sent_month
         FROM naya.sms_log, t WHERE created_at >= t.month`,
    ),
    db.query(
      `SELECT phone, kind, status, error, created_at AS "createdAt" FROM naya.sms_log ORDER BY created_at DESC LIMIT 30`,
    ),
    smsBalance(),
  ]);
  return {
    enabled: smsEnabled(),
    senderId: env.beemSenderId,
    balance,
    sentToday: stats?.sent_today ?? 0,
    failedToday: stats?.failed_today ?? 0,
    sentThisMonth: stats?.sent_month ?? 0,
    recent: recent.rows,
  };
}
