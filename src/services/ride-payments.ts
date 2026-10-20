// Abiria kulipa nauli kwa simu (0.22.0)
//   - Akifika tu (safari COMPLETED): "Lipa kwa simu" (namba yoyote — hadi namba 3 kwa safari moja) au taslimu.
//   - Ada ya kupokea pesa inaongezwa JUU ya nauli (abiria analipa); dereva anapata nauli kamili kwenye wallet yake.
//   - Dereva: "Nimepokea cash" au "Hajalipa" → deni. Abiria mwenye deni hawezi kuagiza safari mpaka alipe (kwa simu).
//   - Ofisi: kuwasha / kuzima, ada, orodha ya madeni, kufuta deni (amelipa cash / kusamehe) kwa sababu.
// Hakuna kinachoandikwa "imelipwa" mpaka kampuni ya malipo ithibitishe (applyResult → settleRideFare).
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';
import { applyResult, guessNetwork, insertPayment, myPayment, type PaymentRow } from './payments/index.js';
import { getProvider, type MobileNetwork, type ProviderResult } from './payments/provider.js';
import { customerWalletBrief, getCustomerWalletSettings, lockCustomerWallet, postCustomerEntry, startTopup } from './customer-wallet.js';
import { lockWallet, postEntry } from './wallet-ledger.js';

export interface RidePaySettings {
  /** Abiria wanaweza kulipa kwa simu (ofisi inawasha baada ya kuweka ada ya Abliner) */
  enabled: boolean;
  /** Ada inayoongezwa juu ya nauli, % (iwe sawa na ada ya Abliner ya kupokea pesa) */
  feePercent: number;
  /** Ada ya chini kabisa kwa kila malipo (TSh) */
  feeMin: number;
}
export const RIDE_PAY_DEFAULTS: RidePaySettings = { enabled: false, feePercent: 0, feeMin: 0 };
export const MAX_NUMBERS = 3;
/** Saa ambazo safari iliyokamilika inaweza kulipwa / kuandikwa cash au deni */
export const SETTLE_HOURS = 24;

const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;

export async function getRidePaySettings(client: Db = db): Promise<RidePaySettings> {
  const row = await one<{ value: Partial<RidePaySettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'ride_payments'`);
  return { ...RIDE_PAY_DEFAULTS, ...(row?.value ?? {}) };
}

export async function saveRidePaySettings(adminId: string, partial: Partial<RidePaySettings>) {
  return transaction(async (client) => {
    const before = await getRidePaySettings(client);
    const after: RidePaySettings = { ...before, ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)) };
    if (after.enabled && !getProvider()) throw conflict('Kampuni ya malipo haijaunganishwa — malipo ya simu hayawezi kuwashwa.');
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('ride_payments', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(after), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.ride_payments', targetType: 'settings', targetId: null, details: { before, after } });
    return after;
  });
}

/** Ada juu ya nauli (shilingi nzima, juu). */
export const fareFee = (s: RidePaySettings, due: number) => (due <= 0 ? 0 : Math.max(Math.round(s.feeMin), Math.ceil((due * s.feePercent) / 100)));

/**
 * Ombi la PIN "linasubiri" kwa dakika 3 tu (ombi la simu linaisha muda mapema zaidi ya hapo). Baada ya hapo abiria anaweza
 * kujaribu tena na dereva anaweza kuandika taslimu — malipo yakithibitishwa baadaye kuliko hapo, ofisi inajulishwa (mara mbili).
 */
export const PENDING_HOLD_MINUTES = 3;
const isPending = (p: Pick<PaymentRow, 'status' | 'created_at'>) =>
  p.status === 'PENDING' && Date.now() - new Date(p.created_at).getTime() < PENDING_HOLD_MINUTES * 60_000;

interface FareRide {
  id: string;
  status: string;
  passenger_id: string;
  driver_id: string | null;
  fare: number;
  promo_discount: number;
  completed_at: Date | null;
  fare_settlement: string | null;
  fare_settled_at: Date | null;
  debt_cleared_at: Date | null;
  fare_refund?: string | null;
}

/** Hali ambazo abiria anaweza kulipa kwa simu: dereva amekubali → mpaka safari ikamilike (0.22.1). */
export const PAY_EARLY: string[] = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];

async function ridePayments(client: Db, ride: Pick<FareRide, 'id' | 'passenger_id'>) {
  return many<PaymentRow>(
    client,
    `SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' AND meta->'rideIds' ? $2 ORDER BY created_at DESC LIMIT 200`,
    [ride.passenger_id, ride.id],
  );
}

