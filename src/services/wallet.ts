// Wallet ya dereva (0.21.0): salio, historia, PIN ya wallet, kutoa pesa, ada kwa salio, na usimamizi wa ofisi.
//
// Usalama:
//  - Kutoa kunaenda kwenye NAMBA KUU YA MALIPO ILIYOTHIBITISHWA KWA JINA (Name Lookup) tu — si namba nyingine yoyote.
//  - PIN ya tarakimu 4 inawekwa na dereva mwenyewe (bcrypt); ofisi haiioni. Makosa 5 → dakika 30; 10 → mpaka ofisi ifungue.
//  - Kubadilisha namba ya malipo au PIN iliyosahaulika → kutoa kunasubiri saa 24.
//  - Kiasi kinakatwa kwenye ledger KABLA ya kutuma; kampuni ikithibitisha kushindwa → kinarudi chote (mara moja tu).
//  - Jibu la kampuni likipotea → muamala unabaki "unasubiri"; hakuna kutuma mara ya pili.
import bcrypt from 'bcryptjs';
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';
import { STUCK_MINUTES, getAutoPayout, insertPayment, sendWithdrawal, walletOverview } from './payments/index.js';
import { getProvider, MOBILE_NETWORKS, type MobileNetwork } from './payments/provider.js';
import { NETWORK_LABEL, type Network } from './promotions.js';
import { creditSubscription, getSettings, subscriptionPaidMessage } from './subscriptions.js';
import { type DriverWalletSettings, getDriverWalletSettings, lockWallet, postEntry, WALLET_DEFAULTS, type WalletRow, ensureWallet } from './wallet-ledger.js';

const TZ = 'Africa/Dar_es_Salaam';
const PIN_ROUNDS = 10;
const LOCK_AFTER = 5;
const BLOCK_AFTER = 10;
const LOCK_MINUTES = 30;
const HOLD_HOURS = 24;
const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;
const phoneText = (p: string) => (p.length === 12 && p.startsWith('255') ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

const ENTRY_LABEL: Record<string, string> = {
  PROMO_EARNING: 'Malipo ya ofa',
  RIDE_EARNING: 'Safari (kwa simu)',
  WITHDRAWAL: 'Kutoa pesa',
  WITHDRAWAL_REVERSAL: 'Kutoa kumeshindwa — imerudi',
  SUBSCRIPTION: 'Ada ya mwezi',
  ADJUSTMENT: 'Marekebisho ya ofisi',
};

// ------------------------------------------------------------------ mipangilio (ofisi)

export async function saveDriverWalletSettings(adminId: string, partial: Partial<DriverWalletSettings>) {
  return transaction(async (client) => {
    const before = await getDriverWalletSettings(client);
    const next: DriverWalletSettings = { ...before, ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)) };
    if (next.minWithdraw < 500) throw badRequest('Kiwango cha chini cha kutoa kisiwe chini ya TSh 500.');
    if (next.dailyWithdrawLimit < next.minWithdraw) throw badRequest('Kikomo cha siku kiwe juu ya kiwango cha chini cha kutoa.');
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('driver_wallet', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(next), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.driver_wallet', targetType: 'settings', targetId: null, details: { before, after: next } });
    return next;
  });
}

// ------------------------------------------------------------------ PIN

/** PIN dhaifu zinazokisiwa kirahisi: tarakimu sawa, mfuatano, mifumo ya kawaida, au tarakimu 4 za mwisho za simu. */
export function weakPin(pin: string, phone?: string | null) {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const up = d.every((v, i) => i === 0 || v === (d[i - 1] + 1) % 10);
  const down = d.every((v, i) => i === 0 || v === (d[i - 1] + 9) % 10);
  if (up || down) return true;
  if (['1212', '2580', '0852', '1122', '1004', '2000', '1010', '2020', '6969', '1313', '7777'].includes(pin)) return true;
  if (phone && phone.slice(-4) === pin) return true;
  return false;
}
const PIN_RE = /^\d{4}$/;
function assertGoodPin(pin: string, phone: string) {
  if (!PIN_RE.test(pin)) throw badRequest('PIN iwe tarakimu 4.');
  if (weakPin(pin, phone)) throw badRequest('PIN hii ni rahisi kukisiwa (mf. 1234, 0000 au tarakimu za mwisho za simu yako). Chagua nyingine.');
}

const minutesLeft = (until: Date) => Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000));

/**
 * Hakiki PIN ya wallet. Makosa yanahifadhiwa (transaction yake yenyewe) hata ombi likikataliwa.
 * Inarudisha kawaida PIN ikiwa sahihi; vinginevyo inatupa kosa lenye ujumbe unaoeleweka.
 */
