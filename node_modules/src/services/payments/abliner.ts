// Abliner (https://abliner.net/docs) — kampuni ya malipo ya NAYA.
//
// Imethibitishwa kutoka kwenye nyaraka (hakuna endpoint iliyobuniwa):
//   Base URL     ABLINER_API_BASE_URL (chaguo-msingi https://abliner.net) + /api/v1/…
//   Auth         Authorization: Bearer <ABLINER_API_KEY>
//   Kukusanya    POST /api/v1/deposits   { amount, method: "mobile", currency: "TZS", phone, reference, callback_url? }
//                + Idempotency-Key + x-abliner-timestamp (sekunde) + x-abliner-signature (hex HMAC-SHA256 ya `${ts}.${body}`,
//                  kwa ABLINER_WEBHOOK_SECRET). Reference yetu inarudi kama `customer_reference`.
//   Kutuma       POST /api/v1/withdrawals { amount, method: "mobile", currency: "TZS", recipient, reference }
//   Hali         GET  /api/v1/transactions?customer_reference=…  (au ?id=…) → { status, data: [...] }
//   Salio        GET  /api/v1/balance (kwa "Kagua muunganiko" ya ofisi — haigusi pesa)
//   Webhook      x-webhook-signature = hex HMAC-SHA256 ya `${x-webhook-timestamp}.${rawBody}` (ABLINER_WEBHOOK_SECRET),
//                timestamp > sekunde 300 → kataa; x-webhook-id ni ileile kwenye kujaribu tena (kwa kuzuia marudio).
//                Events: transaction.completed | transaction.failed | withdrawal.completed | withdrawal.failed
//   Hali         pending | completed | failed
//
// Mapengo ya nyaraka na jinsi NAYA inavyojilinda:
//   - Withdrawals hazina Idempotency-Key iliyoandikwa wala mfano wa jibu → NAYA HAIRUDII kutuma yenyewe. Jibu likipotea
//     (mtandao/5xx), muamala unabaki "unasubiri uthibitisho" na worker inauliza hali kwa reference yetu.
//   - Hali nyingine yoyote isiyo "completed"/"failed" inachukuliwa kama "bado" (PENDING) — kamwe si mafanikio.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { FeeMode, PaymentProvider, PaymentRequest, ProviderResult, ProviderStatus, WebhookResult } from './provider.js';

const DEFAULT_BASE = 'https://abliner.net';
const TIMEOUT_MS = 20_000;
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const ABLINER_MIN_AMOUNT = 500;
export const ABLINER_MAX_AMOUNT = 3_000_000;

export interface AblinerConfig {
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
}

/** Funguo zinasomwa kutoka mazingira (Railway → Variables) TU, wakati wa kutumika. null = hazijawekwa. */
export function ablinerConfig(): AblinerConfig | null {
  const apiKey = process.env.ABLINER_API_KEY?.trim();
  const webhookSecret = process.env.ABLINER_WEBHOOK_SECRET?.trim();
  if (!apiKey || !webhookSecret) return null;
  let baseUrl = (process.env.ABLINER_API_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
  // Mtu akiweka ".../api/v1" kwenye variable, tusiiongeze mara mbili.
  baseUrl = baseUrl.replace(/\/api\/v1$/, '');
  return { apiKey, webhookSecret, baseUrl };
}

/** URL ya webhook ya NAYA (Railway inaweka RAILWAY_PUBLIC_DOMAIN yenyewe). null = tumia ile ya Dashboard ya Abliner. */
export function ablinerCallbackUrl(): string | null {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return domain ? `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/api/payments/callback/abliner` : null;
}

export const sign = (secret: string, timestamp: string, body: string) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** Kosa la Abliner lenye HTTP status — `definite` = tunajua hakika ombi halikufanyika (4xx isiyo 408/409/429). */
export class AblinerError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string | null,
  ) {
    super(message);
  }
  get definite() {
    return this.httpStatus >= 400 && this.httpStatus < 500 && ![408, 409, 429].includes(this.httpStatus);
  }
}

type Json = Record<string, unknown>;