const withinWindow = (r: Pick<FareRide, 'completed_at'>) => !!r.completed_at && Date.now() - new Date(r.completed_at).getTime() < SETTLE_HOURS * 3600_000;

/**
 * Hali ya malipo ya nauli (abiria, dereva, ofisi): kuanzia dereva akubali mpaka safari ikamilike. null = haihusiki
 * (hakuna dereva bado, au malipo ya simu yamezimwa na hakuna kilichoandikwa).
 */
export async function fareState(client: Db, r: FareRide, settings?: RidePaySettings) {
  const early = PAY_EARLY.includes(r.status);
  const prepaid = r.fare_settlement === 'MOBILE' || r.fare_settlement === 'WALLET';
  const ended = ['CANCELLED', 'NO_DRIVER'].includes(r.status) || (r.status === 'SEARCHING' && prepaid);
  if (r.status !== 'COMPLETED' && !early && !(ended && prepaid)) return null;
  const s = settings ?? (await getRidePaySettings(client));
  const cw = await customerWalletBrief(client, r.passenger_id);
  if (!s.enabled && !cw.enabled && !r.fare_settlement) return null;
  const due = Math.max(0, r.fare - r.promo_discount);
  const fee = fareFee(s, due);
  const pays = s.enabled ? await ridePayments(client, r) : [];
  const pending = pays.find(isPending) ?? null;
  const numbers = [...new Set(pays.filter((p) => p.meta?.purpose === 'RIDE').map((p) => p.phone))];
  const last = pays[0] ?? null;
  const open = r.fare_settlement === null && (early || (r.status === 'COMPLETED' && withinWindow(r)));
  const done = r.status === 'COMPLETED';
  return {
    enabled: s.enabled,
    settlement: r.fare_settlement as 'CASH' | 'MOBILE' | 'DEBT' | 'WALLET' | null,
    settledAt: r.fare_settled_at,
    debtCleared: r.fare_settlement === 'DEBT' ? !!r.debt_cleared_at : null,
    due,
    fee,
    total: due + fee,
    pending: pending ? { id: pending.id, phone: pending.phone } : null,
    last: last && !isPending(last) ? { id: last.id, status: last.status, phone: last.phone, failureReason: last.failure_reason } : null,
    numbersUsed: numbers,
    numbersLeft: Math.max(0, MAX_NUMBERS - numbers.length),
    /** Safari bado inaendelea (malipo ya mapema): pesa inaingia wallet ya dereva safari ikikamilika */
    early,
    /** Safari ilighairiwa baada ya kulipa → ofisi inamrudishia abiria */
    refund: (r.fare_refund as 'NEEDED' | 'DONE' | null | undefined) ?? null,
    /** Abiria anaweza kubonyeza "Lipa kwa simu" sasa */
    canPay: s.enabled && open && !pending && due > 0,
    /** 0.23.0 Salio la NAYA la abiria (dereva haoni — rides.ts inaliondoa) */
    wallet: cw.enabled ? { balance: cw.balance, canPay: open && !pending && due > 0 && cw.balance >= due } : null,
    /** Dereva anaweza kuandika cash / deni sasa (safari ikishakamilika tu) */
    canSettle: done && open && !pending && due > 0,
    canDebt: done && s.enabled && open && !pending && due > 0,
  };
}

async function startCollect(passengerId: string, payment: PaymentRow, description: string) {
  const provider = getProvider()!;
  let result: ProviderResult;
  try {
    result = await provider.collect({ reference: payment.reference, amount: payment.amount, phone: payment.phone, network: payment.network, description });
  } catch (error) {
    console.error(`[nauli] collect ${payment.reference}: ${(error as Error).message}`);
    // HATUJUI kama ombi la PIN limefika kwa mteja → linabaki PENDING; worker inauliza hali (dakika 15 → limeshindwa).
    result = { status: 'PENDING' };
  }
  await applyResult(payment.reference, result);
  return myPayment(passengerId, payment.id);
}

function pickNetwork(phone: string, network?: string | null): MobileNetwork {
  const n = (network as MobileNetwork | undefined) ?? guessNetwork(phone);
  if (!n) throw badRequest('Hatukutambua mtandao wa namba hii. Chagua mtandao (M-Pesa, Mixx, Airtel, HaloPesa).');
  return n;
}