export async function verifyPin(driverId: string, pin: unknown) {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw badRequest('Weka PIN yako ya wallet (tarakimu 4).');
  const outcome = await transaction(async (client) => {
    const w = await lockWallet(client, driverId);
    if (!w.pin_hash) return { error: conflict('Tengeneza PIN ya wallet kwanza (Wallet yangu → Tengeneza PIN).') };
    if (w.pin_blocked) return { error: forbidden('Wallet imefungwa kwa makosa mengi ya PIN. Wasiliana na ofisi ya NAYA.') };
    if (w.pin_locked_until && new Date(w.pin_locked_until) > new Date()) {
      return { error: new AppError(423, `PIN imekosewa mara nyingi. Jaribu tena baada ya dakika ${minutesLeft(w.pin_locked_until)}.`) };
    }
    if (await bcrypt.compare(pin, w.pin_hash)) {
      if (w.pin_failed > 0) await client.query('UPDATE naya.wallets SET pin_failed = 0, pin_locked_until = NULL WHERE driver_id = $1', [driverId]);
      return { ok: true };
    }
    const failed = w.pin_failed + 1;
    const blocked = failed >= BLOCK_AFTER;
    const lock = !blocked && failed % LOCK_AFTER === 0;
    await client.query(
      `UPDATE naya.wallets SET pin_failed = $2, pin_blocked = $3,
              pin_locked_until = CASE WHEN $4::boolean THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE pin_locked_until END,
              updated_at = now() WHERE driver_id = $1`,
      [driverId, failed, blocked, lock],
    );
    if (blocked) {
      await writeAudit(client, { actorId: driverId, action: 'wallet.pin_blocked', targetType: 'driver', targetId: driverId, details: { failed } });
      return { error: forbidden('PIN imekosewa mara nyingi. Wallet imefungwa — wasiliana na ofisi ya NAYA.'), notifyOffice: true };
    }
    if (lock) return { error: new AppError(423, `PIN imekosewa mara ${LOCK_AFTER}. Jaribu tena baada ya dakika ${LOCK_MINUTES}.`) };
    return { error: badRequest(`PIN si sahihi. Umebakiza majaribio ${LOCK_AFTER - (failed % LOCK_AFTER)}.`) };
  });
  if ('error' in outcome && outcome.error) {
    if (outcome.notifyOffice) await notifyAdmins().catch(() => {});
    throw outcome.error;
  }
}

/** Tengeneza PIN (mara ya kwanza, au baada ya ofisi kuruhusu PIN mpya). Inahitaji password ya akaunti. */
export async function setPin(driverId: string, input: { pin: string; password: string }) {
  const user = await one<{ phone: string; password_hash: string }>(db, 'SELECT phone, password_hash FROM naya.users WHERE id = $1', [driverId]);
  if (!user) throw notFound('Akaunti haikupatikana');
  assertGoodPin(input.pin, user.phone);
  if (!(await bcrypt.compare(input.password, user.password_hash))) throw badRequest('Password ya akaunti si sahihi.');
  const hash = await bcrypt.hash(input.pin, PIN_ROUNDS);
  const reset = await transaction(async (client) => {
    const w = await lockWallet(client, driverId);
    if (w.pin_hash && !w.pin_reset_allowed_at) throw conflict('Tayari una PIN ya wallet. Tumia "Badilisha PIN", au "Nimesahau PIN".');
    const isReset = !!w.pin_hash;
    await client.query(
      `UPDATE naya.wallets SET pin_hash = $2, pin_set_at = now(), pin_failed = 0, pin_locked_until = NULL, pin_blocked = false,
              pin_reset_requested_at = NULL, pin_reset_allowed_at = NULL, pin_reset_allowed_by = NULL,
              hold_until = CASE WHEN $3::boolean THEN greatest(coalesce(hold_until, now()), now() + make_interval(hours => ${HOLD_HOURS})) ELSE hold_until END,
              hold_reason = CASE WHEN $3::boolean THEN 'PIN mpya ya wallet' ELSE hold_reason END,
              updated_at = now() WHERE driver_id = $1`,
      [driverId, hash, isReset],
    );
    await writeAudit(client, { actorId: driverId, action: isReset ? 'wallet.pin_reset' : 'wallet.pin_set', targetType: 'driver', targetId: driverId });
    return isReset;
  });
  if (reset) {
    await notify({
      userId: driverId,
      event: 'driver',
      kind: 'wallet_pin',
      title: 'PIN mpya ya wallet',
      body: `PIN mpya ya wallet imewekwa. Kwa usalama, kutoa pesa kutawezekana baada ya saa ${HOLD_HOURS}. Kama si wewe, piga simu ofisi ya NAYA sasa hivi.`,
      sms: `NAYA: PIN mpya ya wallet yako imewekwa. Kama si wewe, wasiliana na ofisi ya NAYA sasa hivi.`,
    });
  }
  return driverWallet(driverId);
}

