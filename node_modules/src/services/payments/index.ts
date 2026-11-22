// Malipo ya simu (0.16.0):
//   1. Ada ya mwezi: dereva → NAYA (USSD push; dereva anaingiza PIN kwenye simu yake). Ikithibitishwa, siku zinaongezwa zenyewe.
//   2. Malipo ya ofa ya moja kwa moja: NAYA → dereva, safari ya ofa ikikamilika — kama safari ni safi na ndani ya kikomo cha siku.
//      Isiyotimiza vigezo → "inasubiri ukaguzi" (HELD); ofisi inaruhusu (inatumwa yenyewe) au inakataa.
//
// Usalama wa pesa:
//  - Muamala unaandikwa SUCCESS tu kampuni ya malipo ikithibitisha (callback iliyothibitishwa au swali la hali).
//  - Kila hatua ni idempotent: callback ikija mara mbili, au worker na callback vikigongana, pesa haiongezwi mara mbili
//    (row lock + status PENDING tu ndiyo inabadilishwa + unique index payment_id kwenye ada / malipo ya ofa).
//  - Malipo ya kutoka (OUT) hayaandikwi "yameshindwa" kwa kukosa jibu — yanabaki "yanasubiri uthibitisho" mpaka kampuni ijibu.
import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { type Db, db, many, one, transaction } from '../../db/pool.js';
import { AppError, conflict, isUniqueViolation, notFound } from '../../utils/http.js';
import { writeAudit } from '../audit.js';
import { notify, notifyAdmins } from '../notify.js';
import { NETWORK_LABEL, type Network, promoBalance } from '../promotions.js';
import { creditSubscription, getSettings, subscriptionPaidMessage, type PaymentMethod } from '../subscriptions.js';
import { ablinerBalance, ablinerCallbackUrl } from './abliner.js';
import { type FeeMode, getProvider, guessNetwork, MOBILE_NETWORKS, type MobileNetwork, providerProblem, type ProviderResult } from './provider.js';

const TZ = 'Africa/Dar_es_Salaam';
const IN_TIMEOUT_MINUTES = 15; // ombi la kulipa lisilojibiwa → limeshindwa (likija baadaye SUCCESS bado linakubaliwa)
const TIMEOUT_REASON = 'Muda wa kuthibitisha umeisha — hukuingiza PIN au mtandao haukujibu.';

type Kind = 'SUBSCRIPTION' | 'PROMO_PAYOUT';
type Status = 'PENDING' | 'SUCCESS' | 'FAILED';

interface PaymentRow {
  id: string;
  kind: Kind;
  direction: 'IN' | 'OUT';
  user_id: string;
  amount: number;
  network: MobileNetwork;
  phone: string;
  provider: string;
  reference: string;
  provider_ref: string | null;
  status: Status;
  failure_reason: string | null;
  meta: { months?: number; rideIds?: string[]; sendAmount?: number; fee?: number; feeSource?: string };
  attempt: number;
  created_at: Date;
  completed_at: Date | null;
}

const METHOD: Record<MobileNetwork, PaymentMethod> = { MPESA: 'MPESA', MIXX: 'TIGO', AIRTEL: 'AIRTEL', HALOPESA: 'HALOPESA' };
const phoneText = (p: string) => (p.length === 12 && p.startsWith('255') ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);
const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;
const newReference = (kind: Kind) => `NY${kind === 'SUBSCRIPTION' ? 'A' : 'O'}${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;

function view(p: PaymentRow) {
  return {
    id: p.id,
    kind: p.kind,
    direction: p.direction,
    amount: p.amount,
    network: p.network,
    networkLabel: NETWORK_LABEL[p.network as Network] ?? p.network,
    phone: p.phone,
    reference: p.reference,
    providerRef: p.provider_ref,
    status: p.status,
    failureReason: p.failure_reason,
    months: p.meta?.months ?? null,
    fee: p.meta?.fee ?? null, // ada ya kutuma ambayo NAYA imebeba (malipo ya kutoka)
    sendAmount: p.meta?.sendAmount ?? null,
    createdAt: p.created_at,
    completedAt: p.completed_at,
  };
}

// ------------------------------------------------------------------ mipangilio

export interface AutoPayoutSettings {
  enabled: boolean;
  dailyLimit: number;
  /** Deni la dereva chini ya hiki halitumwi peke yake — linakusanywa (Abliner haikubali kiasi kidogo). */
  minPayout: number;
  /** Ada ya kutuma: 'deducted' = inakatwa kwa mpokeaji (NAYA inaongeza ili dereva apate kamili); 'on_top' = kwenye salio letu. */
  feeMode: FeeMode;
}

export async function getAutoPayout(client: Db = db): Promise<AutoPayoutSettings> {
  const row = await one<{ value: Partial<AutoPayoutSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'auto_payout'`);
  return { enabled: true, dailyLimit: 10000, minPayout: 1000, feeMode: 'deducted', ...(row?.value ?? {}) };
}

export async function saveAutoPayout(adminId: string, partial: Partial<AutoPayoutSettings>) {
  await transaction(async (client) => {
    const before = await getAutoPayout(client);
    const input: AutoPayoutSettings = { ...before, ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)) };
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('auto_payout', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(input), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.auto_payout', targetType: 'settings', targetId: null, details: { before, after: input } });
  });
  return paymentsOverview();
}

