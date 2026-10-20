// Wallet ya abiria — "NAYA Salio" (0.23.0)
//   - Abiria anaweka pesa kwa simu (ombi la PIN; ada ya kupokea pesa juu, sawa na nauli kwa simu). Salio linaongezeka
//     tu baada ya kampuni ya malipo kuthibitisha (applyResult → creditTopup).
//   - Kikomo cha salio (chaguo-msingi TSh 15,000). Salio linatumika ndani ya NAYA tu: nauli (dereva akishakubali) na deni.
//   - Safari iliyolipwa kwa salio ikighairiwa / kukosa dereva → pesa inarudi kwenye salio papo hapo.
//   - Abiria akiomba kurudishiwa salio → ofisi inamtumia kwa Abliner (kwa mkono) kisha inaandika hapa.
// Kila badiliko = mstari mmoja wa ledger, safu ya wallet ikiwa imefungwa (FOR UPDATE); database inakataa salio hasi.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';
import { getProvider, guessNetwork, type MobileNetwork } from './payments/provider.js';

export type CwKind = 'TOPUP' | 'RIDE_PAYMENT' | 'RIDE_REFUND' | 'DEBT_PAYMENT' | 'CASHOUT' | 'ADJUSTMENT' | 'REFUND';

export interface CustomerWalletSettings {
  enabled: boolean;
  maxBalance: number;
  minTopup: number;
}
export const CW_DEFAULTS: CustomerWalletSettings = { enabled: false, maxBalance: 15000, minTopup: 500 };
const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;

export async function getCustomerWalletSettings(client: Db = db): Promise<CustomerWalletSettings> {
  const row = await one<{ value: Partial<CustomerWalletSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'customer_wallet'`);
  return { ...CW_DEFAULTS, ...(row?.value ?? {}) };
}

export async function saveCustomerWalletSettings(adminId: string, partial: Partial<CustomerWalletSettings>) {
  return transaction(async (client) => {
    const before = await getCustomerWalletSettings(client);
    const after: CustomerWalletSettings = { ...before, ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)) };
    if (after.minTopup > after.maxBalance) throw badRequest('Kiwango cha chini cha kuweka kisizidi kikomo cha salio.');
    if (after.enabled && !getProvider()) throw conflict('Kampuni ya malipo haijaunganishwa — wallet ya abiria haiwezi kuwashwa.');
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('customer_wallet', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(after), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.customer_wallet', targetType: 'settings', targetId: null, details: { before, after } });
    return after;
  });
}

/** Ndani ya transaction: funga salio la abiria (lifungue kwanza kama halipo). */
export async function lockCustomerWallet(client: Db, userId: string) {
  await client.query('INSERT INTO naya.customer_wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  return (await one<{ balance: number; status: string; cashout_requested_at: Date | null }>(
    client,
    'SELECT balance, status, cashout_requested_at FROM naya.customer_wallets WHERE user_id = $1 FOR UPDATE',
    [userId],
  ))!;
}

/** Mstari wa ledger. LAZIMA salio liwe limefungwa (lockCustomerWallet) ndani ya transaction hii. */
export async function postCustomerEntry(
  client: Db,
  userId: string,
  e: { amount: number; kind: CwKind; rideId?: string | null; paymentId?: string | null; note?: string | null; createdBy?: string | null },
) {
  try {
    const w = await one<{ balance: number }>(
      client,
      'UPDATE naya.customer_wallets SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance',
      [userId, e.amount],
    );
    await client.query(
      `INSERT INTO naya.customer_wallet_entries (user_id, amount, balance_after, kind, ride_id, payment_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, e.amount, w!.balance, e.kind, e.rideId ?? null, e.paymentId ?? null, e.note?.slice(0, 300) ?? null, e.createdBy ?? null],
    );
    return w!.balance;
  } catch (error) {
    if ((error as { code?: string })?.code === '23514') throw conflict('Salio lako halitoshi.');
    throw error;
  }
}

const LABEL: Record<CwKind, string> = {
  TOPUP: 'Umeweka pesa',
  RIDE_PAYMENT: 'Nauli ya safari',
  RIDE_REFUND: 'Safari haikufanyika — imerudi',
  DEBT_PAYMENT: 'Deni la nauli',
  CASHOUT: 'Umerudishiwa salio',
  ADJUSTMENT: 'Marekebisho ya ofisi',
  REFUND: 'Umerudishiwa na NAYA',
};