export async function changePin(driverId: string, input: { oldPin: string; newPin: string }) {
  const user = await one<{ phone: string }>(db, 'SELECT phone FROM naya.users WHERE id = $1', [driverId]);
  assertGoodPin(input.newPin, user?.phone ?? '');
  if (input.oldPin === input.newPin) throw badRequest('PIN mpya iwe tofauti na ya zamani.');
  await verifyPin(driverId, input.oldPin);
  const hash = await bcrypt.hash(input.newPin, PIN_ROUNDS);
  await transaction(async (client) => {
    await lockWallet(client, driverId);
    await client.query('UPDATE naya.wallets SET pin_hash = $2, pin_set_at = now(), updated_at = now() WHERE driver_id = $1', [driverId, hash]);
    await writeAudit(client, { actorId: driverId, action: 'wallet.pin_changed', targetType: 'driver', targetId: driverId });
  });
  return driverWallet(driverId);
}

/** "Nimesahau PIN" → ombi kwa ofisi; ofisi ikithibitisha ni yeye, inaruhusu PIN mpya. */
export async function requestPinReset(driverId: string) {
  await transaction(async (client) => {
    const w = await lockWallet(client, driverId);
    if (!w.pin_hash) throw conflict('Bado hujaweka PIN — tengeneza PIN mpya moja kwa moja.');
    if (w.pin_reset_allowed_at) return;
    await client.query('UPDATE naya.wallets SET pin_reset_requested_at = coalesce(pin_reset_requested_at, now()), updated_at = now() WHERE driver_id = $1', [driverId]);
    await writeAudit(client, { actorId: driverId, action: 'wallet.pin_reset_requested', targetType: 'driver', targetId: driverId });
  });
  await notifyAdmins().catch(() => {});
  return driverWallet(driverId);
}

// ------------------------------------------------------------------ dereva: muhtasari

async function primaryAccount(client: Db, driverId: string) {
  return one<{ id: string; network: string; phone: string; account_name: string; verified_name: string | null; name_changed_at: Date | null }>(
    client,
    `SELECT id, network, phone, account_name, verified_name, name_changed_at FROM naya.driver_payout_accounts WHERE driver_id = $1 AND is_primary`,
    [driverId],
  );
}