async function call(cfg: AblinerConfig, method: 'GET' | 'POST', path: string, opts: { body?: Json; headers?: Record<string, string> } = {}) {
  const bodyText = opts.body ? JSON.stringify(opts.body) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        accept: 'application/json',
        ...(bodyText ? { 'content-type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      body: bodyText,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const code = typeof json.code === 'string' ? json.code : null;
    throw new AblinerError(`Abliner ${res.status}${code ? ` ${code}` : ''}`, res.status, code);
  }
  return json;
}

/** Ujumbe unaoeleweka kwa dereva / ofisi kwa makosa yaliyoandikwa kwenye nyaraka. */
function friendly(error: AblinerError, direction: 'IN' | 'OUT') {
  switch (error.code) {
    case 'invalid_phone':
      return 'Namba ya simu si sahihi au haina akaunti ya pesa ya simu.';
    case 'amount_out_of_range':
      return direction === 'IN'
        ? `Kiasi hakiruhusiwi (TSh ${ABLINER_MIN_AMOUNT.toLocaleString('en-US')} hadi ${ABLINER_MAX_AMOUNT.toLocaleString('en-US')}).`
        : 'Kiasi ni kidogo mno kutuma kwa Abliner — kitatumwa pamoja na malipo yajayo ya dereva huyu.';
    case 'insufficient_funds':
      return 'Salio la NAYA kwenye Abliner halitoshi kutuma pesa. Ofisi ijaze salio kisha ijaribu tena.';
    case 'unauthorized':
    case 'invalid_request_signature':
      return 'Kampuni ya malipo imekataa funguo za NAYA. Ofisi ikague ABLINER_API_KEY / ABLINER_WEBHOOK_SECRET.';
    case 'webhook_secret_required':
      return 'Webhook Signing Secret haijatengenezwa kwenye Abliner.';
    case 'validation_failed':
      return 'Kampuni ya malipo imekataa taarifa za muamala (validation_failed).';
    default:
      if (error.httpStatus === 403) return 'Akaunti ya Abliner imefungwa au bado inasubiri uthibitisho wa biashara.';
      return direction === 'IN' ? 'Ombi la kulipa limekataliwa na kampuni ya malipo.' : 'Kutuma pesa kumekataliwa na kampuni ya malipo.';
  }
}

/** Hali ya Abliner → yetu. Kitu chochote kisichojulikana = PENDING (kamwe si SUCCESS). */
export function mapStatus(status: unknown): ProviderStatus {
  const s = String(status ?? '').toLowerCase();
  if (s === 'completed') return 'SUCCESS';
  if (s === 'failed') return 'FAILED';
  return 'PENDING';
}

/** Abliner inafunga majibu ndani ya `data` ({ status: "success", data: {...} }) — tunakubali yote mawili. */
export const unwrap = (json: Json): Json => (json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? (json.data as Json) : json);

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);

/** Kumbukumbu ya kuonyesha: ya mtandao (mf. muamala wa M-Pesa) kama ipo, vinginevyo id ya Abliner. */
const receipt = (o: Json) => str(o.provider_reference) ?? str(o.id);

function requireConfig() {
  const cfg = ablinerConfig();
  if (!cfg) throw new Error('ABLINER_API_KEY / ABLINER_WEBHOOK_SECRET hazijawekwa');
  return cfg;
}

/** Muamala wetu kwenye /transactions (kwa reference yetu, au id ya Abliner). */
async function findTransaction(cfg: AblinerConfig, reference: string, providerRef?: string | null): Promise<Json | null> {
  const pick = (json: Json) => {
    const list = Array.isArray(json.data) ? (json.data as Json[]) : [];
    return list.find((t) => t.customer_reference === reference) ?? null;
  };
  const byRef = pick(await call(cfg, 'GET', `/api/v1/transactions?customer_reference=${encodeURIComponent(reference)}`));
  if (byRef || !providerRef) return byRef;
  const json = await call(cfg, 'GET', `/api/v1/transactions?id=${encodeURIComponent(providerRef)}`);
  const list = Array.isArray(json.data) ? (json.data as Json[]) : [];
  return list.find((t) => t.id === providerRef && (t.customer_reference == null || t.customer_reference === reference)) ?? null;
}