/** Kwa skrini ya safari: wallet ya abiria imewashwa na salio lake. */
export async function customerWalletBrief(client: Db, userId: string) {
  const s = await getCustomerWalletSettings(client);
  if (!s.enabled) return { enabled: false, balance: 0 };
  const w = await one<{ balance: number; status: string }>(client, 'SELECT balance, status FROM naya.customer_wallets WHERE user_id = $1', [userId]);
  return { enabled: (w?.status ?? 'ACTIVE') === 'ACTIVE', balance: w?.balance ?? 0 };
}

/** Abiria: salio, kikomo, ombi linalosubiri, historia. */
export async function myCustomerWallet(userId: string) {
  const s = await getCustomerWalletSettings();
  const [w, entries, pending] = await Promise.all([
    one<{ balance: number; status: string; cashout_requested_at: Date | null; cashout_phone: string | null }>(
      db,
      'SELECT balance, status, cashout_requested_at, cashout_phone FROM naya.customer_wallets WHERE user_id = $1',
      [userId],
    ),
    many<{ id: string; amount: number; balance_after: number; kind: CwKind; note: string | null; created_at: Date; ride_id: string | null }>(
      db,
      'SELECT id, amount, balance_after, kind, note, created_at, ride_id FROM naya.customer_wallet_entries WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
      [userId],
    ),
    one<{ id: string; phone: string; amount: number; meta: { credit?: number } }>(
      db,
      `SELECT id, phone, amount, meta FROM naya.payments WHERE user_id = $1 AND kind = 'CUSTOMER_TOPUP' AND status = 'PENDING'
          AND created_at > now() - interval '3 minutes' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    ),
  ]);
  const balance = w?.balance ?? 0;
  const room = Math.max(0, s.maxBalance - balance);
  return {
    enabled: s.enabled,
    status: w?.status ?? 'ACTIVE',
    balance,
    maxBalance: s.maxBalance,
    minTopup: s.minTopup,
    room,
    pending: pending ? { id: pending.id, phone: pending.phone, amount: pending.amount, credit: pending.meta?.credit ?? null } : null,
    cashout: w?.cashout_requested_at ? { requestedAt: w.cashout_requested_at, phone: w.cashout_phone } : null,
    entries: entries.map((e) => ({ id: e.id, amount: e.amount, balanceAfter: e.balance_after, kind: e.kind, label: LABEL[e.kind], note: e.note, createdAt: e.created_at, rideId: e.ride_id })),
  };
}

/** Abiria: kiasi kitakacholipwa (kiasi + ada) — kabla ya kuweka pesa. */
export function topupQuote(s: CustomerWalletSettings, balance: number, amount: number, feeOf: (amount: number) => number) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Weka kiasi');
  if (amount < s.minTopup) throw badRequest(`Kiwango cha chini cha kuweka ni ${tsh(s.minTopup)}.`);
  const room = Math.max(0, s.maxBalance - balance);
  if (amount > room) {
    throw conflict(room > 0 ? `Salio lisizidi ${tsh(s.maxBalance)} — unaweza kuweka hadi ${tsh(room)}.` : `Salio lako limefika kikomo cha ${tsh(s.maxBalance)}.`);
  }
  const fee = feeOf(amount);
  return { amount, fee, total: amount + fee };
}

/**
 * Abiria: weka pesa (ombi la PIN linaenda kwenye simu). `collect` / `insert` ni za payments/index.ts (zinapitishwa
 * ili moduli hii isitegemee payments moja kwa moja — hakuna mzunguko wa imports).
 */
export async function startTopup(
  userId: string,
  input: { amount: number; phone: string; network?: string | null },
  deps: {
    feeOf: (amount: number) => number;
    insert: (client: Db, p: { userId: string; amount: number; network: MobileNetwork; phone: string; provider: string; meta: object }) => Promise<{ id: string; reference: string; amount: number }>;
    collect: (paymentId: string, reference: string, amount: number, phone: string, network: MobileNetwork) => Promise<unknown>;
  },
) {
  const s = await getCustomerWalletSettings();
  const provider = getProvider();
  if (!s.enabled || !provider) throw conflict('Wallet ya NAYA haijawashwa kwa sasa.');
  const network = (input.network as MobileNetwork | undefined) ?? guessNetwork(input.phone);
  if (!network) throw badRequest('Hatukutambua mtandao wa namba hii. Chagua mtandao (M-Pesa, Mixx, Airtel, HaloPesa).');
  const payment = await transaction(async (client) => {
    const w = await lockCustomerWallet(client, userId);
    if (w.status !== 'ACTIVE') throw conflict('Wallet yako imesimamishwa na ofisi ya NAYA.');
    if (w.cashout_requested_at) throw conflict('Una ombi la kurudishiwa salio — ghairi ombi hilo kwanza ndipo uweke pesa.');
    // Maombi yanayosubiri (hadi dakika 15 — muda wa ombi la PIN) yanahesabiwa kwenye kikomo cha salio
    const waiting = await one<{ amount: number; recent: number }>(
      client,
      `SELECT coalesce(sum((meta->>'credit')::int), 0)::int AS amount,
              count(*) FILTER (WHERE created_at > now() - interval '3 minutes')::int AS recent
         FROM naya.payments WHERE user_id = $1 AND kind = 'CUSTOMER_TOPUP' AND status = 'PENDING' AND created_at > now() - interval '15 minutes'`,
      [userId],
    );
    if ((waiting?.recent ?? 0) > 0) throw conflict('Ombi la kuweka pesa linasubiri — angalia simu yako na uweke PIN.');
    const q = topupQuote(s, w.balance + (waiting?.amount ?? 0), input.amount, deps.feeOf);
    return deps.insert(client, { userId, amount: q.total, network, phone: input.phone, provider: provider.name, meta: { credit: q.amount, fee: q.fee } });
  });
  await deps.collect(payment.id, payment.reference, payment.amount, input.phone, network);
  return payment.id;
}

/** Ndani ya applyResult (muamala umefungwa): kuweka pesa kumethibitishwa → salio linaongezeka (mara moja tu). */
export async function creditTopup(client: Db, p: { id: string; user_id: string; meta: { credit?: number } }) {
  const credit = Math.max(0, Math.round(p.meta.credit ?? 0));
  if (credit <= 0) return null;
  await lockCustomerWallet(client, p.user_id);
  const balance = await postCustomerEntry(client, p.user_id, { amount: credit, kind: 'TOPUP', paymentId: p.id, note: 'Kuweka pesa kwa simu' });
  return { credit, balance };
}

export async function afterTopup(userId: string, credit: number, balance: number) {
  await notify({
    userId,
    event: 'account',
    kind: 'customer_topup',
    title: 'Pesa imeingia kwenye salio',
    body: `${tsh(credit)} imeingia kwenye salio lako la NAYA. Salio: ${tsh(balance)}.`,
  });
}

/**
 * Safari iliyolipwa kwa salio imeghairiwa / haikupata dereva → kiasi kinarudi kwenye salio (mara moja tu).
 * Ndani ya transaction ya kughairi (safari imefungwa) — mpangilio: safari → salio.
 */
export async function refundRideToWallet(client: Db, rideId: string, passengerId: string) {
  const paid = await one<{ amount: number }>(client, `SELECT amount FROM naya.customer_wallet_entries WHERE kind = 'RIDE_PAYMENT' AND ride_id = $1`, [rideId]);
  if (!paid) return 0;
  if (await one(client, `SELECT 1 FROM naya.customer_wallet_entries WHERE kind = 'RIDE_REFUND' AND ride_id = $1`, [rideId])) return 0;
  await lockCustomerWallet(client, passengerId);
  await postCustomerEntry(client, passengerId, { amount: -paid.amount, kind: 'RIDE_REFUND', rideId, note: 'Safari haikufanyika — nauli imerudi' });
  await client.query(
    `UPDATE naya.rides SET fare_refund = 'DONE', fare_refund_at = now(), fare_refund_note = 'Imerudi kwenye salio la abiria', updated_at = now() WHERE id = $1`,
    [rideId],
  );
  return -paid.amount;
}

/** Abiria: omba kurudishiwa salio lililobaki (ofisi inatuma kwa mkono). */
export async function requestCashout(userId: string, phone: string) {
  await transaction(async (client) => {
    const w = await lockCustomerWallet(client, userId);
    if (w.balance <= 0) throw conflict('Huna salio la kurudishiwa.');
    if (w.cashout_requested_at) throw conflict('Ombi lako la kurudishiwa salio limeshapokelewa.');
    await client.query('UPDATE naya.customer_wallets SET cashout_requested_at = now(), cashout_phone = $2, updated_at = now() WHERE user_id = $1', [userId, phone]);
    await writeAudit(client, { actorId: userId, action: 'customer_wallet.cashout_requested', targetType: 'user', targetId: userId, details: { phone } });
  });
  await notifyAdmins();
  return { requested: true };
}

export async function cancelCashout(userId: string) {
  await transaction(async (client) => {
    await lockCustomerWallet(client, userId);
    await client.query('UPDATE naya.customer_wallets SET cashout_requested_at = NULL, cashout_phone = NULL, updated_at = now() WHERE user_id = $1', [userId]);
  });
  return { cancelled: true };
}

// ------------------------------------------------------------------ ofisi

export async function customerWalletsSummary() {
  const [s, t, requests] = await Promise.all([
    getCustomerWalletSettings(),
    one<{ total: number; holders: number; requests: number }>(
      db,
      `SELECT coalesce(sum(balance), 0)::bigint::float8 AS total, count(*) FILTER (WHERE balance > 0)::int AS holders,
              count(*) FILTER (WHERE cashout_requested_at IS NOT NULL)::int AS requests FROM naya.customer_wallets`,
    ),
    many(
      db,
      `SELECT w.user_id AS id, u.full_name AS name, u.phone, w.balance, w.cashout_requested_at AS "requestedAt", w.cashout_phone AS "cashoutPhone"
         FROM naya.customer_wallets w JOIN naya.users u ON u.id = w.user_id
        WHERE w.cashout_requested_at IS NOT NULL ORDER BY w.cashout_requested_at LIMIT 200`,
    ),
  ]);
  return { settings: s, providerReady: !!getProvider(), total: t?.total ?? 0, holders: t?.holders ?? 0, requests: t?.requests ?? 0, cashouts: requests };
}

/**
 * Ofisi: imemtumia abiria pesa kutoka salio lake (Abliner → Send). Kiasi ni KILE ofisi ilichotuma (si salio la wakati huo);
 * kikizidi salio → kukataliwa. Inafanya kazi hata abiria akighairi ombi wakati ofisi inatuma.
 */
export async function markCashoutDone(adminId: string, userId: string, amount: number, note: string) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Weka kiasi ulichotuma.');
  const out = await transaction(async (client) => {
    const w = await lockCustomerWallet(client, userId);
    if (amount > w.balance) throw conflict(`Kiasi (${tsh(amount)}) kinazidi salio la abiria (${tsh(w.balance)}).`);
    const balance = await postCustomerEntry(client, userId, { amount: -amount, kind: 'CASHOUT', note: `Ofisi: ${note}`, createdBy: adminId });
    await client.query('UPDATE naya.customer_wallets SET cashout_requested_at = NULL, cashout_phone = NULL, updated_at = now() WHERE user_id = $1', [userId]);
    await writeAudit(client, { actorId: adminId, action: 'customer_wallet.cashout_done', targetType: 'user', targetId: userId, details: { amount, note } });
    return balance;
  });
  await notify({
    userId,
    event: 'account',
    kind: 'customer_cashout',
    title: 'Salio limerudishwa',
    body: `Ofisi ya NAYA imekutumia ${tsh(amount)} kutoka salio lako. Salio sasa: ${tsh(out)}.`,
    sms: `NAYA: Tumekutumia ${tsh(amount)} kutoka Salio lako la NAYA kwenda kwenye simu yako. Salio sasa: ${tsh(out)}.`,
  });
  return customerWalletsSummary();
}

/**
 * Ndani ya applyResult (muamala umefungwa): malipo ya simu ya nauli yaliyothibitishwa baada ya safari kulipwa tayari
 * (kwa salio / taslimu / simu nyingine) → pesa ya abiria inawekwa kwenye salio lake (mara moja tu — kwa payment_id).
 */
export async function creditOverpayment(client: Db, userId: string, paymentId: string, amount: number, why: string) {
  if (amount <= 0) return null;
  await lockCustomerWallet(client, userId);
  return postCustomerEntry(client, userId, { amount, kind: 'TOPUP', paymentId, note: why });
}

/** Ofisi: marekebisho ya salio la abiria (kwa sababu). */
export async function adjustCustomerWallet(adminId: string, userId: string, input: { amount: number; reason: string }) {
  if (!input.amount || Math.abs(input.amount) > 100_000) throw badRequest('Kiasi si sahihi.');
  const user = await one(db, `SELECT 1 FROM naya.users WHERE id = $1 AND role = 'USER'`, [userId]);
  if (!user) throw notFound('Mtumiaji hakupatikana');
  await transaction(async (client) => {
    await lockCustomerWallet(client, userId);
    await postCustomerEntry(client, userId, { amount: input.amount, kind: 'ADJUSTMENT', note: input.reason, createdBy: adminId });
    await writeAudit(client, { actorId: adminId, action: 'customer_wallet.adjusted', targetType: 'user', targetId: userId, details: input });
  });
  return customerWalletsSummary();
}

