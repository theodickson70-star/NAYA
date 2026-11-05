// SMS za NAYA — kampuni moja tu inatumika kwa wakati mmoja:
//   - RodSMS (0.28.0, chaguo-msingi): https://www.rodsms.com/api/v1 — RODSMS_API_KEY (rodsms_live_…) + SMS_SENDER_ID (NAYA).
//       POST /messages {sender_id, recipient 255…, message, sms_type} → {success, data:{id}} · GET /balance · GET /sender-ids
//       Makosa: {success:false, error:{code, message}} (unauthorized, insufficient_credits, sender_id_unusable, rate_limited …)
//   - Abliner (SMS_PROVIDER=abliner): https://abliner.net/api/v1/sms/send — ABLINER_API_KEY ya malipo.
//   - Beem Africa (ya zamani, SMS_PROVIDER=beem): BEEM_API_KEY / BEEM_SECRET_KEY / BEEM_SENDER_ID.
// - Funguo zinakaa kwenye server tu (Railway → Variables); hazitumwi kwa app wala kuandikwa kwenye logs.
// - Kila SMS inaandikwa kwenye naya.sms_log (aina na matokeo tu — kamwe si maandishi, kwa sababu OTP ni siri).
// - Bila kampuni iliyowekwa, SMS zimezimwa: sendSms inarudisha false bila kosa.
import { phoneLang, tr } from './i18n.js';
import { env } from '../config/env.js';
import { db, one, transaction } from '../db/pool.js';
import { conflict } from '../utils/http.js';
import { writeAudit } from './audit.js';

/** Namba ya ofisi ya NAYA kwenye SMS (mtu asiyeweza kuingia kwenye app ajue wa kumpigia). */
export const NAYA_OFFICE_PHONE = '0628 986 770';
const TIMEOUT_MS = 10_000;

export interface SmsResult {
  ok: boolean;
  requestId?: string;
  error?: string;
}
type Sender = (phone: string, message: string) => Promise<SmsResult>;

interface SmsProvider {
  name: 'rodsms' | 'abliner' | 'beem';
  label: string;
  senderId: string | null;
  send: Sender;
  balance: () => Promise<number | null>;
  /** Hali ya Sender ID kwenye akaunti ya kampuni: approved / pending / … (null = haijulikani). */
  senderStatus: () => Promise<string | null>;
}

const timeoutText = (error: unknown) => ((error as Error).name === 'TimeoutError' ? 'muda umeisha' : (error as Error).message);

// ------------------------------------------------------------------ RodSMS

const rodsmsKey = () => process.env.RODSMS_API_KEY?.trim() || '';
const rodsmsBase = () => (process.env.RODSMS_BASE_URL?.trim() || 'https://www.rodsms.com/api/v1').replace(/\/+$/, '');
/** Kikomo cha key ya RodSMS (maombi kwa dakika; chaguo-msingi 60 kama kwenye dashboard ya RodSMS). */
const rodsmsPerMinute = () => Math.max(1, Math.min(6000, Number(process.env.RODSMS_RATE_PER_MIN) || 60));

const RODSMS_ERRORS: Record<string, string> = {
  unauthorized: 'RodSMS imekataa API key (haipo, imefutwa au IP imezuiwa) — kagua RODSMS_API_KEY',
  insufficient_credits: 'Salio la SMS kwenye RodSMS limeisha — nunua SMS (Buy SMS)',
  sender_id_unusable: 'Sender ID haijaidhinishwa au haitumiki — kagua SMS_SENDER_ID na "My Sender IDs" kwenye RodSMS',
  insufficient_scope: 'API key haina ruhusa ya sms:send',
  rate_limited: 'Kikomo cha maombi kwa dakika kimefikiwa',
  invalid_request: 'RodSMS imekataa namba au ujumbe',
  validation_error: 'RodSMS imekataa ombi',
};

