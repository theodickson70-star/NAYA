// Ofisi kumrudishia mteja pesa (0.24.0)
//   - Kwenye Salio la NAYA: papo hapo, bila ada (mstari wa REFUND kwenye ledger ya abiria).
//   - Kwenye namba ya simu: Abliner inatuma (NAYA inabeba ada ya kutuma); "imerudishwa" ni pale tu mtandao unapothibitisha.
//   - Kila marejesho: sababu + maelezo + (si lazima) safari husika; yanaandikwa kwenye audit na mteja anajulishwa.
//   - Kinga: kiasi kwa marejesho moja na jumla ya simu kwa siku (mipangilio), na kwa safari moja hakizidi alicholipa.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { lockCustomerWallet, postCustomerEntry } from './customer-wallet.js';
import { notify, notifyAdmins } from './notify.js';
import { insertPayment, sendRefund } from './payments/index.js';
import { getProvider, guessNetwork, type MobileNetwork } from './payments/provider.js';
import { NETWORK_LABEL, type Network } from './promotions.js';

export const REFUND_REASONS = ['DOUBLE_CHARGE', 'RIDE_NOT_DONE', 'BAD_SERVICE', 'OVERCHARGED', 'COMPENSATION', 'OTHER'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const REASON_LABEL: Record<RefundReason, string> = {
  DOUBLE_CHARGE: 'Alikatwa mara mbili',
  RIDE_NOT_DONE: 'Safari haikufanyika',
  BAD_SERVICE: 'Huduma mbovu',
  OVERCHARGED: 'Alitozwa zaidi',
  COMPENSATION: 'Fidia / zawadi ya ofisi',
  OTHER: 'Sababu nyingine',
};

export interface RefundSettings {
  /** Kiasi cha juu kwa marejesho moja (TSh) */
  maxPerRefund: number;
  /** Jumla ya marejesho kwa simu kwa siku (TSh) — kinga ya pesa nyingi kutoka kwa muda mfupi */
  dailyPhoneCap: number;
}
export const REFUND_DEFAULTS: RefundSettings = { maxPerRefund: 50_000, dailyPhoneCap: 200_000 };
const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;
const TZ_DAY = `(date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam')`;

export async function getRefundSettings(client: Db = db): Promise<RefundSettings> {
  const row = await one<{ value: Partial<RefundSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'refunds'`);
  return { ...REFUND_DEFAULTS, ...(row?.value ?? {}) };
}

export async function saveRefundSettings(adminId: string, partial: Partial<RefundSettings>) {
  return transaction(async (client) => {
    const before = await getRefundSettings(client);
    const after: RefundSettings = { ...before, ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)) };
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('refunds', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(after), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.refunds', targetType: 'settings', targetId: null, details: { before, after } });
    return after;
  });
}

/** Mteja alilipa kiasi gani kwa safari hii, na amesharudishiwa kiasi gani (salio + simu isiyoshindwa). */
async function rideMoney(client: Db, rideId: string, userId: string) {
  const r = await one<{ passenger_id: string; fare: number; promo_discount: number; fare_settlement: string | null; fare_payment_id: string | null; status: string }>(
    client,
    'SELECT passenger_id, fare, promo_discount, fare_settlement, fare_payment_id, status FROM naya.rides WHERE id = $1 FOR UPDATE',
    [rideId],
  );
  if (!r || r.passenger_id !== userId) throw notFound('Safari hii si ya mteja huyu.');
  const due = Math.max(0, r.fare - r.promo_discount);
  let paid = 0;
  if (r.fare_settlement === 'MOBILE' && r.fare_payment_id) {
    paid = (await one<{ amount: number }>(client, `SELECT amount FROM naya.payments WHERE id = $1 AND status = 'SUCCESS'`, [r.fare_payment_id]))?.amount ?? 0;
  } else if (r.fare_settlement === 'WALLET') {
    paid = (await one<{ amount: number }>(client, `SELECT -amount AS amount FROM naya.customer_wallet_entries WHERE kind = 'RIDE_PAYMENT' AND ride_id = $1`, [rideId]))?.amount ?? 0;
  } else if (r.status === 'COMPLETED') {
    paid = due; // taslimu / deni lililolipwa — kiwango cha juu ni nauli yenyewe
  }
  const back = await one<{ total: number }>(
    client,
    `SELECT (coalesce((SELECT sum(amount) FROM naya.customer_wallet_entries WHERE ride_id = $1 AND kind IN ('REFUND', 'RIDE_REFUND')), 0)
           + coalesce((SELECT sum(amount) FROM naya.payments WHERE kind = 'CUSTOMER_REFUND' AND status <> 'FAILED' AND meta->>'rideId' = $1::text), 0))::int AS total`,
    [rideId],
  );
  return { paid, refunded: back?.total ?? 0 };
}

/** Ofisi → Wateja → mteja: salio, marejesho yaliyopita, safari zilizolipwa (za kuchagua), safari zinazosubiri kurudishiwa. */
export async function customerMoney(userId: string) {
  const user = await one<{ id: string; phone: string; role: string }>(db, 'SELECT id, phone, role FROM naya.users WHERE id = $1', [userId]);
  if (!user || user.role !== 'USER') throw notFound('Mtumiaji hakupatikana');
  const s = await getRefundSettings();
  const [wallet, entries, refunds, rides, today] = await Promise.all([
    one<{ balance: number; cashout_requested_at: Date | null }>(db, 'SELECT balance, cashout_requested_at FROM naya.customer_wallets WHERE user_id = $1', [userId]),
    many(
      db,
      `SELECT e.amount, e.balance_after AS "balanceAfter", e.kind, e.note, e.created_at AS "createdAt", u.full_name AS "createdBy"
         FROM naya.customer_wallet_entries e LEFT JOIN naya.users u ON u.id = e.created_by
        WHERE e.user_id = $1 ORDER BY e.id DESC LIMIT 15`,
      [userId],
    ),
    many(
      db,
      `SELECT p.id, p.amount, p.phone, p.network, p.status, p.reference, p.provider_ref AS "providerRef", p.failure_reason AS "failureReason",
              p.meta->>'reason' AS reason, p.meta->>'note' AS note, p.meta->>'rideId' AS "rideId", p.created_at AS "createdAt", u.full_name AS "createdBy"
         FROM naya.payments p LEFT JOIN naya.users u ON u.id = p.created_by
        WHERE p.user_id = $1 AND p.kind = 'CUSTOMER_REFUND' ORDER BY p.created_at DESC LIMIT 20`,
      [userId],
    ),
    many(
      db,
      `SELECT r.id, r.pickup_name AS "from", r.dest_name AS "to", r.status, r.completed_at AS "completedAt", r.requested_at AS "requestedAt",
              greatest(r.fare - r.promo_discount, 0)::int AS due, r.fare_settlement AS settlement, r.fare_refund AS "fareRefund",
              (SELECT amount FROM naya.payments p WHERE p.id = r.fare_payment_id AND p.status = 'SUCCESS') AS "paidByPhone"
         FROM naya.rides r WHERE r.passenger_id = $1 AND r.requested_at > now() - interval '60 days'
          AND (r.status = 'COMPLETED' OR r.fare_settlement IN ('MOBILE', 'WALLET'))
        ORDER BY r.requested_at DESC LIMIT 20`,
      [userId],
    ),
    one<{ total: number }>(db, `SELECT coalesce(sum(amount), 0)::int AS total FROM naya.payments WHERE kind = 'CUSTOMER_REFUND' AND status <> 'FAILED' AND created_at >= ${TZ_DAY}`),
  ]);
  const provider = getProvider();
  return {
    phone: user.phone,
    balance: wallet?.balance ?? 0,
    cashoutRequested: !!wallet?.cashout_requested_at,
    entries,
    refunds,
    rides,
    limits: { ...s, phoneLeftToday: Math.max(0, s.dailyPhoneCap - (today?.total ?? 0)) },
    canPhone: !!provider?.canDisburse,
    reasons: REFUND_REASONS.map((code) => ({ code, label: REASON_LABEL[code] })),
  };
}

/**
 * Ofisi: mrudishie mteja pesa.
 *   to = 'SALIO' → papo hapo kwenye Salio la NAYA · to = 'PHONE' → Abliner inatuma kwenye namba (NAYA inabeba ada).
 */
export async function refundCustomer(
  adminId: string,
  userId: string,
  input: { amount: number; to: 'SALIO' | 'PHONE'; phone?: string | null; network?: string | null; reason: RefundReason; note: string; rideId?: string | null },
) {
  const s = await getRefundSettings();
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw badRequest('Weka kiasi cha kurudisha.');
  if (input.amount > s.maxPerRefund) throw forbidden(`Kiasi kinazidi kikomo cha marejesho moja (${tsh(s.maxPerRefund)}). Msimamizi abadilishe kikomo kama ni lazima.`);
  const user = await one<{ id: string; phone: string; role: string; full_name: string }>(db, 'SELECT id, phone, role, full_name FROM naya.users WHERE id = $1', [userId]);
  if (!user || user.role !== 'USER') throw notFound('Mtumiaji hakupatikana');
  const label = REASON_LABEL[input.reason];
  const note = input.note.trim().slice(0, 250);

  if (input.to === 'SALIO') {
    const balance = await transaction(async (client) => {
      if (input.rideId) {
        const m = await rideMoney(client, input.rideId, userId);
        if (input.amount > m.paid - m.refunded) throw conflict(`Kwa safari hii mteja alilipa ${tsh(m.paid)} na amesharudishiwa ${tsh(m.refunded)} — unaweza kurudisha hadi ${tsh(Math.max(0, m.paid - m.refunded))}.`);
      }
      await lockCustomerWallet(client, userId);
      const b = await postCustomerEntry(client, userId, { amount: input.amount, kind: 'REFUND', rideId: input.rideId ?? null, note: `${label}: ${note}`, createdBy: adminId });
      if (input.rideId) {
        await client.query(
          `UPDATE naya.rides SET fare_refund = 'DONE', fare_refund_at = now(), fare_refund_by = $2, fare_refund_note = 'Imerudishwa kwenye salio la abiria', updated_at = now()
            WHERE id = $1 AND fare_refund = 'NEEDED'`,
          [input.rideId, adminId],
        );
      }
      await writeAudit(client, { actorId: adminId, action: 'customer.refund_salio', targetType: 'user', targetId: userId, details: { amount: input.amount, reason: input.reason, note, rideId: input.rideId ?? null } });
      return b;
    });
    await notify({
      userId,
      event: 'account',
      kind: 'customer_refund',
      title: 'Umerudishiwa pesa',
      body: `NAYA imekurudishia ${tsh(input.amount)} kwenye Salio lako la NAYA (${label}). Salio sasa: ${tsh(balance)}. Samahani kwa usumbufu.`,
      sms: `NAYA: Umerudishiwa ${tsh(input.amount)} kwenye Salio lako la NAYA. Salio sasa: ${tsh(balance)}. Litumie kulipia safari ijayo.`,
    });
    return customerMoney(userId);
  }

  const provider = getProvider();
  if (!provider?.canDisburse) throw conflict('Kampuni ya malipo haiwezi kutuma pesa kwa sasa — rudisha kwenye Salio la NAYA, au lipa kwa mkono.');
  const phone = input.phone || user.phone;
  const network = ((input.network as MobileNetwork | null) ?? guessNetwork(phone)) as MobileNetwork | null;
  if (!network) throw badRequest('Hatukutambua mtandao wa namba hii. Chagua mtandao.');
  const payment = await transaction(async (client) => {
    // Kinga ya jumla ya siku: maombi mawili sambamba hayawezi kupita kikomo (kufuli moja la mipangilio)
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('naya.customer_refund'))`);
    const today = await one<{ total: number }>(
      client,
      `SELECT coalesce(sum(amount), 0)::int AS total FROM naya.payments WHERE kind = 'CUSTOMER_REFUND' AND status <> 'FAILED' AND created_at >= ${TZ_DAY}`,
    );
    if ((today?.total ?? 0) + input.amount > s.dailyPhoneCap) {
      throw forbidden(`Kikomo cha marejesho kwa simu leo (${tsh(s.dailyPhoneCap)}) kitapitwa — zimebaki ${tsh(Math.max(0, s.dailyPhoneCap - (today?.total ?? 0)))}. Rudisha kwenye salio, au subiri kesho.`);
    }
    if (input.rideId) {
      const m = await rideMoney(client, input.rideId, userId);
      if (input.amount > m.paid - m.refunded) throw conflict(`Kwa safari hii mteja alilipa ${tsh(m.paid)} na amesharudishiwa ${tsh(m.refunded)} — unaweza kurudisha hadi ${tsh(Math.max(0, m.paid - m.refunded))}.`);
    }
    const p = await insertPayment(client, {
      kind: 'CUSTOMER_REFUND',
      direction: 'OUT',
      userId,
      amount: input.amount,
      network,
      phone,
      provider: provider.name,
      meta: { reason: input.reason, note, rideId: input.rideId ?? null },
      createdBy: adminId,
    });
    await writeAudit(client, {
      actorId: adminId,
      action: 'customer.refund_phone',
      targetType: 'user',
      targetId: userId,
      details: { amount: input.amount, phone, network, reason: input.reason, note, rideId: input.rideId ?? null, reference: p.reference },
    });
    return p;
  });
  await sendRefund(payment.id);
  await notifyAdmins();
  const now = await one<{ status: string; failure_reason: string | null }>(db, 'SELECT status, failure_reason FROM naya.payments WHERE id = $1', [payment.id]);
  return { ...(await customerMoney(userId)), last: { status: now?.status, failureReason: now?.failure_reason ?? null, to: `${NETWORK_LABEL[network as Network] ?? network} ${phone}` } };
}