async function withdrawnToday(client: Db, driverId: string) {
  const r = await one<{ sum: number }>(
    client,
    `SELECT coalesce(sum(amount), 0)::int AS sum FROM naya.payments
      WHERE user_id = $1 AND kind = 'WALLET_WITHDRAWAL' AND status IN ('PENDING', 'SUCCESS')
        AND created_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
    [driverId],
  );
  return r?.sum ?? 0;
}

/** Kwa nini dereva hawezi kutoa sasa hivi (null = anaweza). */
function withdrawBlock(w: WalletRow, account: Awaited<ReturnType<typeof primaryAccount>>, pendingWithdrawal: boolean) {
  if (!getProvider()?.canDisburse) return 'Kutoa pesa kwa simu bado hakujawashwa. Wasiliana na ofisi ya NAYA.';
  if (w.status !== 'ACTIVE') return `Wallet imesimamishwa na ofisi${w.suspended_reason ? `: ${w.suspended_reason}` : '.'}`;
  if (!w.pin_hash) return 'Tengeneza PIN ya wallet kwanza.';
  if (w.pin_blocked) return 'Wallet imefungwa kwa makosa mengi ya PIN — wasiliana na ofisi.';
  if (w.pin_reset_allowed_at) return 'Weka PIN yako mpya kwanza.';
  if (!account) return 'Weka namba yako ya kupokea pesa kwanza.';
  if (!(MOBILE_NETWORKS as string[]).includes(account.network)) return 'Namba kuu ya malipo iwe ya pesa ya simu (M-Pesa, Mixx, Airtel au HaloPesa).';
  if (!account.verified_name) return 'Thibitisha namba yako ya malipo kwanza (jina la mwenye namba).';
  if (account.name_changed_at) return 'Jina la namba yako ya malipo limebadilika kwenye mtandao — ithibitishe upya kwanza.';
  if (w.hold_until && new Date(w.hold_until) > new Date()) {
    return `Kwa usalama (${w.hold_reason ?? 'mabadiliko ya karibuni'}), kutoa kutawezekana baada ya ${new Intl.DateTimeFormat('sw-TZ', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(w.hold_until))}.`;
  }
  if (pendingWithdrawal) return 'Una muamala wa kutoa unaosubiri uthibitisho. Subiri ukamilike.';
  return null;
}

export async function driverWallet(driverId: string) {
  const driver = await one<{ status: string }>(db, 'SELECT status FROM naya.drivers WHERE user_id = $1', [driverId]);
  if (!driver) throw notFound('Bado hujaomba kuwa dereva.');
  if (!['APPROVED', 'SUSPENDED'].includes(driver.status)) throw conflict('Wallet inafunguliwa baada ya ofisi kukuthibitisha kuwa dereva.');
  await ensureWallet(db, driverId);
  const w = (await one<WalletRow>(db, 'SELECT * FROM naya.wallets WHERE driver_id = $1', [driverId]))!;
  const [settings, account, today, pending, entries, earnedToday, fee] = await Promise.all([
    getDriverWalletSettings(),
    primaryAccount(db, driverId),
    withdrawnToday(db, driverId),
    one<{ id: string; amount: number; created_at: Date }>(
      db,
      `SELECT id, amount, created_at FROM naya.payments WHERE user_id = $1 AND kind = 'WALLET_WITHDRAWAL' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`,
      [driverId],
    ),
    many<{ id: string; amount: number; balance_after: number; kind: string; note: string | null; created_at: Date; ride_id: string | null; payment_id: string | null; status: string | null }>(
      db,
      `SELECT e.id, e.amount, e.balance_after, e.kind, e.note, e.created_at, e.ride_id, e.payment_id, p.status
         FROM naya.wallet_entries e LEFT JOIN naya.payments p ON p.id = e.payment_id
        WHERE e.driver_id = $1 ORDER BY e.id DESC LIMIT 60`,
      [driverId],
    ),
    one<{ sum: number }>(
      db,
      `SELECT coalesce(sum(amount), 0)::int AS sum FROM naya.wallet_entries
        WHERE driver_id = $1 AND kind IN ('PROMO_EARNING', 'RIDE_EARNING')
          AND created_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
      [driverId],
    ),
    getSettings(),
  ]);
  const locked = !!(w.pin_locked_until && new Date(w.pin_locked_until) > new Date());
  return {
    balance: w.balance,
    status: w.status,
    suspendedReason: w.suspended_reason,
    earnedToday: earnedToday?.sum ?? 0,
    pin: {
      set: !!w.pin_hash,
      blocked: w.pin_blocked,
      lockedUntil: locked ? w.pin_locked_until : null,
      resetRequested: !!w.pin_reset_requested_at && !w.pin_reset_allowed_at,
      resetAllowed: !!w.pin_reset_allowed_at,
    },
    holdUntil: w.hold_until && new Date(w.hold_until) > new Date() ? w.hold_until : null,
    holdReason: w.hold_until && new Date(w.hold_until) > new Date() ? w.hold_reason : null,
    account: account
      ? {
          network: account.network,
          networkLabel: NETWORK_LABEL[account.network as Network] ?? account.network,
          phone: account.phone,
          name: account.verified_name ?? account.account_name,
          verified: !!account.verified_name,
          nameChanged: !!account.name_changed_at,
        }
      : null,
    limits: { min: settings.minWithdraw, dailyMax: settings.dailyWithdrawLimit, usedToday: today, leftToday: Math.max(0, settings.dailyWithdrawLimit - today) },
    canWithdraw: withdrawBlock(w, account, !!pending) === null && w.balance >= settings.minWithdraw,
    withdrawBlock: withdrawBlock(w, account, !!pending) ?? (w.balance < settings.minWithdraw ? `Salio lifikie angalau ${tsh(settings.minWithdraw)} ili kutoa.` : null),
    pendingWithdrawal: pending ? { id: pending.id, amount: pending.amount, createdAt: pending.created_at } : null,
    monthlyFee: fee.monthlyFee,
    entries: entries.map((e) => ({
      id: e.id,
      amount: e.amount,
      balanceAfter: e.balance_after,
      kind: e.kind,
      label: ENTRY_LABEL[e.kind] ?? e.kind,
      note: e.note,
      createdAt: e.created_at,
      paymentStatus: e.kind === 'WITHDRAWAL' ? e.status : null,
    })),
  };
}

// ------------------------------------------------------------------ kutoa pesa

