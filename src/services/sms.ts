// SMS kupitia Beem Africa (https://apisms.beem.africa).
// - Funguo (BEEM_API_KEY / BEEM_SECRET_KEY) zinakaa kwenye server tu; hazitumwi kwa app wala kuandikwa kwenye logs.
// - Kila SMS inaandikwa kwenye naya.sms_log (aina na matokeo tu — kamwe si maandishi, kwa sababu OTP ni siri).
// - Bila funguo, SMS zimezimwa: sendSms inarudisha false bila kosa.
import { phoneLang, tr } from './i18n.js';
import { env } from '../config/env.js';
import { db, one, transaction } from '../db/pool.js';
import { conflict } from '../utils/http.js';
import { writeAudit } from './audit.js';

const SEND_URL = `${env.beemBaseUrl}/v1/send`;
/** Namba ya ofisi ya NAYA kwenye SMS (mtu asiyeweza kuingia kwenye app ajue wa kumpigia). */
export const NAYA_OFFICE_PHONE = '0628 986 770';
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
export async function sendSms(phone: string, message: string, kind: string, opts: { campaignId?: string; raw?: boolean } = {}): Promise<boolean> {
  if (!smsEnabled()) return false;
  // raw: maandishi ya ofisi (Kituo cha SMS) yanatumwa kama yalivyoandikwa — hayatafsiriwi
  if (!opts.raw) message = tr(message, await phoneLang(phone).catch(() => 'sw' as const));
  const result = await (testSender ?? beemSend)(phone, toGsm(message));
  try {
    await db.query('INSERT INTO naya.sms_log (phone, kind, status, request_id, error, campaign_id) VALUES ($1, $2, $3, $4, $5, $6)', [
      phone,
      kind,
      result.ok ? 'SENT' : 'FAILED',
      result.requestId ?? null,
      result.error ?? null,
      opts.campaignId ?? null,
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

/**
 * 0.25.1: Ofisi inatuma SMS moja ya majaribio (baada ya kuweka funguo za Beem na Sender ID kwenye Railway).
 * Inarudisha jibu la Beem (limeandikwa kwenye sms_log) ili ofisi ione tatizo moja kwa moja: funguo, Sender ID au salio.
 */
export async function sendTestSms(adminId: string, phone: string) {
  if (!smsEnabled()) throw conflict('SMS hazijawashwa. Weka BEEM_API_KEY na BEEM_SECRET_KEY kwenye Railway → Variables.');
  const ok = await sendSms(phone, 'NAYA: Hii ni SMS ya majaribio kutoka ofisi ya NAYA. Mfumo wa SMS unafanya kazi.', 'admin_test');
  const last = await one<{ error: string | null }>(
    db,
    `SELECT error FROM naya.sms_log WHERE phone = $1 AND kind = 'admin_test' ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  await writeAudit(db, { actorId: adminId, action: 'sms.test', targetType: 'sms', targetId: null, details: { ok, senderId: env.beemSenderId } }).catch(() => {});
  return { ok, senderId: env.beemSenderId, error: ok ? null : last?.error ?? 'Beem haikukubali SMS' };
}

/**
 * 0.25.1: Mara ya KWANZA SMS zinapowashwa (funguo za Beem zimewekwa), watumiaji waliopo — waliojisajili wakati SMS
 * zimezimwa — wanahesabiwa kuwa wamethibitishwa, ili madereva na wateja wanaotumia NAYA sasa wasizuiwe ghafla
 * kuagiza wala kwenda online. Watumiaji wapya kuanzia hapo wanathibitisha namba kwa SMS kama kawaida.
 * Inafanyika mara moja tu (settings.sms_activation); haifuti data.
 */
export async function activateSmsOnce(log: (message: string) => void = () => {}): Promise<number | null> {
  if (!smsEnabled()) return null;
  return transaction(async (client) => {
    const first = await client.query(
      `INSERT INTO naya.settings (key, value) VALUES ('sms_activation', jsonb_build_object('at', now())) ON CONFLICT (key) DO NOTHING`,
    );
    if (first.rowCount === 0) return null; // ilishafanyika
    const res = await client.query(`UPDATE naya.users SET phone_verified_at = created_at WHERE phone_verified_at IS NULL`);
    const n = res.rowCount ?? 0;
    await client.query(`UPDATE naya.settings SET value = value || jsonb_build_object('existingUsers', $1::int) WHERE key = 'sms_activation'`, [n]);
    await writeAudit(client, { actorId: null, action: 'sms.activated', targetType: 'sms', targetId: null, details: { existingUsers: n, senderId: env.beemSenderId } });
    log(`[sms] SMS zimewashwa kwa mara ya kwanza: watumiaji ${n} waliopo hawataombwa kuthibitisha namba.`);
    return n;
  });
}