// Kasi: SMS zote (OTP, taarifa, Kituo cha SMS) zinapangwa zisizidi kikomo cha key kwa dakika.
let rodsmsNextAt = 0;
async function rodsmsSlot() {
  const gap = 60_000 / rodsmsPerMinute();
  const now = Date.now();
  const at = Math.max(now, rodsmsNextAt);
  rodsmsNextAt = at + gap;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

type RodBody = { success?: boolean; data?: unknown; error?: { code?: string; message?: string }; request_id?: string };

async function rodsmsFetch(method: string, path: string, payload?: unknown) {
  const res = await fetch(`${rodsmsBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${rodsmsKey()}`,
      accept: 'application/json',
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as RodBody;
  return { res, body };
}

async function rodsmsSend(phone: string, message: string): Promise<SmsResult> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await rodsmsSlot();
    try {
      const { res, body } = await rodsmsFetch('POST', '/messages', {
        sender_id: env.smsSenderId ?? 'NAYA',
        recipient: phone,
        message,
        sms_type: 'transactional',
      });
      if (res.ok && body.success) {
        const id = (body.data as { id?: unknown } | undefined)?.id ?? body.request_id;
        return { ok: true, requestId: id !== undefined && id !== null ? String(id).slice(0, 80) : undefined };
      }
      const code = body.error?.code ?? String(res.status);
      if ((res.status === 429 || code === 'rate_limited') && attempt < 3) {
        const wait = Math.min(10, Number(res.headers.get('retry-after')) || 2);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const hint = RODSMS_ERRORS[code];
      return { ok: false, error: `RodSMS ${res.status} (${code})${hint ? `: ${hint}` : ''}${body.error?.message ? ` — ${body.error.message}` : ''}`.slice(0, 200) };
    } catch (error) {
      return { ok: false, error: `RodSMS haifikiki: ${timeoutText(error)}`.slice(0, 200) };
    }
  }
  return { ok: false, error: 'RodSMS: kikomo cha maombi kwa dakika (429)' };
}

/** Salio la SMS: RodSMS inarudisha namba au kitu chenye salio — tunasoma sehemu ya kwanza yenye namba. */
function pickNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['sms_credits', 'credits', 'credit_balance', 'available_credits', 'balance', 'sms', 'available', 'remaining']) {
      const n = pickNumber(o[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

async function rodsmsBalance(): Promise<number | null> {
  try {
    const { res, body } = await rodsmsFetch('GET', '/balance');
    return res.ok && body.success !== false ? pickNumber(body.data) : null;
  } catch {
    return null;
  }
}

async function rodsmsSenderStatus(): Promise<string | null> {
  const mineId = (env.smsSenderId ?? 'NAYA').toUpperCase();
  try {
    const { res, body } = await rodsmsFetch('GET', '/sender-ids');
    if (!res.ok || body.success === false) return null;
    const list = Array.isArray(body.data) ? body.data : Array.isArray((body.data as { items?: unknown })?.items) ? (body.data as { items: unknown[] }).items : [];
    for (const x of list as unknown[]) {
      if (typeof x === 'string' && x.toUpperCase() === mineId) return 'approved';
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const id = String(o.sender_id ?? o.name ?? o.sender ?? '').toUpperCase();
        if (id === mineId) return typeof o.status === 'string' ? o.status.toLowerCase() : 'approved';
      }
    }
    return 'not_found';
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Abliner

function ablinerBase(): string {
  let base = (process.env.ABLINER_API_BASE_URL?.trim() || 'https://abliner.net').replace(/\/+$/, '');
  base = base.replace(/\/api\/v1$/, ''); // mtu akiweka ".../api/v1" kwenye variable
  return base;
}
const ablinerKey = () => process.env.ABLINER_API_KEY?.trim() || '';

async function ablinerFetch(path: string, init: RequestInit = {}) {
  return fetch(`${ablinerBase()}/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${ablinerKey()}`, 'content-type': 'application/json', accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

type AblinerBody = { status?: string; code?: string; message?: string; id?: string | number; data?: Record<string, unknown> | unknown[] };

function ablinerError(status: number, body: AblinerBody): string {
  if (status === 401 || status === 403) return `Abliner ${status}: funguo (ABLINER_API_KEY) zimekataliwa`;
  return `Abliner ${status}${body.code ? ` (${body.code})` : ''}: ${body.message ?? 'imeshindwa'}`.slice(0, 200);
}

async function ablinerSend(phone: string, message: string): Promise<SmsResult> {
  const payload = JSON.stringify({ recipient: phone, message, ...(env.smsSenderId ? { sender_id: env.smsSenderId } : {}) });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await ablinerFetch('/sms/send', { method: 'POST', body: payload });
      const body = (await res.json().catch(() => ({}))) as AblinerBody;
      if (res.ok && body.status !== 'error') {
        const data = (body.data && !Array.isArray(body.data) ? body.data : {}) as Record<string, unknown>;
        const id = data.id ?? data.message_id ?? data.reference ?? body.id;
        return { ok: true, requestId: id !== undefined && id !== null ? String(id).slice(0, 80) : undefined };
      }
      // Kikomo cha kasi (30 kwa sekunde): subiri kidogo kisha jaribu mara moja tena
      if (res.status === 429 && attempt === 1) {
        const wait = Math.min(5, Number(res.headers.get('retry-after')) || 1);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      return { ok: false, error: ablinerError(res.status, body) };
    } catch (error) {
      return { ok: false, error: `Abliner haifikiki: ${timeoutText(error)}`.slice(0, 200) };
    }
  }
  return { ok: false, error: 'Abliner: kikomo cha kasi (429)' };
}

async function ablinerBalance(): Promise<number | null> {
  try {
    const res = await ablinerFetch('/sms/balance');
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { sms_credits?: number } };
    return typeof body.data?.sms_credits === 'number' ? body.data.sms_credits : null;
  } catch {
    return null;
  }
}

async function ablinerSenderStatus(): Promise<string | null> {
  if (!env.smsSenderId) return null;
  try {
    const res = await ablinerFetch('/sms/sender-ids');
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    const list = (Array.isArray(body) ? body : Array.isArray((body as AblinerBody).data) ? (body as AblinerBody).data : []) as Array<{ sender_id?: string; status?: string }>;
    const mine = list.find((x) => x.sender_id?.toUpperCase() === env.smsSenderId!.toUpperCase());
    return mine?.status ?? 'not_found';
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Beem (ya zamani)

const beemAuth = () => `Basic ${Buffer.from(`${env.beemApiKey}:${env.beemSecretKey}`).toString('base64')}`;

async function beemSend(phone: string, message: string): Promise<SmsResult> {
  try {
    const res = await fetch(`${env.beemBaseUrl}/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: beemAuth() },
      body: JSON.stringify({
        source_addr: env.smsSenderId ?? env.beemSenderId,
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
    return { ok: false, error: `Beem haifikiki: ${timeoutText(error)}`.slice(0, 200) };
  }
}

async function beemBalance(): Promise<number | null> {
  try {
    const res = await fetch(`${env.beemBaseUrl}/public/v1/vendors/balance`, { headers: { authorization: beemAuth() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { credit_balance?: number } };
    return typeof body.data?.credit_balance === 'number' ? body.data.credit_balance : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ kuchagua kampuni

const RODSMS: SmsProvider = {
  name: 'rodsms',
  label: 'RodSMS',
  get senderId() {
    return env.smsSenderId ?? 'NAYA';
  },
  send: rodsmsSend,
  balance: rodsmsBalance,
  senderStatus: rodsmsSenderStatus,
};

const ABLINER: SmsProvider = {
  name: 'abliner',
  label: 'Abliner',
  get senderId() {
    return env.smsSenderId ?? null;
  },
  send: ablinerSend,
  balance: ablinerBalance,
  senderStatus: ablinerSenderStatus,
};
const BEEM: SmsProvider = {
  name: 'beem',
  label: 'Beem',
  get senderId() {
    return env.smsSenderId ?? env.beemSenderId;
  },
  send: beemSend,
  balance: beemBalance,
  senderStatus: async () => null,
};

/**
 * Kampuni ya SMS inayotumika sasa (null = SMS zimezimwa):
 *   SMS_PROVIDER=rodsms · abliner · beem · none.
 *   Bila SMS_PROVIDER: RodSMS kama RODSMS_API_KEY ipo; vinginevyo Beem kama funguo zake zipo.
 *   (Abliner inatumika tu ikichaguliwa wazi — vinginevyo SMS zingeweza kutoka kwa jina la "ABLINER" badala ya NAYA.)
 */
export function smsProvider(): SmsProvider | null {
  const beemReady = !!(env.beemApiKey && env.beemSecretKey);
  const ablinerReady = !!ablinerKey();
  const rodsmsReady = !!rodsmsKey();
  switch (env.smsProvider) {
    case 'rodsms':
      return rodsmsReady ? RODSMS : null;
    case 'abliner':
      return ablinerReady ? ABLINER : null;
    case 'beem':
      return beemReady ? BEEM : null;
    case null:
    case undefined:
    case '':
      if (rodsmsReady) return RODSMS;
      return beemReady ? BEEM : null;
    default:
      return null; // "none" au jina lisilojulikana
  }
}

/** Kwa nini SMS zimezimwa (kwa ofisi). null = zimewashwa. */
export function smsSetupHint(): string | null {
  if (testSender || smsProvider()) return null;
  if (env.smsProvider === 'none') return 'SMS zimezimwa kwa makusudi (SMS_PROVIDER=none).';
  if (env.smsProvider === 'rodsms') return 'SMS_PROVIDER=rodsms lakini RODSMS_API_KEY haipo kwenye Railway → Variables.';
  if (env.smsProvider === 'abliner') return 'SMS_PROVIDER=abliner lakini ABLINER_API_KEY haipo kwenye Railway → Variables.';
  if (env.smsProvider === 'beem') return 'SMS_PROVIDER=beem lakini BEEM_API_KEY / BEEM_SECRET_KEY hazipo.';
  if (env.smsProvider) return `SMS_PROVIDER="${env.smsProvider}" haijulikani — tumia rodsms.`;
  return 'Weka RODSMS_API_KEY na SMS_SENDER_ID=NAYA kwenye Railway → Variables.';
}

let testSender: Sender | null = null;
/** Tests tu: badala ya kutuma kwa kampuni halisi. */
export function setSmsSenderForTests(sender: Sender | null) {
  testSender = sender;
}

export const smsEnabled = () => !!testSender || !!smsProvider();
/** Jina la mtumaji linaloonyeshwa ofisini. */
export const smsSenderLabel = () => smsProvider()?.senderId ?? env.smsSenderId ?? (env.beemSenderId || null);

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

/** Tuma SMS moja. Inarudisha true kampuni ya SMS ikiipokea. Haitupi kosa kamwe. */
export async function sendSms(phone: string, message: string, kind: string, opts: { campaignId?: string; raw?: boolean } = {}): Promise<boolean> {
  if (!smsEnabled()) return false;
  // raw: maandishi ya ofisi (Kituo cha SMS) yanatumwa kama yalivyoandikwa — hayatafsiriwi
  if (!opts.raw) message = tr(message, await phoneLang(phone).catch(() => 'sw' as const));
  const provider = smsProvider();
  const send = testSender ?? provider?.send;
  if (!send) return false;
  const result = await send(phone, toGsm(message));
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

let balanceCache: { key: string; value: number | null; at: number } | null = null;

/** Salio la SMS kwenye akaunti ya kampuni ya SMS (kwa ofisi). null = haijulikani. Linahifadhiwa dakika 5. */
export async function smsBalance(): Promise<number | null> {
  const p = smsProvider();
  if (!p) return null;
  if (balanceCache && balanceCache.key === p.name && Date.now() - balanceCache.at < 5 * 60_000) return balanceCache.value;
  const value = await p.balance();
  balanceCache = { key: p.name, value, at: Date.now() };
  return value;
}

let senderCache: { value: string | null; at: number } | null = null;
async function senderStatus(): Promise<string | null> {
  const p = smsProvider();
  if (!p) return null;
  if (senderCache && Date.now() - senderCache.at < 10 * 60_000) return senderCache.value;
  const value = await p.senderStatus();
  senderCache = { value, at: Date.now() };
  return value;
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
  const provider = smsProvider();
  return {
    enabled: smsEnabled(),
    provider: provider?.name ?? null,
    providerLabel: provider?.label ?? null,
    senderId: smsSenderLabel(),
    senderStatus: await senderStatus(),
    setupHint: smsSetupHint(),
    balance,
    sentToday: stats?.sent_today ?? 0,
    failedToday: stats?.failed_today ?? 0,
    sentThisMonth: stats?.sent_month ?? 0,
    recent: recent.rows,
  };
}

/**
 * 0.25.1: Ofisi inatuma SMS moja ya majaribio (baada ya kuweka funguo za SMS na Sender ID kwenye Railway).
 * Inarudisha jibu la kampuni ya SMS (limeandikwa kwenye sms_log) ili ofisi ione tatizo moja kwa moja: funguo, Sender ID au salio.
 */
export async function sendTestSms(adminId: string, phone: string) {
  if (!smsEnabled()) throw conflict(`SMS hazijawashwa. ${smsSetupHint() ?? ''}`.trim());
  const ok = await sendSms(phone, 'NAYA: Hii ni SMS ya majaribio kutoka ofisi ya NAYA. Mfumo wa SMS unafanya kazi.', 'admin_test');
  const last = await one<{ error: string | null }>(
    db,
    `SELECT error FROM naya.sms_log WHERE phone = $1 AND kind = 'admin_test' ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  const provider = smsProvider();
  await writeAudit(db, { actorId: adminId, action: 'sms.test', targetType: 'sms', targetId: null, details: { ok, senderId: smsSenderLabel(), provider: provider?.name ?? null } }).catch(() => {});
  return { ok, senderId: smsSenderLabel(), provider: provider?.label ?? null, error: ok ? null : last?.error ?? 'Kampuni ya SMS haikukubali SMS' };
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
    await writeAudit(client, { actorId: null, action: 'sms.activated', targetType: 'sms', targetId: null, details: { existingUsers: n, senderId: smsSenderLabel() } });
    log(`[sms] SMS zimewashwa kwa mara ya kwanza: watumiaji ${n} waliopo hawataombwa kuthibitisha namba.`);
    return n;
  });
}