/** Ada ya kutuma (dereva anabeba): kutoka Abliner (preview); ikishindwa → makadirio ya juu (4%). */
async function withdrawQuote(amount: number) {
  const provider = getProvider();
  const { feeMode } = await getAutoPayout();
  let fee: number;
  let source: 'preview' | 'estimate' = 'estimate';
  try {
    if (!provider?.previewFee) throw new Error('hakuna preview');
    fee = Math.max(0, Math.ceil(await provider.previewFee(amount)));
    source = 'preview';
  } catch {
    fee = Math.ceil(amount * 0.04);
  }
  // 'deducted': kampuni inakata ada kwa mpokeaji → tunatuma kiasi chote. 'on_top': ada inatoka salio la NAYA → tunatuma kiasi − ada.
  const send = feeMode === 'on_top' ? amount - fee : amount;
  return { amount, fee, send, receive: amount - fee, feeMode, source };
}

function checkAmount(amount: number, settings: DriverWalletSettings) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Weka kiasi sahihi.');
  if (amount < settings.minWithdraw) throw badRequest(`Kiwango cha chini cha kutoa ni ${tsh(settings.minWithdraw)}.`);
  if (amount > settings.dailyWithdrawLimit) throw badRequest(`Kikomo cha kutoa kwa siku ni ${tsh(settings.dailyWithdrawLimit)}.`);
}

export async function withdrawPreview(driverId: string, amount: number) {
  const settings = await getDriverWalletSettings();
  checkAmount(amount, settings);
  const w = await driverWallet(driverId);
  if (w.withdrawBlock) throw conflict(w.withdrawBlock);
  if (amount > w.balance) throw conflict(`Salio lako ni ${tsh(w.balance)} tu.`);
  if (amount > w.limits.leftToday) throw conflict(`Leo umebakiza ${tsh(w.limits.leftToday)} tu kwenye kikomo cha kutoa.`);
  const q = await withdrawQuote(amount);
  if (q.receive <= 0 || q.send < Math.min(1000, settings.minWithdraw)) throw conflict(`Kiasi ni kidogo mno baada ya ada. Toa angalau ${tsh(settings.minWithdraw + q.fee)}.`);
  return { ...q, account: w.account };
}

export async function withdraw(driverId: string, input: { amount: number; pin: string }) {
  const provider = getProvider();
  if (!provider?.canDisburse) throw conflict('Kutoa pesa kwa simu bado hakujawashwa. Wasiliana na ofisi ya NAYA.');
  const settings = await getDriverWalletSettings();
  checkAmount(input.amount, settings);
  await verifyPin(driverId, input.pin);
  const q = await withdrawQuote(input.amount);
  if (q.receive <= 0 || q.send < Math.min(1000, settings.minWithdraw)) throw conflict(`Kiasi ni kidogo mno baada ya ada. Toa angalau ${tsh(settings.minWithdraw + q.fee)}.`);
  const paymentId = await transaction(async (client) => {
    // Mpangilio wa kufunga: dereva → wallet (sawa na malipo ya ofa)
    await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [driverId]);
    const w = await lockWallet(client, driverId);
    const account = await primaryAccount(client, driverId);
    const pending = await one(client, `SELECT 1 FROM naya.payments WHERE user_id = $1 AND kind = 'WALLET_WITHDRAWAL' AND status = 'PENDING'`, [driverId]);
    const block = withdrawBlock(w, account, !!pending);
    if (block) throw conflict(block);
    if (input.amount > w.balance) throw conflict(`Salio lako ni ${tsh(w.balance)} tu.`);
    const used = await withdrawnToday(client, driverId);
    if (used + input.amount > settings.dailyWithdrawLimit) throw conflict(`Leo umebakiza ${tsh(Math.max(0, settings.dailyWithdrawLimit - used))} tu kwenye kikomo cha kutoa.`);
    const payment = await insertPayment(client, {
      kind: 'WALLET_WITHDRAWAL',
      direction: 'OUT',
      userId: driverId,
      amount: input.amount,
      network: account!.network as MobileNetwork,
      phone: account!.phone,
      provider: provider.name,
      meta: { sendAmount: q.send, fee: q.fee, receive: q.receive, feeMode: q.feeMode, feeSource: q.source },
      createdBy: null,
    });
    await postEntry(client, driverId, { amount: -input.amount, kind: 'WITHDRAWAL', paymentId: payment.id, note: `Kwenda ${NETWORK_LABEL[account!.network as Network] ?? account!.network} ${phoneText(account!.phone)}` });
    await writeAudit(client, { actorId: driverId, action: 'wallet.withdraw', targetType: 'payment', targetId: payment.id, details: { amount: input.amount, fee: q.fee } });
    return payment.id;
  });
  await sendWithdrawal(paymentId);
  return driverWallet(driverId);
}

// ------------------------------------------------------------------ ada ya mwezi kwa salio