/** Kwa app na ofisi: malipo ya simu yamewashwa? */
export function paymentsConfig() {
  const provider = getProvider();
  return {
    enabled: !!provider,
    canDisburse: !!provider?.canDisburse,
    provider: provider?.name ?? null,
    networks: MOBILE_NETWORKS.map((n) => ({ code: n, label: NETWORK_LABEL[n as Network] })),
  };
}

// ------------------------------------------------------------------ 1. ada ya mwezi kwa simu

export async function startSubscriptionPayment(driverId: string, input: { months: number; network: MobileNetwork; phone: string }) {
  const provider = getProvider();
  if (!provider) throw conflict('Malipo kwa simu bado hayajawashwa. Lipa ofisini kwa NAYA.');
  const driver = await one<{ status: string }>(db, 'SELECT status FROM naya.drivers WHERE user_id = $1', [driverId]);
  if (!driver) throw notFound('Bado hujaomba kuwa dereva.');
  if (!['APPROVED', 'SUSPENDED'].includes(driver.status)) throw conflict('Ada inalipwa baada ya ofisi kukuthibitisha kuwa dereva.');
  const waiting = await one(
    db,
    `SELECT 1 FROM naya.payments WHERE user_id = $1 AND kind = 'SUBSCRIPTION' AND status = 'PENDING' AND created_at > now() - interval '2 minutes'`,
    [driverId],
  );
  if (waiting) throw conflict('Una ombi la kulipa linalosubiri. Angalia simu yako na uingize PIN, au subiri dakika 2 ujaribu tena.');
  const settings = await getSettings();
  const amount = settings.monthlyFee * input.months;
  if (amount <= 0) throw conflict('Ada ya mwezi haijawekwa. Wasiliana na ofisi ya NAYA.');
  const payment = await insertPayment(db, {
    kind: 'SUBSCRIPTION',
    direction: 'IN',
    userId: driverId,
    amount,
    network: input.network,
    phone: input.phone,
    provider: provider.name,
    meta: { months: input.months },
  });
  let result: ProviderResult;
  try {
    result = await provider.collect({ reference: payment.reference, amount, phone: input.phone, network: input.network, description: `NAYA ada ya miezi ${input.months}` });
  } catch (error) {
    console.error(`[payments] collect ${payment.reference}: ${(error as Error).message}`);
    result = { status: 'FAILED', message: 'Kampuni ya malipo haikupatikana. Jaribu tena baada ya muda mfupi.' };
  }
  await applyResult(payment.reference, result);
  return myPayment(driverId, payment.id);
}

/** Ombi la ada linalosubiri PIN (dakika 15 zilizopita) — app inaendelea kulisubiri ikifunguliwa upya. */
export async function pendingSubscriptionPayment(driverId: string) {
  const p = await one<PaymentRow>(
    db,
    `SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'SUBSCRIPTION' AND status = 'PENDING'
        AND created_at > now() - make_interval(mins => $2::int) ORDER BY created_at DESC LIMIT 1`,
    [driverId, IN_TIMEOUT_MINUTES],
  );
  return p ? view(p) : null;
}