/** Abiria: lipa nauli ya safari iliyokamilika kwa simu (ombi la PIN linaenda kwenye simu hiyo). */
export async function payRideFare(passengerId: string, rideId: string, input: { phone: string; network?: string | null }) {
  const s = await getRidePaySettings();
  const provider = getProvider();
  if (!s.enabled || !provider) throw conflict('Malipo ya nauli kwa simu hayajawashwa. Lipa dereva taslimu.');
  const network = pickNetwork(input.phone, input.network);
  const payment = await transaction(async (client) => {
    const r = await one<FareRide>(client, 'SELECT * FROM naya.rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!r || r.passenger_id !== passengerId) throw notFound('Safari haikupatikana');
    if (r.status !== 'COMPLETED' && !PAY_EARLY.includes(r.status)) {
      throw conflict(r.status === 'SEARCHING' ? 'Utaweza kulipa dereva akishakubali safari.' : 'Safari hii haipo tena.');
    }
    if (r.fare_settlement === 'CASH') throw conflict('Dereva ameandika kwamba umelipa taslimu.');
    if (r.fare_settlement === 'MOBILE') throw conflict('Safari hii imeshalipwa kwa simu.');
    if (r.fare_settlement === 'WALLET') throw conflict('Safari hii imeshalipwa kwa salio lako la NAYA.');
    if (r.fare_settlement === 'DEBT') throw conflict('Safari hii imekuwa deni — lipa kupitia "Deni langu".');
    if (r.status === 'COMPLETED' && !withinWindow(r)) throw conflict('Muda wa kulipa safari hii umepita.');
    const due = Math.max(0, r.fare - r.promo_discount);
    if (due <= 0) throw conflict('Safari hii haina cha kulipa.');
    const pays = await ridePayments(client, r);
    if (pays.some(isPending)) throw conflict('Ombi la kulipa linasubiri — angalia simu yako na uweke PIN.');
    if (pays.some((p) => p.status === 'SUCCESS')) throw conflict('Safari hii imeshalipwa kwa simu.');
    const used = new Set(pays.map((p) => p.phone));
    if (!used.has(input.phone) && used.size >= MAX_NUMBERS) throw conflict(`Umeshajaribu namba ${MAX_NUMBERS}. Lipa dereva taslimu.`);
    const fee = fareFee(s, due);
    const pay = await insertPayment(client, {
      kind: 'RIDE_FARE',
      direction: 'IN',
      userId: passengerId,
      amount: due + fee,
      network,
      phone: input.phone,
      provider: provider.name,
      meta: { rideIds: [rideId], fare: due, fee, purpose: 'RIDE' },
    });
    return { pay, driverId: r.driver_id };
  });
  // Skrini ya dereva: "Abiria analipa kwa simu…" (badala ya kitufe cha cash)
  if (payment.driverId) await notify({ userId: payment.driverId, event: 'driver', rideId });
  const result = await startCollect(passengerId, payment.pay, 'NAYA nauli ya safari');
  if (payment.driverId && result.status === 'FAILED') await notify({ userId: payment.driverId, event: 'driver', rideId });
  return result;
}

// ------------------------------------------------------------------ deni

async function openDebtRides(client: Db, passengerId: string, lock = false) {
  return many<FareRide & { dest_name: string; pickup_name: string; driver_name: string | null }>(
    client,
    `SELECT r.*, u.full_name AS driver_name FROM naya.rides r LEFT JOIN naya.users u ON u.id = r.driver_id
      WHERE r.passenger_id = $1 AND r.fare_settlement = 'DEBT' AND r.debt_cleared_at IS NULL ORDER BY r.completed_at${lock ? ' FOR UPDATE OF r' : ''}`,
    [passengerId],
  );
}

/** Abiria: deni lake (safari ambazo hakulipa) na kiasi cha kulipa kwa simu. */
export async function myDebt(passengerId: string) {
  const s = await getRidePaySettings();
  const rides = await openDebtRides(db, passengerId);
  const due = rides.reduce((t, r) => t + Math.max(0, r.fare - r.promo_discount), 0);
  const fee = fareFee(s, due);
  const pending = due
    ? await one<PaymentRow>(
        db,
        `SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' AND meta->>'purpose' = 'DEBT' AND status = 'PENDING'
            AND created_at > now() - make_interval(mins => $2::int) ORDER BY created_at DESC LIMIT 1`,
        [passengerId, PENDING_HOLD_MINUTES],
      )
    : null;
  const cw = await customerWalletBrief(db, passengerId);
  return {
    wallet: cw.enabled ? { balance: cw.balance, canPay: due > 0 && cw.balance >= due && !pending } : null,
    enabled: s.enabled,
    due,
    fee,
    total: due + fee,
    pending: pending ? { id: pending.id, phone: pending.phone } : null,
    rides: rides.map((r) => ({
      id: r.id,
      completedAt: r.completed_at,
      from: r.pickup_name,
      to: r.dest_name,
      driverName: r.driver_name,
      amount: Math.max(0, r.fare - r.promo_discount),
    })),
  };
}

/** Kabla ya kuagiza: abiria mwenye deni anazuiwa (HTTP 402) — app inampeleka kwenye "Deni langu". */
export async function assertNoDebt(client: Db, passengerId: string) {
  const s = await getRidePaySettings(client);
  // Bila malipo ya simu hakuna njia ya kulipa deni kwenye app → hakuna kuzuiwa (ofisi inaweza kuondoa deni)
  if (!s.enabled || !getProvider()) return;
  const row = await one<{ total: number }>(
    client,
    `SELECT coalesce(sum(greatest(fare - promo_discount, 0)), 0)::int AS total FROM naya.rides
      WHERE passenger_id = $1 AND fare_settlement = 'DEBT' AND debt_cleared_at IS NULL`,
    [passengerId],
  );
  if ((row?.total ?? 0) > 0) throw new AppError(402, `Una deni la ${tsh(row!.total)} la safari uliyopita bila kulipa. Lipa deni kwanza ili uagize safari mpya.`);
}

/** Abiria: lipa deni lote kwa simu (pesa inaenda kwenye wallet za madereva aliowadai). */
export async function payDebt(passengerId: string, input: { phone: string; network?: string | null }) {
  const s = await getRidePaySettings();
  const provider = getProvider();
  if (!s.enabled || !provider) throw conflict('Malipo kwa simu hayajawashwa kwa sasa. Wasiliana na ofisi ya NAYA.');
  const network = pickNetwork(input.phone, input.network);
  const payment = await transaction(async (client) => {
    await client.query('SELECT 1 FROM naya.users WHERE id = $1 FOR UPDATE', [passengerId]); // ombi moja la deni kwa wakati mmoja
    const rides = await openDebtRides(client, passengerId, true);
    const due = rides.reduce((t, r) => t + Math.max(0, r.fare - r.promo_discount), 0);
    if (due <= 0) throw conflict('Huna deni.');
    const waiting = await one(
      client,
      `SELECT 1 FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' AND meta->>'purpose' = 'DEBT' AND status = 'PENDING'
          AND created_at > now() - make_interval(mins => $2::int)`,
      [passengerId, PENDING_HOLD_MINUTES],
    );
    if (waiting) throw conflict('Ombi la kulipa deni linasubiri — angalia simu yako na uweke PIN.');
    const fee = fareFee(s, due);
    return insertPayment(client, {
      kind: 'RIDE_FARE',
      direction: 'IN',
      userId: passengerId,
      amount: due + fee,
      network,
      phone: input.phone,
      provider: provider.name,
      meta: { rideIds: rides.map((r) => r.id), fare: due, fee, purpose: 'DEBT' },
    });
  });
  return startCollect(passengerId, payment, 'NAYA deni la nauli');
}

// ------------------------------------------------------------------ dereva

/** Dereva: "Nimepokea cash" au "Hajalipa" (deni). Mpangilio wa kufunga: dereva → safari. */
export async function driverSettle(driverId: string, rideId: string, how: 'CASH' | 'DEBT') {
  const s = await getRidePaySettings();
  const r = await transaction(async (client) => {
    await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [driverId]);
    const r = await one<FareRide>(client, 'SELECT * FROM naya.rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!r || r.driver_id !== driverId) throw notFound('Safari haikupatikana');
    if (r.status !== 'COMPLETED') throw conflict('Safari bado haijakamilika.');
    if (r.fare_settlement) {
      throw conflict(['MOBILE', 'WALLET'].includes(r.fare_settlement) ? 'Abiria ameshalipa kupitia NAYA — pesa iko kwenye wallet yako.' : 'Malipo ya safari hii yameshaandikwa.');
    }
    if (!withinWindow(r)) throw conflict('Muda wa kuandika malipo ya safari hii umepita.');
    if (Math.max(0, r.fare - r.promo_discount) <= 0) throw conflict('Safari hii haina cha kulipa.');
    if (how === 'DEBT' && !s.enabled) throw forbidden('Deni linawezekana malipo ya simu yakiwa yamewashwa na ofisi.');
    const pays = await ridePayments(client, r);
    if (pays.some(isPending)) throw conflict('Abiria analipa kwa simu sasa hivi — subiri sekunde chache.');
    if (pays.some((p) => p.status === 'SUCCESS')) throw conflict('Abiria ameshalipa kwa simu.');
    await client.query(`UPDATE naya.rides SET fare_settlement = $2, fare_settled_at = now(), updated_at = now() WHERE id = $1`, [rideId, how]);
    await writeAudit(client, { actorId: driverId, action: how === 'CASH' ? 'ride_fare.cash' : 'ride_fare.debt', targetType: 'ride', targetId: rideId });
    return r;
  });
  const due = Math.max(0, r.fare - r.promo_discount);
  if (how === 'DEBT') {
    await notify({
      userId: r.passenger_id,
      event: 'ride',
      rideId,
      kind: 'ride_fare_debt',
      title: 'Una deni la nauli',
      body: `Dereva ameandika kwamba hukulipa nauli ya ${tsh(due)}. Lipa deni kwenye app ya NAYA (kwa simu) ili uagize safari tena.`,
      sms: `NAYA: Hukulipa nauli ya ${tsh(due)}. Lipa deni kwenye app ya NAYA ili uagize safari tena.`,
    });
    await notifyAdmins();
  } else await notify({ userId: r.passenger_id, event: 'ride', rideId });
  return { settlement: how };
}

// ------------------------------------------------------------------ ofisi

export async function listDebts(open: boolean) {
  return many(
    db,
    `SELECT r.id, r.completed_at AS "completedAt", r.pickup_name AS "from", r.dest_name AS "to",
            greatest(r.fare - r.promo_discount, 0)::int AS amount,
            p.id AS "passengerId", p.full_name AS "passengerName", p.phone AS "passengerPhone",
            d.id AS "driverId", d.full_name AS "driverName",
            r.debt_cleared_at AS "clearedAt", r.debt_cleared_how AS "clearedHow", r.debt_note AS note, c.full_name AS "clearedBy"
       FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id LEFT JOIN naya.users d ON d.id = r.driver_id
       LEFT JOIN naya.users c ON c.id = r.debt_cleared_by
      WHERE r.fare_settlement = 'DEBT' AND ($1::boolean IS FALSE OR r.debt_cleared_at IS NULL)
      ORDER BY (r.debt_cleared_at IS NULL) DESC, r.completed_at DESC LIMIT 300`,
    [open],
  );
}

export async function ridePaySummary() {
  const [s, debts, today] = await Promise.all([
    getRidePaySettings(),
    one<{ n: number; total: number; people: number }>(
      db,
      `SELECT count(*)::int AS n, coalesce(sum(greatest(fare - promo_discount, 0)), 0)::int AS total, count(DISTINCT passenger_id)::int AS people
         FROM naya.rides WHERE fare_settlement = 'DEBT' AND debt_cleared_at IS NULL`,
    ),
    one<{ n: number; total: number; fees: number }>(
      db,
      `SELECT count(*)::int AS n, coalesce(sum((meta->>'fare')::int), 0)::int AS total, coalesce(sum((meta->>'fee')::int), 0)::int AS fees
         FROM naya.payments WHERE kind = 'RIDE_FARE' AND status = 'SUCCESS'
          AND completed_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam')`,
    ),
  ]);
  const refunds = await one<{ n: number; total: number }>(
    db,
    `SELECT count(*)::int AS n, coalesce(sum(p.amount), 0)::int AS total FROM naya.rides r JOIN naya.payments p ON p.id = r.fare_payment_id
      WHERE r.fare_refund = 'NEEDED'`,
  );
  return { settings: s, providerReady: !!getProvider(), debts: debts!, today: today!, refunds: refunds!, maxNumbers: MAX_NUMBERS };
}

/** Ofisi: deni limeondolewa — CASH = abiria alimlipa dereva taslimu baadaye · FORGIVEN = limesamehewa. Wallet haiguswi. */
export async function clearDebt(adminId: string, rideId: string, how: 'CASH' | 'FORGIVEN', note: string) {
  const r = await transaction(async (client) => {
    const r = await one<FareRide>(client, 'SELECT * FROM naya.rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!r || r.fare_settlement !== 'DEBT') throw notFound('Deni halikupatikana');
    if (r.debt_cleared_at) throw conflict('Deni hili limeshaondolewa.');
    const pending = await one(
      client,
      `SELECT 1 FROM naya.payments WHERE user_id = $3 AND kind = 'RIDE_FARE' AND status = 'PENDING' AND meta->'rideIds' ? $1
          AND created_at > now() - make_interval(mins => $2::int)`,
      [rideId, PENDING_HOLD_MINUTES, r.passenger_id],
    );
    if (pending) throw conflict('Abiria analipa deni hili kwa simu sasa hivi — subiri dakika chache.');
    await client.query(
      `UPDATE naya.rides SET debt_cleared_at = now(), debt_cleared_how = $2, debt_cleared_by = $3, debt_note = $4, updated_at = now() WHERE id = $1`,
      [rideId, how, adminId, note.slice(0, 200)],
    );
    await writeAudit(client, { actorId: adminId, action: how === 'CASH' ? 'ride_debt.cash' : 'ride_debt.forgiven', targetType: 'ride', targetId: rideId, details: { note } });
    return r;
  });
  await notify({
    userId: r.passenger_id,
    event: 'account',
    kind: 'ride_debt_cleared',
    title: 'Deni limeondolewa',
    body: `Ofisi ya NAYA imeondoa deni la safari yako (${how === 'CASH' ? 'umelipa taslimu' : 'limesamehewa'}). Unaweza kuagiza safari.`,
  });
  return listDebts(true);
}

// ------------------------------------------------------------------ marejesho (0.22.1)

/** Ofisi: safari zilizolipwa kwa simu kisha zikaghairiwa / hazikupata dereva → abiria arudishiwe pesa. */
export async function listRefunds(open: boolean) {
  return many(
    db,
    `SELECT r.id, r.status, r.cancelled_at AS "cancelledAt", r.requested_at AS "requestedAt", r.pickup_name AS "from", r.dest_name AS "to",
            r.cancelled_by AS "cancelledBy", p.amount, p.phone, p.network, p.reference, p.provider_ref AS "providerRef",
            u.id AS "passengerId", u.full_name AS "passengerName", u.phone AS "passengerPhone",
            r.fare_refund AS state, r.fare_refund_at AS "doneAt", r.fare_refund_note AS note, c.full_name AS "doneBy"
       FROM naya.rides r JOIN naya.payments p ON p.id = r.fare_payment_id JOIN naya.users u ON u.id = r.passenger_id
       LEFT JOIN naya.users c ON c.id = r.fare_refund_by
      WHERE r.fare_refund IS NOT NULL AND ($1::boolean IS FALSE OR r.fare_refund = 'NEEDED')
      ORDER BY (r.fare_refund = 'NEEDED') DESC, coalesce(r.cancelled_at, r.requested_at) DESC LIMIT 300`,
    [open],
  );
}

/** Ofisi: imemrudishia abiria pesa (kwa Abliner → Send) — inaandika kumbukumbu. */
export async function markRefunded(adminId: string, rideId: string, note: string) {
  const r = await transaction(async (client) => {
    const r = await one<{ passenger_id: string; fare_refund: string | null }>(client, 'SELECT passenger_id, fare_refund FROM naya.rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!r || !r.fare_refund) throw notFound('Marejesho hayakupatikana');
    if (r.fare_refund === 'DONE') throw conflict('Pesa hii imeshaandikwa kurudishwa.');
    await client.query(
      `UPDATE naya.rides SET fare_refund = 'DONE', fare_refund_at = now(), fare_refund_by = $2, fare_refund_note = $3, updated_at = now() WHERE id = $1`,
      [rideId, adminId, note.slice(0, 200)],
    );
    await writeAudit(client, { actorId: adminId, action: 'ride_fare.refunded', targetType: 'ride', targetId: rideId, details: { note } });
    return r;
  });
  await notify({
    userId: r.passenger_id,
    event: 'account',
    kind: 'ride_fare_refunded',
    title: 'Pesa yako imerudishwa',
    body: 'Ofisi ya NAYA imekurudishia pesa uliyolipa kwa safari ambayo haikufanyika.',
    sms: 'NAYA: Tumekurudishia pesa uliyolipa kwa safari ambayo haikufanyika. Angalia simu yako. Samahani kwa usumbufu.',
  });
  return listRefunds(true);
}

// ------------------------------------------------------------------ salio la abiria (0.23.0)

/** Abiria: weka pesa kwenye salio (ombi la PIN). Ada ni ileile ya nauli kwa simu (juu ya kiasi). */
export async function startCustomerTopup(userId: string, input: { amount: number; phone: string; network?: string | null }) {
  const s = await getRidePaySettings();
  const paymentId = await startTopup(userId, input, {
    feeOf: (amount) => fareFee(s, amount),
    insert: (client, p) => insertPayment(client, { kind: 'CUSTOMER_TOPUP', direction: 'IN', ...p }),
    collect: async (id) => {
      const pay = (await one<PaymentRow>(db, 'SELECT * FROM naya.payments WHERE id = $1', [id]))!;
      return startCollect(userId, pay, 'NAYA kuweka salio');
    },
  });
  return myPayment(userId, paymentId);
}

export async function topupFee(amount: number) {
  return fareFee(await getRidePaySettings(), amount);
}

/**
 * Abiria: lipa nauli ya safari kwa salio (dereva akishakubali → mpaka ikamilike, au saa 24 baada ya kukamilika).
 * Safari ikiwa imekamilika → dereva anapata papo hapo; ikiendelea → creditPrepaidFare ikikamilika.
 * Mpangilio wa kufunga: dereva → safari → salio la abiria → wallet ya dereva.
 */
export async function payRideFromWallet(passengerId: string, rideId: string) {
  const cws = await getCustomerWalletSettings();
  if (!cws.enabled) throw conflict('Wallet ya NAYA haijawashwa kwa sasa.');
  const out = await transaction(async (client) => {
    const who = await one<{ driver_id: string | null }>(client, 'SELECT driver_id FROM naya.rides WHERE id = $1', [rideId]);
    if (who?.driver_id) await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [who.driver_id]);
    const r = await one<FareRide>(client, 'SELECT * FROM naya.rides WHERE id = $1 FOR UPDATE', [rideId]);
    if (!r || r.passenger_id !== passengerId) throw notFound('Safari haikupatikana');
    if (r.status !== 'COMPLETED' && !PAY_EARLY.includes(r.status)) {
      throw conflict(r.status === 'SEARCHING' ? 'Utaweza kulipa dereva akishakubali safari.' : 'Safari hii haipo tena.');
    }
    if (r.fare_settlement) throw conflict(r.fare_settlement === 'CASH' ? 'Dereva ameandika kwamba umelipa taslimu.' : 'Safari hii imeshalipwa.');
    if (r.status === 'COMPLETED' && !withinWindow(r)) throw conflict('Muda wa kulipa safari hii umepita.');
    if (r.driver_id !== who?.driver_id) throw conflict('Safari imebadilika — jaribu tena.');
    const due = Math.max(0, r.fare - r.promo_discount);
    if (due <= 0) throw conflict('Safari hii haina cha kulipa.');
    const pays = await ridePayments(client, r);
    if (pays.some(isPending)) throw conflict('Ombi la kulipa kwa simu linasubiri — subiri lithibitishwe kwanza.');
    if (pays.some((p) => p.status === 'SUCCESS')) throw conflict('Safari hii imeshalipwa kwa simu.');
    const w = await lockCustomerWallet(client, passengerId);
    if (w.status !== 'ACTIVE') throw conflict('Wallet yako imesimamishwa na ofisi ya NAYA.');
    if (w.cashout_requested_at) throw conflict('Una ombi la kurudishiwa salio — ghairi ombi hilo kwanza ndipo ulipe kwa salio.');
    if (w.balance < due) throw conflict(`Salio lako (${tsh(w.balance)}) halitoshi kulipa ${tsh(due)}. Weka pesa au lipa kwa simu.`);
    await postCustomerEntry(client, passengerId, { amount: -due, kind: 'RIDE_PAYMENT', rideId, note: `${r.status === 'COMPLETED' ? 'Nauli' : 'Nauli (mapema)'}` });
    await client.query(`UPDATE naya.rides SET fare_settlement = 'WALLET', fare_settled_at = now(), updated_at = now() WHERE id = $1`, [rideId]);
    let credited = false;
    if (r.status === 'COMPLETED' && r.driver_id) {
      await lockWallet(client, r.driver_id);
      await postEntry(client, r.driver_id, { amount: due, kind: 'RIDE_EARNING', rideId, note: 'Nauli — abiria alilipa kwa salio la NAYA' });
      credited = true;
    }
    return { driverId: r.driver_id, due, credited };
  });
  if (out.driverId) {
    await notify({
      userId: out.driverId,
      event: 'driver',
      rideId,
      kind: out.credited ? 'ride_fare_wallet' : 'ride_fare_prepaid',
      title: 'Abiria amelipa kwa salio la NAYA',
      body: out.credited ? `${tsh(out.due)} ya nauli imeingia kwenye wallet yako.` : 'Usimdai nauli. Pesa itaingia kwenye wallet yako ukimaliza safari.',
    });
  }
  await notify({ userId: passengerId, event: 'ride', rideId });
  return { paid: out.due };
}

/** Abiria: lipa deni lote kwa salio — kila dereva aliyemdai anapata kwenye wallet yake papo hapo. */
export async function payDebtFromWallet(passengerId: string) {
  const cws = await getCustomerWalletSettings();
  if (!cws.enabled) throw conflict('Wallet ya NAYA haijawashwa kwa sasa.');
  const credited = await transaction(async (client) => {
    await client.query('SELECT 1 FROM naya.users WHERE id = $1 FOR UPDATE', [passengerId]);
    const list = await many<{ id: string; driver_id: string | null }>(
      client,
      `SELECT id, driver_id FROM naya.rides WHERE passenger_id = $1 AND fare_settlement = 'DEBT' AND debt_cleared_at IS NULL`,
      [passengerId],
    );
    if (!list.length) throw conflict('Huna deni.');
    list.sort((x, y) => (x.driver_id ?? '').localeCompare(y.driver_id ?? '') || x.id.localeCompare(y.id));
    const rides: { id: string; driverId: string | null; due: number }[] = [];
    for (const it of list) {
      const hasDriver = it.driver_id ? !!(await one(client, 'SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [it.driver_id])) : false;
      const r = await one<FareRide>(client, 'SELECT * FROM naya.rides WHERE id = $1 FOR UPDATE', [it.id]);
      if (!r || r.fare_settlement !== 'DEBT' || r.debt_cleared_at) continue;
      rides.push({ id: r.id, driverId: hasDriver ? r.driver_id : null, due: Math.max(0, r.fare - r.promo_discount) });
    }
    const total = rides.reduce((t, r) => t + r.due, 0);
    if (total <= 0) throw conflict('Huna deni.');
    const pending = await one(
      client,
      `SELECT 1 FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' AND meta->>'purpose' = 'DEBT' AND status = 'PENDING' AND created_at > now() - interval '3 minutes'`,
      [passengerId],
    );
    if (pending) throw conflict('Ombi la kulipa deni kwa simu linasubiri — subiri lithibitishwe kwanza.');
    const w = await lockCustomerWallet(client, passengerId);
    if (w.status !== 'ACTIVE') throw conflict('Wallet yako imesimamishwa na ofisi ya NAYA.');
    if (w.cashout_requested_at) throw conflict('Una ombi la kurudishiwa salio — ghairi ombi hilo kwanza ndipo ulipe kwa salio.');
    if (w.balance < total) throw conflict(`Salio lako (${tsh(w.balance)}) halitoshi kulipa deni la ${tsh(total)}.`);
    const out: { rideId: string; driverId: string; amount: number }[] = [];
    for (const r of rides) {
      if (r.due > 0) await postCustomerEntry(client, passengerId, { amount: -r.due, kind: 'DEBT_PAYMENT', rideId: r.id, note: 'Deni la nauli' });
      await client.query(`UPDATE naya.rides SET debt_cleared_at = now(), debt_cleared_how = 'WALLET', updated_at = now() WHERE id = $1`, [r.id]);
      if (r.driverId && r.due > 0) {
        await lockWallet(client, r.driverId);
        await postEntry(client, r.driverId, { amount: r.due, kind: 'RIDE_EARNING', rideId: r.id, note: 'Deni la abiria limelipwa kwa salio la NAYA' });
        out.push({ rideId: r.id, driverId: r.driverId, amount: r.due });
      }
    }
    return out;
  });
  for (const c of credited) {
    await notify({ userId: c.driverId, event: 'driver', rideId: c.rideId, kind: 'ride_fare_wallet', title: 'Deni la abiria limelipwa', body: `${tsh(c.amount)} (deni la safari iliyopita) imeingia kwenye wallet yako ya NAYA.` });
  }
  await notifyAdmins();
  return myDebt(passengerId);
}