export async function paySubscriptionFromWallet(driverId: string, input: { months: number; pin: string }) {
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 12) throw badRequest('Chagua miezi 1 hadi 12.');
  await verifyPin(driverId, input.pin);
  const settings = await getSettings();
  const amount = settings.monthlyFee * input.months;
  if (amount <= 0) throw conflict('Ada ya mwezi haijawekwa. Wasiliana na ofisi ya NAYA.');
  const r = await transaction(async (client) => {
    await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [driverId]);
    const w = await lockWallet(client, driverId);
    if (w.status !== 'ACTIVE') throw conflict('Wallet imesimamishwa na ofisi.');
    if (w.balance < amount) throw conflict(`Salio lako ni ${tsh(w.balance)}; ada ya miezi ${input.months} ni ${tsh(amount)}.`);
    const entry = await postEntry(client, driverId, { amount: -amount, kind: 'SUBSCRIPTION', note: input.months === 1 ? 'Ada ya mwezi 1' : `Ada ya miezi ${input.months}` });
    return creditSubscription(client, driverId, {
      months: input.months,
      method: 'WALLET',
      reference: `WALLET-${entry.id}`,
      note: 'Kwa salio la wallet ya NAYA',
      recordedBy: null,
      amount,
      paymentId: null,
    });
  });
  const body = subscriptionPaidMessage(r.amount, r.paidUntil);
  await notify({ userId: driverId, event: 'account', kind: 'subscription_paid', title: 'Ada imelipwa kwa salio', body });
  await notifyAdmins().catch(() => {});
  return driverWallet(driverId);
}

// ------------------------------------------------------------------ namba ya malipo ikibadilishwa

/**
 * Dereva anaweka / kubadilisha namba ya malipo. PIN inahitajika kama ameshaiweka; namba kuu ikibadilika
 * (si kuthibitisha upya namba ileile) → kutoa kunasubiri saa 24.
 */
export async function guardPayoutAccountChange(driverId: string, next: { network: string; phone: string; primary: boolean; id?: string }, pin: unknown) {
  await ensureWallet(db, driverId);
  const w = await one<WalletRow>(db, 'SELECT * FROM naya.wallets WHERE driver_id = $1', [driverId]);
  if (!w) return { hold: false };
  if (w.pin_hash) await verifyPin(driverId, pin);
  const current = await primaryAccount(db, driverId);
  const editingPrimary = !!next.id && current?.id === next.id;
  const becomesPrimary = next.primary || editingPrimary || !current;
  const changesNumber = current && (current.phone !== next.phone || current.network !== next.network);
  return { hold: !!(current && becomesPrimary && changesNumber) };
}

// ------------------------------------------------------------------ ofisi

export async function walletsSummary() {
  const [t, wallet] = await Promise.all([
    one<{ owed: number; drivers: number; withBalance: number; pinResets: number; blocked: number; pendingWithdrawals: number; pendingAmount: number; stuck: number; lateSuccess: number }>(
      db,
      `SELECT coalesce(sum(balance), 0)::bigint::float8 AS owed, count(*)::int AS drivers,
              count(*) FILTER (WHERE balance > 0)::int AS "withBalance",
              count(*) FILTER (WHERE pin_reset_requested_at IS NOT NULL AND pin_reset_allowed_at IS NULL)::int AS "pinResets",
              count(*) FILTER (WHERE pin_blocked)::int AS blocked,
              (SELECT count(*)::int FROM naya.payments WHERE kind = 'WALLET_WITHDRAWAL' AND status = 'PENDING') AS "pendingWithdrawals",
              (SELECT coalesce(sum(amount), 0)::int FROM naya.payments WHERE kind = 'WALLET_WITHDRAWAL' AND status = 'PENDING') AS "pendingAmount",
              (SELECT count(*)::int FROM naya.payments WHERE kind = 'WALLET_WITHDRAWAL' AND status = 'PENDING'
                  AND created_at < now() - make_interval(mins => ${STUCK_MINUTES})) AS stuck,
              (SELECT count(*)::int FROM naya.payments WHERE kind = 'WALLET_WITHDRAWAL' AND (meta->>'lateSuccess')::boolean AND NOT coalesce((meta->>'lateReviewed')::boolean, false)) AS "lateSuccess"
         FROM naya.wallets`,
    ),
    walletOverview().catch(() => null),
  ]);
  const ablinerBalance = wallet && 'balance' in wallet && typeof wallet.balance === 'number' ? wallet.balance : null;
  const settings = await getDriverWalletSettings();
  const cust = await one<{ total: number }>(db, 'SELECT coalesce(sum(balance), 0)::bigint::float8 AS total FROM naya.customer_wallets');
  return {
    ...t!,
    ablinerBalance,
    /** Salio la Abliner halitoshi kulipa wallet zote za madereva? (zinazotumwa sasa zimeshakatwa pande zote mbili) */
    // 0.23.0 Salio za abiria (NAYA Wallet) nazo ni deni la NAYA — zinahesabiwa pamoja
    customerOwed: cust?.total ?? 0,
    short: ablinerBalance !== null && ablinerBalance < (t?.owed ?? 0) + (cust?.total ?? 0),
    settings,
    defaults: WALLET_DEFAULTS,
  };
}