async function insertPayment(
  client: Db,
  p: { kind: Kind; direction: 'IN' | 'OUT'; userId: string; amount: number; network: MobileNetwork; phone: string; provider: string; meta: object; attempt?: number; createdBy?: string | null },
) {
  const row = await one<PaymentRow>(
    client,
    `INSERT INTO naya.payments (kind, direction, user_id, amount, network, phone, provider, reference, meta, attempt, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [p.kind, p.direction, p.userId, p.amount, p.network, p.phone, p.provider, newReference(p.kind), JSON.stringify(p.meta), p.attempt ?? 1, p.createdBy ?? null],
  );
  return row!;
}

/** Mtumiaji anaangalia muamala wake (app inauliza kila sekunde chache mpaka ukamilike). */
export async function myPayment(userId: string, id: string) {
  let p = await one<PaymentRow>(db, 'SELECT * FROM naya.payments WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!p) throw notFound('Malipo hayakupatikana');
  if (p.status === 'PENDING' && Date.now() - new Date(p.created_at).getTime() > 20_000) {
    await refresh(p);
    p = (await one<PaymentRow>(db, 'SELECT * FROM naya.payments WHERE id = $1', [id]))!;
  }
  return view(p);
}

async function refresh(p: PaymentRow) {
  const provider = getProvider();
  if (!provider || provider.name !== p.provider) return;
  try {
    const r = await provider.status(p.reference, p.direction, p.provider_ref);
    if (r.status !== 'PENDING') return applyResult(p.reference, r);
  } catch (error) {
    console.error(`[payments] status ${p.reference}: ${(error as Error).message}`);
  }
  if (p.direction === 'IN' && Date.now() - new Date(p.created_at).getTime() > IN_TIMEOUT_MINUTES * 60_000) {
    await applyResult(p.reference, { status: 'FAILED', message: TIMEOUT_REASON });
  }
}

// ------------------------------------------------------------------ matokeo (callback / swali la hali / jibu la papo hapo)

/**
 * Hali mpya ya muamala. Inabadilisha PENDING tu (idempotent). Kuna ruhusa moja ya pekee: ombi la kulipa (IN) lililoandikwa
 * "limeshindwa" kwa kuisha muda, likithibitishwa baadaye kuwa limelipwa — linakubaliwa (pesa ya mteja haipotei).
 */
export async function applyResult(reference: string, result: ProviderResult) {
  if (result.status === 'PENDING') {
    if (result.providerRef) await db.query('UPDATE naya.payments SET provider_ref = coalesce(provider_ref, $2), updated_at = now() WHERE reference = $1', [reference, result.providerRef]);
    return;
  }
  type After = { kind: 'sub'; driverId: string; amount: number; paidUntil: Date } | { kind: 'payout'; p: PaymentRow } | { kind: 'payout_failed'; p: PaymentRow } | null;
  let after: After = null;
  try {
    after = await transaction(async (client): Promise<After> => {
      const p = await one<PaymentRow>(client, 'SELECT * FROM naya.payments WHERE reference = $1 FOR UPDATE', [reference]);
      if (!p) throw notFound('Muamala haukupatikana');
      const lateSuccess = p.status === 'FAILED' && p.direction === 'IN' && result.status === 'SUCCESS' && p.failure_reason === TIMEOUT_REASON;
      if (p.status !== 'PENDING' && !lateSuccess) return null;
      await client.query(
        `UPDATE naya.payments SET status = $2, provider_ref = coalesce($3, provider_ref), failure_reason = $4,
                completed_at = now(), updated_at = now() WHERE id = $1`,
        [p.id, result.status, result.providerRef ?? null, result.status === 'FAILED' ? (result.message ?? 'Malipo yameshindwa.').slice(0, 300) : null],
      );
      const providerRef = result.providerRef ?? p.provider_ref;
      if (p.kind === 'SUBSCRIPTION' && result.status === 'SUCCESS') {
        const r = await creditSubscription(client, p.user_id, {
          months: p.meta.months ?? 1,
          method: METHOD[p.network] ?? 'MPESA',
          reference: (providerRef ?? p.reference).slice(0, 40),
          note: `Kwa simu (${NETWORK_LABEL[p.network as Network] ?? p.network} ${phoneText(p.phone)})`,
          recordedBy: null,
          amount: p.amount,
          paymentId: p.id,
        });
        return { kind: 'sub', driverId: p.user_id, amount: r.amount, paidUntil: r.paidUntil };
      }
      if (p.kind === 'PROMO_PAYOUT') {
        const rideIds = p.meta.rideIds ?? [];
        if (result.status === 'SUCCESS') {
          await client.query(
            `INSERT INTO naya.promo_payouts (driver_id, amount, network, phone, reference, note, paid_by, payment_id)
             VALUES ($1, $2, $3, $4, $5, 'Malipo ya moja kwa moja', NULL, $6)`,
            [p.user_id, p.amount, p.network, p.phone, (providerRef ?? p.reference).slice(0, 60), p.id],
          );
          await client.query(`UPDATE naya.rides SET promo_payout_state = 'PAID', promo_payout_note = NULL WHERE id = ANY($1::uuid[])`, [rideIds]);
          return { kind: 'payout', p };
        }
        await client.query(
          `UPDATE naya.rides SET promo_payout_state = 'FAILED', promo_payout_note = $2 WHERE id = ANY($1::uuid[]) AND promo_payment_id = $3`,
          [rideIds, (result.message ?? 'Kutuma kumeshindwa.').slice(0, 200), p.id],
        );
        return { kind: 'payout_failed', p };
      }
      return null;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return; // callback mbili kwa wakati mmoja — moja tayari imeingiza
    throw error;
  }
  if (after?.kind === 'sub') {
    const body = subscriptionPaidMessage(after.amount, after.paidUntil);
    await notify({ userId: after.driverId, event: 'account', kind: 'subscription_paid', title: 'Ada imepokelewa — asante!', body, sms: `NAYA: ${body}` });
    await notifyAdmins();
  } else if (after?.kind === 'payout') {
    const p = after.p;
    const body = `NAYA imekutumia ${tsh(p.amount)} kwenye ${NETWORK_LABEL[p.network as Network] ?? p.network} ${phoneText(p.phone)} (malipo ya safari ya ofa).${
      result.providerRef ? ` Kumbukumbu: ${result.providerRef}.` : ''
    }`;
    await notify({ userId: p.user_id, event: 'driver', kind: 'promo_payout', title: 'Umelipwa na NAYA', body, sms: body });
    await notifyAdmins();
  } else if (after?.kind === 'payout_failed') {
    await notifyAdmins();
  }
}

const WEBHOOK_BUDGET_MS = 6000; // Abliner inataka 2xx ndani ya sekunde 8

async function recordWebhook(provider: string, eventId: string | null | undefined, row: { event?: string; reference?: string | null; status?: string | null; outcome: string }) {
  if (!eventId) return;
  await db.query(
    `INSERT INTO naya.payment_webhook_events (provider, event_id, event, reference, status, outcome) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [provider, eventId.slice(0, 100), row.event?.slice(0, 40) ?? null, row.reference?.slice(0, 40) ?? null, row.status ?? null, row.outcome],
  );
}

/**
 * Callback ya kampuni ya malipo. Adapter inathibitisha saini (si sahihi → 401, hakuna kinachobadilika).
 * Tukio lililokwisha chakatwa (x-webhook-id) → 200 bila kurudia. Muamala usio wetu → 200 (ili kampuni isijaribu tena bure).
 */