export const abliner: PaymentProvider = {
  name: 'abliner',
  canDisburse: true,

  async collect(req: PaymentRequest): Promise<ProviderResult> {
    const cfg = requireConfig();
    if (req.amount < ABLINER_MIN_AMOUNT || req.amount > ABLINER_MAX_AMOUNT) {
      return { status: 'FAILED', message: `Kiasi hakiruhusiwi na kampuni ya malipo (TSh ${ABLINER_MIN_AMOUNT} hadi ${ABLINER_MAX_AMOUNT.toLocaleString('en-US')}).` };
    }
    const callback = ablinerCallbackUrl();
    const body = { amount: req.amount, method: 'mobile', currency: 'TZS', phone: req.phone, reference: req.reference, ...(callback ? { callback_url: callback } : {}) };
    const bodyText = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    try {
      // Mwili uleule uliosainiwa ndio unaotumwa (call() inaufanya JSON.stringify kwa mpangilio uleule).
      const json = await call(cfg, 'POST', '/api/v1/deposits', {
        body,
        headers: { 'idempotency-key': req.reference, 'x-abliner-timestamp': ts, 'x-abliner-signature': sign(cfg.webhookSecret, ts, bodyText) },
      });
      const data = unwrap(json);
      return { status: mapStatus(data.status), providerRef: str(data.id), message: mapStatus(data.status) === 'FAILED' ? str(data.message) : null };
    } catch (error) {
      if (error instanceof AblinerError && error.definite) return { status: 'FAILED', message: friendly(error, 'IN') };
      // Mtandao / 5xx / 409 request_in_progress: hatujui kama push imetumwa → PENDING; worker inauliza hali kwa reference yetu.
      console.error(`[abliner] deposit ${req.reference}: ${(error as Error).message}`);
      return { status: 'PENDING' };
    }
  },

  async disburse(req: PaymentRequest): Promise<ProviderResult> {
    const cfg = requireConfig();
    if (req.amount < 1 || req.amount > ABLINER_MAX_AMOUNT) return { status: 'FAILED', message: 'Kiasi cha kutuma si sahihi.' };
    try {
      const json = await call(cfg, 'POST', '/api/v1/withdrawals', {
        body: { amount: req.amount, method: 'mobile', currency: 'TZS', recipient: req.phone, reference: req.reference },
      });
      const data = unwrap(json);
      return { status: mapStatus(data.status), providerRef: str(data.id), message: mapStatus(data.status) === 'FAILED' ? str(data.message) : null };
    } catch (error) {
      if (error instanceof AblinerError && error.definite) return { status: 'FAILED', message: friendly(error, 'OUT') };
      // HATUJUI kama pesa imetoka — hakuna kurudia kiotomatiki. Muamala unabaki PENDING; worker inauliza hali.
      throw error;
    }
  },

  /**
   * GET /api/v1/withdrawals/preview?method=mobile&amount=… → { amount_tzs, fee_tzs, total_debited_tzs } (nyaraka).
   * 'on_top': ada inakatwa kwenye salio letu → tunatuma `net`. 'deducted': ada inakatwa kwa mpokeaji → tunaongeza mpaka
   * mpokeaji apate `net` kamili (hatua 3 za preview; preview ikishindwa → makadirio ya 4%, kiwango cha juu cha Abliner).
   */
  async quoteDisbursement(net: number, feeMode: FeeMode) {
    const cfg = requireConfig();
    const preview = async (amount: number) => {
      const d = unwrap(await call(cfg, 'GET', `/api/v1/withdrawals/preview?method=mobile&amount=${amount}`));
      const fee = Number(d.fee_tzs);
      if (!Number.isFinite(fee) || fee < 0) throw new Error('preview haina fee_tzs');
      return fee;
    };
    try {
      if (feeMode === 'on_top') return { send: net, fee: await preview(net), source: 'preview' as const };
      let send = net;
      let fee = 0;
      for (let i = 0; i < 3; i += 1) {
        fee = Math.ceil(await preview(send));
        if (send - fee >= net) break;
        send = net + fee;
      }
      if (send - fee < net) send = net + fee; // hatua ya mwisho: kila mara mpokeaji apate angalau net
      return { send, fee: send - net, source: 'preview' as const };
    } catch (error) {
      console.error(`[abliner] preview: ${(error as Error).message}`);
      if (feeMode === 'on_top') return { send: net, fee: 0, source: 'estimate' as const };
      const send = Math.ceil(net / 0.96);
      return { send, fee: send - net, source: 'estimate' as const };
    }
  },

  async status(reference: string, _direction: 'IN' | 'OUT', providerRef?: string | null): Promise<ProviderResult> {
    const cfg = requireConfig();
    const tx = await findTransaction(cfg, reference, providerRef);
    if (!tx) return { status: 'PENDING' };
    const status = mapStatus(tx.status);
    return { status, providerRef: receipt(tx), message: status === 'FAILED' ? (str(tx.message) ?? 'Muamala umeshindwa kwa mujibu wa kampuni ya malipo.') : null };
  },

  async parseCallback(request: FastifyRequest): Promise<WebhookResult> {
    const cfg = requireConfig();
    const raw = (request as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof raw !== 'string') throw new Error('hakuna raw body');
    const header = (name: string) => {
      const v = request.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const signature = header('x-webhook-signature') ?? '';
    const timestamp = header('x-webhook-timestamp') ?? '';
    if (!/^\d{1,12}$/.test(timestamp)) throw new Error('timestamp haipo');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) throw new Error('timestamp imepitwa na muda');
    const expected = Buffer.from(sign(cfg.webhookSecret, timestamp, raw), 'hex');
    const given = /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('saini si sahihi');

    const payload = JSON.parse(raw) as Json;
    const event = String(payload.event ?? '');
    const data = (payload.data && typeof payload.data === 'object' ? payload.data : {}) as Json;
    const eventId = str(header('x-webhook-id')) ?? str(payload.id);
    const reference = str(data.customer_reference);
    const known = ['transaction.completed', 'transaction.failed', 'withdrawal.completed', 'withdrawal.failed'];
    if (!known.includes(event) || !reference) return { ignore: true, eventId, event };
    // Tukio linaamua; data.status ikipingana na tukio → tusiamini (bado PENDING, worker itauliza).
    const byEvent: ProviderStatus = event.endsWith('.completed') ? 'SUCCESS' : 'FAILED';
    const byData = data.status === undefined ? byEvent : mapStatus(data.status);
    const status: ProviderStatus = byData === byEvent ? byEvent : 'PENDING';
    return {
      reference,
      status,
      amount: typeof data.amount === 'number' ? data.amount : Number.isFinite(Number(data.amount)) && data.amount !== null && data.amount !== undefined ? Number(data.amount) : null,
      providerRef: receipt(data),
      message: status === 'FAILED' ? (str(data.message) ?? (event.startsWith('withdrawal') ? 'Kutuma pesa kumeshindwa.' : 'Malipo hayakukamilika — mteja amekataa au hakuingiza PIN.')) : null,
      eventId,
      event,
    };
  },
};

/** Ofisi: "Kagua muunganiko" — GET /api/v1/balance (haigusi pesa). */
export async function ablinerBalance() {
  const cfg = ablinerConfig();
  if (!cfg) return { ok: false as const, message: 'ABLINER_API_KEY na ABLINER_WEBHOOK_SECRET hazijawekwa kwenye Railway → Variables.' };
  try {
    const json = await call(cfg, 'GET', '/api/v1/balance');
    // Nyaraka: { status: "success", data: { balance, currency: "TZS", balances: { TZS, USD, KES, UGX } } }
    const data = unwrap(json);
    const tzs = data.balances && typeof data.balances === 'object' ? (data.balances as Json).TZS : undefined;
    const raw = data.balance ?? tzs;
    const balance = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(balance)) return { ok: false as const, message: 'Abliner ilijibu bila salio linalosomeka.', httpStatus: null };
    return { ok: true as const, balance, currency: str(data.currency) ?? 'TZS' };
  } catch (error) {
    const message = error instanceof AblinerError ? friendly(error, 'OUT') : 'Abliner haikupatikana (mtandao).';
    return { ok: false as const, message, httpStatus: error instanceof AblinerError ? error.httpStatus : null };
  }
}