export async function listWallets(q: string | null) {
  return many(
    db,
    `SELECT w.driver_id AS id, u.full_name AS name, u.phone, d.plate_number AS plate, w.balance, w.status,
            (w.pin_hash IS NOT NULL) AS "pinSet", w.pin_blocked AS "pinBlocked",
            (w.pin_reset_requested_at IS NOT NULL AND w.pin_reset_allowed_at IS NULL) AS "pinResetRequested",
            (w.hold_until > now()) AS "onHold",
            (SELECT max(created_at) FROM naya.wallet_entries e WHERE e.driver_id = w.driver_id) AS "lastActivity"
       FROM naya.wallets w JOIN naya.users u ON u.id = w.driver_id JOIN naya.drivers d ON d.user_id = w.driver_id
      WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%' OR d.plate_number ILIKE '%' || $1 || '%')
      ORDER BY (w.pin_reset_requested_at IS NOT NULL AND w.pin_reset_allowed_at IS NULL) DESC, w.pin_blocked DESC, w.balance DESC, u.full_name
      LIMIT 300`,
    [q],
  );
}

export async function walletForAdmin(driverId: string) {
  const w = await one<WalletRow & { name: string; phone: string; plate: string | null }>(
    db,
    `SELECT w.*, u.full_name AS name, u.phone, d.plate_number AS plate
       FROM naya.wallets w JOIN naya.users u ON u.id = w.driver_id JOIN naya.drivers d ON d.user_id = w.driver_id WHERE w.driver_id = $1`,
    [driverId],
  );
  if (!w) throw notFound('Wallet haikupatikana');
  const [entries, account] = await Promise.all([
    many(
      db,
      `SELECT e.id, e.amount, e.balance_after AS "balanceAfter", e.kind, e.note, e.created_at AS "createdAt", e.ride_id AS "rideId",
              e.payment_id AS "paymentId", p.status AS "paymentStatus", p.reference, p.provider_ref AS "providerRef", u.full_name AS "createdBy",
              (coalesce((p.meta->>'lateSuccess')::boolean, false) AND NOT coalesce((p.meta->>'lateReviewed')::boolean, false)) AS "lateSuccess",
              (p.status = 'PENDING' AND p.created_at < now() - make_interval(mins => ${STUCK_MINUTES})) AS stuck
         FROM naya.wallet_entries e LEFT JOIN naya.payments p ON p.id = e.payment_id LEFT JOIN naya.users u ON u.id = e.created_by
        WHERE e.driver_id = $1 ORDER BY e.id DESC LIMIT 300`,
      [driverId],
    ),
    primaryAccount(db, driverId),
  ]);
  return {
    id: w.driver_id,
    name: w.name,
    phone: w.phone,
    plate: w.plate,
    balance: w.balance,
    status: w.status,
    suspendedReason: w.suspended_reason,
    pin: {
      set: !!w.pin_hash,
      failed: w.pin_failed,
      blocked: w.pin_blocked,
      lockedUntil: w.pin_locked_until && new Date(w.pin_locked_until) > new Date() ? w.pin_locked_until : null,
      resetRequestedAt: w.pin_reset_allowed_at ? null : w.pin_reset_requested_at,
      resetAllowedAt: w.pin_reset_allowed_at,
    },
    holdUntil: w.hold_until && new Date(w.hold_until) > new Date() ? w.hold_until : null,
    holdReason: w.hold_reason,
    account: account
      ? { network: account.network, networkLabel: NETWORK_LABEL[account.network as Network] ?? account.network, phone: account.phone, name: account.verified_name ?? account.account_name, verified: !!account.verified_name }
      : null,
    entries: (entries as { kind: string }[]).map((e) => ({ ...e, label: ENTRY_LABEL[e.kind] ?? e.kind })),
  };
}