export async function handleCallback(providerName: string, request: FastifyRequest) {
  const provider = getProvider();
  if (!provider || provider.name !== providerName) throw notFound('Haipatikani');
  let result;
  try {
    result = await provider.parseCallback(request);
  } catch (error) {
    console.error(`[payments] callback ${providerName} imekataliwa: ${(error as Error).message}`);
    throw new AppError(401, 'Callback si sahihi');
  }
  if (result.eventId) {
    const seen = await one(db, 'SELECT 1 FROM naya.payment_webhook_events WHERE provider = $1 AND event_id = $2', [provider.name, result.eventId]);
    if (seen) return { received: true, duplicate: true };
  }
  if (result.ignore) {
    await recordWebhook(provider.name, result.eventId, { event: result.event, outcome: 'IGNORED' });
    return { received: true, ignored: true };
  }
  const payment = await one<{ amount: number; status: string; direction: 'IN' | 'OUT' }>(
    db,
    'SELECT amount, status, direction FROM naya.payments WHERE reference = $1 AND provider = $2',
    [result.reference, provider.name],
  );
  if (!payment) {
    console.error(`[payments] callback ${providerName}: reference isiyojulikana ${result.reference}`);
    await recordWebhook(provider.name, result.eventId, { event: result.event, reference: result.reference, status: result.status, outcome: 'UNKNOWN_REFERENCE' });
    if (provider.name === 'simulator') throw notFound('Muamala haukupatikana');
    return { received: true, ignored: true };
  }
  // Kiasi kinakaguliwa kwa pesa INAYOINGIA tu (mteja asilipe kidogo akaandikwa amelipa kamili). Pesa inayotoka tuliianzisha
  // sisi, na kampuni inaweza kuripoti kiasi baada ya ada — hilo halizuii uthibitisho.
  if (payment.direction === 'IN' && result.status === 'SUCCESS' && result.amount != null && result.amount !== payment.amount) {
    // Kiasi kimepingana — hakuna kinachoandikwa "kimelipwa"; ofisi inajulishwa na kukagua kwenye Abliner.
    console.error(`[payments] callback ${providerName} ${result.reference}: kiasi ${result.amount} ≠ ${payment.amount}`);
    await recordWebhook(provider.name, result.eventId, { event: result.event, reference: result.reference, status: result.status, outcome: 'AMOUNT_MISMATCH' });
    await notifyAdmins();
    return { received: true, ignored: true };
  }
  const work = applyResult(result.reference, result).then(() =>
    recordWebhook(provider.name, result.eventId, { event: result.event, reference: result.reference, status: result.status, outcome: 'APPLIED' }),
  );
  work.catch((error) => console.error(`[payments] callback ${providerName} ${result.reference}: ${(error as Error).message}`));
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, WEBHOOK_BUDGET_MS)))]);
  clearTimeout(timer);
  return { received: true };
}

// ------------------------------------------------------------------ 2. malipo ya ofa ya moja kwa moja

/** Sababu ya safari kusubiri ukaguzi (null = safi, inaweza kutumwa yenyewe). */
async function holdReason(
  client: Db,
  ride: { driver_id: string; flags: string[]; completed_by: string | null; promo_discount: number },
  account: { network: string } | null,
  limit: number,
) {
  const flags = (ride.flags ?? []).filter((f) => f !== 'PIN_REMINDED');
  if (flags.length) return 'Safari ina alama ya kutiliwa shaka — ofisi ikague kwanza.';
  if (ride.completed_by === 'ADMIN') return 'Safari ilimalizwa na ofisi — ikague kwanza.';
  if (!account) return 'Dereva hajaweka namba ya kupokea pesa.';
  if (!(MOBILE_NETWORKS as string[]).includes(account.network)) return 'Namba kuu ya dereva si ya pesa ya simu (benki / T-Pesa) — tuma kwa mkono.';
  void limit; // kikomo cha siku kinakaguliwa ndani ya preparePayout (baada ya kufunga safu ya dereva)
  return null;
}

