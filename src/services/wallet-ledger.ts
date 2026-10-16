// Ledger ya wallet za madereva (0.21.0) — sehemu ya chini kabisa, bila kutegemea malipo / safari (hakuna import za mzunguko).
//
// Kanuni za pesa:
//  - Kila badiliko la salio ni MSTARI mmoja kwenye naya.wallet_entries + kusasisha naya.wallets.balance, ndani ya
//    transaction ileile, safu ya wallet ikiwa IMEFUNGWA (FOR UPDATE). Hakuna njia nyingine ya kubadilisha salio.
//  - Database inakataa salio hasi (CHECK balance >= 0) — hata kosa la code haliwezi kutoa zaidi ya kilichopo.
//  - Unique index: safari moja inaingiza mapato mara moja; muamala wa kutoa unakatwa / kurudishwa mara moja.
import { type Db, db, one } from '../db/pool.js';
import { conflict } from '../utils/http.js';

export type EntryKind = 'PROMO_EARNING' | 'RIDE_EARNING' | 'WITHDRAWAL' | 'WITHDRAWAL_REVERSAL' | 'SUBSCRIPTION' | 'ADJUSTMENT';

export interface WalletRow {
  driver_id: string;
  balance: number;
  status: 'ACTIVE' | 'SUSPENDED';
  pin_hash: string | null;
  pin_set_at: Date | null;
  pin_failed: number;
  pin_locked_until: Date | null;
  pin_blocked: boolean;
  pin_reset_requested_at: Date | null;
  pin_reset_allowed_at: Date | null;
  hold_until: Date | null;
  hold_reason: string | null;
  suspended_reason: string | null;
  created_at: Date;
}

export interface DriverWalletSettings {
  /** Malipo ya ofa yaingie kwenye wallet (true) au yatumwe moja kwa moja kwenye namba ya dereva kama zamani (false). */
  promoToWallet: boolean;
  /** Kiwango cha chini cha kutoa (Abliner haikubali kiasi kidogo). */
  minWithdraw: number;
  /** Kikomo cha kutoa kwa dereva kwa siku (saa za Dar es Salaam). */
  dailyWithdrawLimit: number;
}
export const WALLET_DEFAULTS: DriverWalletSettings = { promoToWallet: true, minWithdraw: 1000, dailyWithdrawLimit: 100000 };

export async function getDriverWalletSettings(client: Db = db): Promise<DriverWalletSettings> {
  const row = await one<{ value: Partial<DriverWalletSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'driver_wallet'`);
  return { ...WALLET_DEFAULTS, ...(row?.value ?? {}) };
}

/** Wallet ya dereva (inafunguliwa yenyewe mara ya kwanza ikihitajika). null = si dereva. */
export async function ensureWallet(client: Db, driverId: string) {
  await client.query(
    `INSERT INTO naya.wallets (driver_id) SELECT user_id FROM naya.drivers WHERE user_id = $1 ON CONFLICT (driver_id) DO NOTHING`,
    [driverId],
  );
}

/** Ndani ya transaction: funga wallet (ifungue kwanza kama haipo). */
export async function lockWallet(client: Db, driverId: string) {
  await ensureWallet(client, driverId);
  const w = await one<WalletRow>(client, 'SELECT * FROM naya.wallets WHERE driver_id = $1 FOR UPDATE', [driverId]);
  if (!w) throw conflict('Wallet haipatikani — bado hujawa dereva wa NAYA.');
  return w;
}

const isCheckViolation = (e: unknown) => (e as { code?: string })?.code === '23514';

/**
 * Mstari mpya wa ledger. LAZIMA wallet iwe imefungwa na lockWallet() ndani ya transaction hii.
 * amount > 0 = inaingia; amount < 0 = inatoka (salio likipungua chini ya 0 → kosa, hakuna kinachobadilika).
 */
export async function postEntry(
  client: Db,
  driverId: string,
  e: { amount: number; kind: EntryKind; rideId?: string | null; paymentId?: string | null; note?: string | null; createdBy?: string | null },
) {
  if (!Number.isInteger(e.amount) || e.amount === 0) throw new Error('postEntry: kiasi si sahihi');
  let balance: number;
  try {
    const row = await one<{ balance: number }>(
      client,
      'UPDATE naya.wallets SET balance = balance + $2, updated_at = now() WHERE driver_id = $1 RETURNING balance',
      [driverId, e.amount],
    );
    if (!row) throw new Error('postEntry: wallet haipo');
    balance = row.balance;
  } catch (error) {
    if (isCheckViolation(error)) throw conflict('Salio la wallet halitoshi.');
    throw error;
  }
  const entry = await one<{ id: string }>(
    client,
    `INSERT INTO naya.wallet_entries (driver_id, amount, balance_after, kind, ride_id, payment_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [driverId, e.amount, balance, e.kind, e.rideId ?? null, e.paymentId ?? null, e.note?.slice(0, 300) ?? null, e.createdBy ?? null],
  );
  return { id: entry!.id, balance };
}