export async function setWalletActive(adminId: string, driverId: string, active: boolean, reason: string | null) {
  await transaction(async (client) => {
    await lockWallet(client, driverId);
    await client.query('UPDATE naya.wallets SET status = $2, suspended_reason = $3, updated_at = now() WHERE driver_id = $1', [driverId, active ? 'ACTIVE' : 'SUSPENDED', active ? null : reason]);
    await writeAudit(client, { actorId: adminId, action: active ? 'wallet.activated' : 'wallet.suspended', targetType: 'driver', targetId: driverId, details: { reason } });
  });
  await notify({
    userId: driverId,
    event: 'driver',
    kind: 'wallet_status',
    title: active ? 'Wallet imefunguliwa' : 'Wallet imesimamishwa',
    body: active ? 'Ofisi ya NAYA imefungua wallet yako tena.' : `Ofisi ya NAYA imesimamisha wallet yako${reason ? `: ${reason}` : '.'} Salio lako liko salama.`,
  }).catch(() => {});
  return walletForAdmin(driverId);
}

/** Ofisi: fungua PIN iliyofungwa kwa makosa (PIN inabaki ileile). */
export async function unlockPin(adminId: string, driverId: string) {
  await transaction(async (client) => {
    await lockWallet(client, driverId);
    await client.query('UPDATE naya.wallets SET pin_failed = 0, pin_locked_until = NULL, pin_blocked = false, updated_at = now() WHERE driver_id = $1', [driverId]);
    await writeAudit(client, { actorId: adminId, action: 'wallet.pin_unlocked', targetType: 'driver', targetId: driverId });
  });
  return walletForAdmin(driverId);
}

/** Ofisi: ruhusu PIN mpya (dereva amesahau). Dereva anaweka PIN mwenyewe kwa password yake; kutoa kunasubiri saa 24. */
export async function allowPinReset(adminId: string, driverId: string) {
  await transaction(async (client) => {
    const w = await lockWallet(client, driverId);
    if (!w.pin_hash) throw conflict('Dereva huyu bado hajaweka PIN — anaweza kuiweka mwenyewe.');
    await client.query(
      `UPDATE naya.wallets SET pin_reset_allowed_at = now(), pin_reset_allowed_by = $2, pin_failed = 0, pin_locked_until = NULL, pin_blocked = false,
              pin_reset_requested_at = coalesce(pin_reset_requested_at, now()), updated_at = now() WHERE driver_id = $1`,
      [driverId, adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'wallet.pin_reset_allowed', targetType: 'driver', targetId: driverId });
  });
  await notify({
    userId: driverId,
    event: 'driver',
    kind: 'wallet_pin',
    title: 'Weka PIN mpya ya wallet',
    body: 'Ofisi ya NAYA imeruhusu PIN mpya. Fungua Wallet yangu na uweke PIN yako mpya.',
  }).catch(() => {});
  return walletForAdmin(driverId);
}

/** Ofisi: marekebisho ya salio (kwa sababu iliyoandikwa) — kila moja linaonekana kwenye historia ya dereva. */
export async function adjustWallet(adminId: string, driverId: string, input: { amount: number; reason: string }) {
  if (!Number.isInteger(input.amount) || input.amount === 0 || Math.abs(input.amount) > 1_000_000) throw badRequest('Kiasi kiwe kati ya −1,000,000 na 1,000,000 (si 0).');
  await transaction(async (client) => {
    await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [driverId]);
    await lockWallet(client, driverId);
    await postEntry(client, driverId, { amount: input.amount, kind: 'ADJUSTMENT', note: input.reason, createdBy: adminId });
    await writeAudit(client, { actorId: adminId, action: 'wallet.adjusted', targetType: 'driver', targetId: driverId, details: input });
  });
  await notify({
    userId: driverId,
    event: 'driver',
    kind: 'wallet_adjust',
    title: 'Marekebisho ya wallet',
    body: `Ofisi ya NAYA ${input.amount > 0 ? 'imeongeza' : 'imepunguza'} ${tsh(Math.abs(input.amount))} kwenye wallet yako: ${input.reason}`,
  }).catch(() => {});
  return walletForAdmin(driverId);
}

/** Ofisi: kutoa kulikofika baada ya pesa kurudishwa (dereva alipata mara mbili) — ofisi imekagua na kurekebisha. */
export async function markLateReviewed(adminId: string, paymentId: string) {
  const p = await one<{ user_id: string }>(
    db,
    `UPDATE naya.payments SET meta = meta || '{"lateReviewed": true}'::jsonb, updated_at = now()
      WHERE id = $1 AND kind = 'WALLET_WITHDRAWAL' AND (meta->>'lateSuccess')::boolean RETURNING user_id`,
    [paymentId],
  );
  if (!p) throw notFound('Muamala haukupatikana');
  await writeAudit(db, { actorId: adminId, action: 'wallet.late_success_reviewed', targetType: 'driver', targetId: p.user_id, details: { paymentId } });
  return walletForAdmin(p.user_id);
}