/** Kiasi ambacho NAYA imeshamtumia / inamtumia dereva LEO (saa za Dar es Salaam) kwa simu. */
async function paidToday(client: Db, driverId: string) {
  const today = await one<{ sum: number }>(
    client,
    `SELECT coalesce(sum(amount), 0)::int AS sum FROM naya.payments
      WHERE user_id = $1 AND kind = 'PROMO_PAYOUT' AND status IN ('PENDING', 'SUCCESS')
        AND created_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
    [driverId],
  );
  return today?.sum ?? 0;
}
const limitReason = (limit: number) => `Kikomo cha malipo ya simu kwa dereva kwa siku (${tsh(limit)}) kimefika — yatatumwa ofisi ikiruhusu kesho, au lipa kwa mkono.`;

interface PayoutRide {
  id: string;
  driver_id: string;
  flags: string[];
  completed_by: string | null;
  promo_discount: number;
  status: string;
  promo_payout_state: string | null;
}

/**
 * Safari ya ofa imekamilika: tuma malipo ya dereva papo hapo (kama safari ni safi), au iweke "inasubiri ukaguzi".
 * Malipo ya simu yakiwa yamezimwa → hakuna kinachobadilika (ofisi inalipa kwa mkono kama zamani).
 */
export async function onPromoRideCompleted(rideId: string) {
  const provider = getProvider();
  const settings = await getAutoPayout();
  if (!provider?.canDisburse || !settings.enabled) return;
  const plan = await transaction(async (client) => {
    const ride = await one<PayoutRide>(
      client,
      `SELECT id, driver_id, flags, completed_by, promo_discount, status, promo_payout_state FROM naya.rides WHERE id = $1 FOR UPDATE`,
      [rideId],
    );
    if (!ride || ride.status !== 'COMPLETED' || ride.promo_discount <= 0 || ride.promo_payout_state !== null || !ride.driver_id) return null;
    const account = await one<{ network: string; phone: string }>(
      client,
      'SELECT network, phone FROM naya.driver_payout_accounts WHERE driver_id = $1 AND is_primary',
      [ride.driver_id],
    );
    const reason = await holdReason(client, ride, account, settings.dailyLimit);
    if (reason) {
      await client.query(`UPDATE naya.rides SET promo_payout_state = 'HELD', promo_payout_note = $2 WHERE id = $1`, [rideId, reason]);
      return { held: reason, ride };
    }
    const prepared = await preparePayout(client, ride, account!, provider.name, null, 1, settings);
    if (prepared && 'overLimit' in prepared) {
      await client.query(`UPDATE naya.rides SET promo_payout_state = 'HELD', promo_payout_note = $2 WHERE id = $1`, [rideId, prepared.overLimit]);
      return { held: prepared.overLimit, ride };
    }
    if (prepared && 'waiting' in prepared) return { waiting: prepared.waiting, ride };
    return prepared;
  });
  if (!plan) return;
  if ('waiting' in plan) {
    await notify({
      userId: plan.ride.driver_id,
      event: 'driver',
      kind: 'promo_payout_waiting',
      title: 'Malipo ya ofa yanakusanywa',
      body: `NAYA itakutumia ${tsh(plan.ride.promo_discount)} pamoja na safari zako zijazo za ofa (kiasi kidogo hakitumwi peke yake).`,
    });
    return;
  }
  if ('held' in plan) {
    await notify({
      userId: plan.ride.driver_id,
      event: 'driver',
      kind: 'promo_payout_held',
      title: 'Malipo ya ofa yanasubiri ukaguzi',
      body: `NAYA itakutumia ${tsh(plan.ride.promo_discount)} baada ya ofisi kukagua safari hii. ${plan.held}`,
    });
    await notifyAdmins();
    return;
  }
  await sendPayout(plan.payment);
}

const waitingNote = (owed: number, min: number) =>
  `Inakusanywa: deni la ${tsh(owed)} ni chini ya kima cha chini cha kutuma (${tsh(min)}) — litatumwa pamoja na safari zijazo za ofa.`;

/**
 * Ndani ya transaction: muamala wa kutuma kwa safari hii PAMOJA na safari zilizokuwa zinakusanywa (WAITING) za dereva huyu.
 * Kiasi = deni la safari hizo, kisichozidi deni lote la NAYA kwa dereva ukiondoa yanayotumwa sasa.
 */
async function preparePayout(
  client: Db,
  ride: PayoutRide,
  account: { network: string; phone: string },
  providerName: string,
  createdBy: string | null,
  attempt: number,
  settings: AutoPayoutSettings,
): Promise<{ payment: PaymentRow } | { overLimit: string } | { waiting: string } | null> {
  // Safu ya dereva imefungwa: malipo mawili ya dereva mmoja hayawezi kupita kikomo kwa pamoja.
  await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [ride.driver_id]);
  const { balance } = await promoBalance(client, ride.driver_id);
  const pending = await one<{ sum: number }>(
    client,
    `SELECT coalesce(sum(amount), 0)::int AS sum FROM naya.payments WHERE user_id = $1 AND kind = 'PROMO_PAYOUT' AND status = 'PENDING'`,
    [ride.driver_id],
  );
  const waiting = await many<{ id: string; promo_discount: number }>(
    client,
    `SELECT id, promo_discount FROM naya.rides WHERE driver_id = $1 AND promo_payout_state = 'WAITING' AND id <> $2 ORDER BY completed_at FOR UPDATE`,
    [ride.driver_id, ride.id],
  );
  const rideIds = [ride.id, ...waiting.map((w) => w.id)];
  const owed = ride.promo_discount + waiting.reduce((t, w) => t + w.promo_discount, 0);
  const amount = Math.min(owed, balance - (pending?.sum ?? 0));
  if (amount <= 0) {
    // Ofisi ilishamlipa (kwa mkono) — hakuna cha kutuma
    await client.query(`UPDATE naya.rides SET promo_payout_state = 'PAID', promo_payout_note = 'Ilishalipwa kwa mkono' WHERE id = ANY($1::uuid[])`, [rideIds]);
    return null;
  }
  if (amount < settings.minPayout) {
    const note = waitingNote(amount, settings.minPayout);
    await client.query(`UPDATE naya.rides SET promo_payout_state = 'WAITING', promo_payout_note = $2 WHERE id = ANY($1::uuid[])`, [rideIds, note]);
    return { waiting: note };
  }
  // Kikomo cha siku (Africa/Dar_es_Salaam) — kwa KILA malipo ya simu, ya moja kwa moja na ya ofisi.
  if ((await paidToday(client, ride.driver_id)) + amount > settings.dailyLimit) return { overLimit: limitReason(settings.dailyLimit) };
  const payment = await insertPayment(client, {
    kind: 'PROMO_PAYOUT',
    direction: 'OUT',
    userId: ride.driver_id,
    amount,
    network: account.network as MobileNetwork,
    phone: account.phone,
    provider: providerName,
    meta: { rideIds },
    attempt,
    createdBy,
  });
  await client.query(
    `UPDATE naya.rides SET promo_payout_state = 'PENDING', promo_payout_note = NULL, promo_payment_id = $2 WHERE id = ANY($1::uuid[])`,
    [rideIds, payment.id],
  );
  return { payment };
}

async function sendPayout(payment: PaymentRow) {
  const provider = getProvider();
  if (!provider) return;
  // NAYA inabeba ada ya kutuma: dereva apokee `payment.amount` kamili (deni lake). Kiasi cha kutuma kinahifadhiwa kwanza.
  let send = payment.amount;
  if (provider.quoteDisbursement) {
    const { feeMode } = await getAutoPayout();
    const q = await provider.quoteDisbursement(payment.amount, feeMode);
    send = q.send;
    await db.query(
      `UPDATE naya.payments SET meta = meta || $2::jsonb, updated_at = now() WHERE id = $1`,
      [payment.id, JSON.stringify({ sendAmount: q.send, fee: q.fee, feeSource: q.source, feeMode })],
    );
  }
  let result: ProviderResult;
  try {
    result = await provider.disburse({
      reference: payment.reference,
      amount: send,
      phone: payment.phone,
      network: payment.network,
      description: 'NAYA malipo ya safari ya ofa',
    });
  } catch (error) {
    // Hatujui kama pesa imetoka — usiandike "imeshindwa"; worker itauliza hali yake.
    console.error(`[payments] disburse ${payment.reference}: ${(error as Error).message}`);
    return;
  }
  await applyResult(payment.reference, result);
}

async function rideForAction(client: Db, rideId: string) {
  const ride = await one<PayoutRide & { promo_payment_id: string | null }>(
    client,
    `SELECT id, driver_id, flags, completed_by, promo_discount, status, promo_payout_state, promo_payment_id FROM naya.rides WHERE id = $1 FOR UPDATE`,
    [rideId],
  );
  if (!ride || ride.promo_discount <= 0) throw notFound('Safari ya ofa haikupatikana');
  return ride;
}

/** Ofisi: "Tuma" — safari iliyokuwa inasubiri ukaguzi, au iliyoshindwa kutumwa (kampuni ilithibitisha kushindwa). */
export async function approvePayout(adminId: string, rideId: string) {
  const provider = getProvider();
  if (!provider?.canDisburse) throw conflict('Malipo ya moja kwa moja hayajawashwa. Tumia "Lipa" ya mkono.');
  const plan = await transaction(async (client) => {
    const ride = await rideForAction(client, rideId);
    if (!['HELD', 'FAILED'].includes(ride.promo_payout_state ?? '')) throw conflict('Safari hii haisubiri malipo.');
    if (ride.promo_payout_state === 'FAILED' && ride.promo_payment_id) {
      const last = await one<{ status: string }>(client, 'SELECT status FROM naya.payments WHERE id = $1', [ride.promo_payment_id]);
      if (last?.status !== 'FAILED') throw conflict('Muamala wa mwisho bado haujathibitishwa kushindwa — subiri.');
    }
    const account = await one<{ network: string; phone: string }>(client, 'SELECT network, phone FROM naya.driver_payout_accounts WHERE driver_id = $1 AND is_primary', [ride.driver_id]);
    if (!account) throw conflict('Dereva hajaweka namba ya kupokea pesa.');
    if (!(MOBILE_NETWORKS as string[]).includes(account.network)) throw conflict('Namba kuu ya dereva si ya pesa ya simu — tuma kwa mkono.');
    const attempt = ride.promo_payment_id ? ((await one<{ attempt: number }>(client, 'SELECT attempt FROM naya.payments WHERE id = $1', [ride.promo_payment_id]))?.attempt ?? 0) + 1 : 1;
    const settings = await getAutoPayout(client);
    const prepared = await preparePayout(client, ride, account, provider.name, adminId, attempt, settings);
    if (prepared && 'overLimit' in prepared) throw conflict(prepared.overLimit);
    await writeAudit(client, {
      actorId: adminId,
      action: 'promo_payout.approved',
      targetType: 'ride',
      targetId: rideId,
      details: { amount: prepared && 'payment' in prepared ? prepared.payment.amount : 0 },
    });
    return prepared;
  });
  if (plan && 'payment' in plan) await sendPayout(plan.payment);
  const queue = await payoutQueue();
  return { ...queue, message: plan && 'waiting' in plan ? plan.waiting : plan && 'payment' in plan ? 'Malipo yanatumwa' : 'Hakuna cha kutuma — ilishalipwa' };
}

/** Ofisi: "Kataa" — safari ya kutiliwa shaka; NAYA haimdai dereva kiasi hiki tena. */
export async function rejectPayout(adminId: string, rideId: string, reason: string) {
  const driverId = await transaction(async (client) => {
    const ride = await rideForAction(client, rideId);
    if (!['HELD', 'FAILED'].includes(ride.promo_payout_state ?? '')) throw conflict('Safari hii haisubiri malipo.');
    await client.query(`UPDATE naya.rides SET promo_payout_state = 'REJECTED', promo_payout_note = $2 WHERE id = $1`, [rideId, reason]);
    await writeAudit(client, { actorId: adminId, action: 'promo_payout.rejected', targetType: 'ride', targetId: rideId, details: { reason } });
    return ride.driver_id;
  });
  await notify({ userId: driverId, event: 'driver', kind: 'promo_payout_rejected', title: 'Malipo ya ofa yamekataliwa', body: `Ofisi ya NAYA imekataa malipo ya safari moja ya ofa: ${reason}` });
  return payoutQueue();
}

/** Dereva ameweka namba ya pesa ya simu: safari zilizosubiri kwa kukosa namba zitumwe sasa. */
export async function releaseHeldForAccount(driverId: string) {
  const rides = await many<{ id: string }>(
    db,
    `SELECT id FROM naya.rides WHERE driver_id = $1 AND promo_payout_state = 'HELD' AND promo_payout_note LIKE 'Dereva hajaweka namba%'`,
    [driverId],
  );
  for (const r of rides) {
    await db.query(`UPDATE naya.rides SET promo_payout_state = NULL, promo_payout_note = NULL WHERE id = $1 AND promo_payout_state = 'HELD'`, [r.id]);
    await onPromoRideCompleted(r.id).catch((error) => console.error(`[payments] release ${r.id}: ${(error as Error).message}`));
  }
}

// ------------------------------------------------------------------ worker

/** Kila dakika: uliza hali ya miamala inayosubiri (callback ikichelewa au kupotea). */
export async function checkPendingPayments() {
  const provider = getProvider();
  if (!provider) return;
  const rows = await many<PaymentRow>(
    db,
    `SELECT * FROM naya.payments WHERE status = 'PENDING' AND provider = $1 AND created_at < now() - interval '20 seconds'
      ORDER BY created_at LIMIT 30`,
    [provider.name],
  );
  for (const p of rows) await refresh(p);
}

// ------------------------------------------------------------------ ofisi

export async function payoutQueue() {
  const [held, failed, unconfirmed, waiting] = await Promise.all([
    many(
      db,
      `SELECT r.id, r.completed_at AS "completedAt", r.pickup_name AS "from", r.dest_name AS "to", r.promo_discount AS amount,
              r.promo_payout_note AS reason, array_remove(r.flags, 'PIN_REMINDED') AS flags,
              u.id AS "driverId", u.full_name AS "driverName", d.plate_number AS plate, a.network, a.phone AS "payPhone"
         FROM naya.rides r JOIN naya.users u ON u.id = r.driver_id JOIN naya.drivers d ON d.user_id = r.driver_id
         LEFT JOIN naya.driver_payout_accounts a ON a.driver_id = r.driver_id AND a.is_primary
        WHERE r.promo_payout_state = 'HELD' ORDER BY r.completed_at LIMIT 200`,
    ),
    many(
      db,
      `SELECT r.id, r.completed_at AS "completedAt", r.pickup_name AS "from", r.dest_name AS "to", r.promo_discount AS amount,
              r.promo_payout_note AS reason, p.attempt, u.id AS "driverId", u.full_name AS "driverName", d.plate_number AS plate,
              p.network, p.phone AS "payPhone"
         FROM naya.rides r JOIN naya.users u ON u.id = r.driver_id JOIN naya.drivers d ON d.user_id = r.driver_id
         LEFT JOIN naya.payments p ON p.id = r.promo_payment_id
        WHERE r.promo_payout_state = 'FAILED' ORDER BY r.completed_at LIMIT 200`,
    ),
    many(
      db,
      `SELECT p.id, p.reference, p.amount, p.network, p.phone, p.created_at AS "createdAt", u.full_name AS "driverName"
         FROM naya.payments p JOIN naya.users u ON u.id = p.user_id
        WHERE p.kind = 'PROMO_PAYOUT' AND p.status = 'PENDING' AND p.created_at < now() - interval '5 minutes' ORDER BY p.created_at`,
    ),
    many(
      db,
      `SELECT u.id AS "driverId", u.full_name AS "driverName", count(*)::int AS rides, sum(r.promo_discount)::int AS amount, max(r.completed_at) AS "lastAt"
         FROM naya.rides r JOIN naya.users u ON u.id = r.driver_id
        WHERE r.promo_payout_state = 'WAITING' GROUP BY u.id, u.full_name ORDER BY max(r.completed_at) DESC LIMIT 200`,
    ),
  ]);
  const label = (n: string | null) => (n ? NETWORK_LABEL[n as Network] ?? n : null);
  const withLabel = (rows: unknown[]) => (rows as Record<string, unknown>[]).map((r) => ({ ...r, networkLabel: label(r.network as string | null) }));
  return { held: withLabel(held), failed: withLabel(failed), unconfirmed: withLabel(unconfirmed), waiting };
}

export async function paymentsOverview() {
  const totals = await one<Record<string, number>>(
    db,
    `SELECT count(*) FILTER (WHERE kind = 'SUBSCRIPTION' AND status = 'SUCCESS' AND completed_at >= now() - interval '30 days')::int AS "subscriptionCount",
            coalesce(sum(amount) FILTER (WHERE kind = 'SUBSCRIPTION' AND status = 'SUCCESS' AND completed_at >= now() - interval '30 days'), 0)::int AS "subscriptionAmount",
            count(*) FILTER (WHERE kind = 'PROMO_PAYOUT' AND status = 'SUCCESS' AND completed_at >= now() - interval '30 days')::int AS "payoutCount",
            coalesce(sum(amount) FILTER (WHERE kind = 'PROMO_PAYOUT' AND status = 'SUCCESS' AND completed_at >= now() - interval '30 days'), 0)::int AS "payoutAmount"
       FROM naya.payments`,
  );
  const queue = await one<Record<string, number>>(
    db,
    `SELECT count(*) FILTER (WHERE promo_payout_state = 'HELD')::int AS held, count(*) FILTER (WHERE promo_payout_state = 'FAILED')::int AS failed
       FROM naya.rides WHERE promo_payout_state IN ('HELD', 'FAILED')`,
  );
  return { config: paymentsConfig(), settings: await getAutoPayout(), totals, queue };
}

export async function listPayments(opts: { kind?: Kind; status?: Status; q?: string }) {
  const q = opts.q?.trim() ? (/^0\d{3,}$/.test(opts.q.trim()) ? `255${opts.q.trim().slice(1)}` : opts.q.trim()) : null;
  const rows = await many<PaymentRow & { driver_name: string }>(
    db,
    `SELECT p.*, u.full_name AS driver_name FROM naya.payments p JOIN naya.users u ON u.id = p.user_id
      WHERE ($1::text IS NULL OR p.kind = $1) AND ($2::text IS NULL OR p.status = $2)
        AND ($3::text IS NULL OR u.full_name ILIKE '%' || $3 || '%' OR p.phone ILIKE '%' || $3 || '%' OR p.reference ILIKE '%' || $3 || '%'
             OR p.provider_ref ILIKE '%' || $3 || '%')
      ORDER BY p.created_at DESC LIMIT 200`,
    [opts.kind ?? null, opts.status ?? null, q],
  );
  return rows.map((r) => ({ ...view(r), driverId: r.user_id, driverName: r.driver_name, attempt: r.attempt }));
}

export function paymentsCsv(rows: Awaited<ReturnType<typeof listPayments>>) {
  const KIND = { SUBSCRIPTION: 'Ada ya mwezi', PROMO_PAYOUT: 'Malipo ya ofa' };
  const STATUS = { PENDING: 'Inasubiri', SUCCESS: 'Imefaulu', FAILED: 'Imeshindwa' };
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t;
  };
  const head = ['Muda', 'Aina', 'Mwelekeo', 'Dereva', 'Mtandao', 'Simu', 'Kiasi (TSh)', 'Hali', 'Kumbukumbu yetu', 'Kumbukumbu ya mtandao', 'Sababu'];
  const lines = rows.map((r) =>
    [new Date(r.createdAt).toISOString(), KIND[r.kind], r.direction === 'IN' ? 'Imeingia' : 'Imetoka', r.driverName, r.networkLabel, r.phone, r.amount, STATUS[r.status], r.reference, r.providerRef, r.failureReason]
      .map(cell)
      .join(','),
  );
  return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------ salio la akaunti kuu (Abliner)

export interface WalletSettings {
  lowBalance: number; // salio likishuka chini ya hiki → onyo kwa ofisi
}

export async function getWalletSettings(client: Db = db): Promise<WalletSettings> {
  const row = await one<{ value: Partial<WalletSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'wallet'`);
  return { lowBalance: 1000, ...(row?.value ?? {}) };
}

export async function saveWalletSettings(adminId: string, input: WalletSettings) {
  await transaction(async (client) => {
    const before = await getWalletSettings(client);
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('wallet', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(input), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.wallet', targetType: 'settings', targetId: null, details: { before, after: input } });
  });
  return getWalletSettings();
}

// Salio linasomwa Abliner mara moja kila sekunde 30 tu (dashboard ikiwa wazi kwa watu wengi haigongi Abliner kila mara).
let balanceCache: { at: number; value: Awaited<ReturnType<typeof ablinerBalance>> } | null = null;
async function cachedBalance(force = false) {
  if (!force && balanceCache && Date.now() - balanceCache.at < 30_000) return balanceCache.value;
  const value = await ablinerBalance();
  balanceCache = { at: Date.now(), value };
  return value;
}

/**
 * Ofisi: salio la akaunti kuu ya Abliner + pesa za leo (saa za Dar es Salaam) + kiwango cha onyo.
 * `balance: null` = halijulikani (Abliner haijaunganishwa au haikupatikana) — kamwe halibuniwi.
 */
export async function walletOverview(opts: { refresh?: boolean } = {}) {
  const provider = getProvider();
  const settings = await getWalletSettings();
  const today = await one<Record<string, number>>(
    db,
    `SELECT coalesce(sum(amount) FILTER (WHERE direction = 'IN'), 0)::int AS "inAmount", count(*) FILTER (WHERE direction = 'IN')::int AS "inCount",
            coalesce(sum(amount) FILTER (WHERE direction = 'OUT'), 0)::int AS "outAmount", count(*) FILTER (WHERE direction = 'OUT')::int AS "outCount"
       FROM naya.payments
      WHERE status = 'SUCCESS' AND completed_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
  );
  const pending = await one<Record<string, number>>(
    db,
    `SELECT count(*)::int AS count, coalesce(sum(amount), 0)::int AS amount FROM naya.payments WHERE status = 'PENDING' AND direction = 'OUT'`,
  );
  const base = { provider: provider?.name ?? null, lowBalance: settings.lowBalance, today, pendingOut: pending, checkedAt: new Date() };
  if (provider?.name !== 'abliner') return { ...base, connected: false, balance: null, currency: null, low: false, message: provider ? null : 'Kampuni ya malipo haijaunganishwa.' };
  const b = await cachedBalance(opts.refresh);
  if (!b.ok) return { ...base, connected: false, balance: null, currency: null, low: false, message: b.message };
  return { ...base, connected: true, balance: b.balance, currency: b.currency, low: b.balance !== null && b.balance < settings.lowBalance, message: null };
}

/**
 * Ofisi: "Kagua muunganiko" — kampuni inayotumika, tatizo la mipangilio (majina ya variables tu), webhook URL,
 * na salio la Abliner (GET /api/v1/balance — haigusi pesa). Kamwe haionyeshi funguo zenyewe.
 */
export async function providerCheck() {
  const provider = getProvider();
  const configured = (process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase() || null;
  const webhookUrl = ablinerCallbackUrl();
  const base = { configured, active: provider?.name ?? null, problem: providerProblem(), webhookUrl };
  if (configured === 'abliner' || provider?.name === 'abliner') return { ...base, check: await ablinerBalance() };
  return { ...base, check: provider ? { ok: true as const, balance: null, currency: null } : null };
}

export { guessNetwork };
