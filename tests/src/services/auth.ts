// Usajili na kuingia kwa namba ya simu + password.
import bcrypt from 'bcryptjs';
import { db, one, transaction } from '../db/pool.js';
import { AppError, conflict, forbidden, isUniqueViolation, unauthorized } from '../utils/http.js';
import { removeAllFcmTokens } from './fcm.js';
import { consumeOtp, issueOtp, OTP_RESEND_SECONDS } from './otp.js';
import { smsEnabled } from './sms.js';
import {
  bumpTokenVersion,
  findUserByPhone,
  insertUser,
  touchLastLogin,
  type UserRole,
  type UserRow,
} from './users.js';

const BCRYPT_ROUNDS = 12;
// Hash ya kudumu ya kulinganisha namba isiyosajiliwa — muda wa jibu unafanana, mtu asijue namba ipi ipo.
const DUMMY_HASH = bcrypt.hashSync('naya-dummy-password', BCRYPT_ROUNDS);

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);

/** Mtu yeyote anajisajili kama mtumiaji wa NAYA; baadaye anachagua kuwa abiria au dereva (mode). */
export async function registerUser(input: { fullName: string; phone: string; password: string }): Promise<UserRow> {
  try {
    const user = await insertUser(db, {
      phone: input.phone,
      fullName: input.fullName,
      role: 'USER',
      passwordHash: await hashPassword(input.password),
    });
    // SMS zikiwa zimewashwa: code ya kuthibitisha namba inatumwa mara moja (bila kuchelewesha jibu).
    if (smsEnabled()) void issueOtp(user!.phone, 'VERIFY_PHONE', { silent: true }).catch(() => {});
    return user!;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya simu tayari imesajiliwa. Ingia badala yake.');
    throw error;
  }
}

/** Kuingia. Ujumbe ni ule ule kwa namba isiyopo au password mbaya. */
export async function login(input: { phone: string; password: string }, allowedRoles?: UserRole[]): Promise<UserRow> {
  const user = await findUserByPhone(db, input.phone);
  const valid = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) throw unauthorized('Namba ya simu au password si sahihi');
  if (user.status !== 'ACTIVE') throw forbidden('Akaunti hii imesimamishwa. Wasiliana na NAYA.');
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new AppError(403, 'Akaunti hii haina ruhusa ya kuingia hapa');
  }
  await touchLastLogin(db, user.id);
  return user;
}

export async function logout(userId: string): Promise<void> {
  await bumpTokenVersion(db, userId);
  // Vikao vyote vimefungwa → simu zisipokee tena kengele/arifa za mtumiaji huyu.
  await removeAllFcmTokens(userId);
}

// ------------------------------------------------------------------ Namba ya simu na password kwa SMS

const SMS_OFF = 'Huduma ya SMS bado haijawashwa. Wasiliana na ofisi ya NAYA.';

/** Tuma (tena) code ya kuthibitisha namba ya mtumiaji aliyeingia. */
export async function sendVerificationCode(user: UserRow) {
  if (user.phone_verified_at) throw conflict('Namba yako tayari imethibitishwa.');
  if (!smsEnabled()) throw new AppError(503, SMS_OFF);
  const { retryAfter } = await issueOtp(user.phone, 'VERIFY_PHONE');
  return { sent: true, retryAfter };
}

export async function verifyPhone(user: UserRow, code: string) {
  if (user.phone_verified_at) return { verified: true };
  await transaction(async (client) => {
    await consumeOtp(client, user.phone, 'VERIFY_PHONE', code);
    await client.query('UPDATE naya.users SET phone_verified_at = now(), updated_at = now() WHERE id = $1', [user.id]);
  });
  return { verified: true };
}

/**
 * "Umesahau password?" — jibu ni lile lile kama namba imesajiliwa au la (mtu asijue namba zipi zipo).
 * SMS inatumwa nyuma ya pazia, kwa hiyo muda wa jibu nao haufichui chochote.
 */
export async function forgotPassword(phone: string) {
  if (!smsEnabled()) throw new AppError(503, SMS_OFF);
  const user = await one<{ status: string }>(db, 'SELECT status FROM naya.users WHERE phone = $1', [phone]);
  if (user?.status === 'ACTIVE') void issueOtp(phone, 'RESET_PASSWORD', { silent: true }).catch(() => {});
  return { retryAfter: OTP_RESEND_SECONDS };
}

/** Code sahihi → password mpya; vifaa vyote vilivyoingia vinatolewa; namba inahesabiwa imethibitishwa. */
export async function resetPassword(input: { phone: string; code: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  await transaction(async (client) => {
    await consumeOtp(client, input.phone, 'RESET_PASSWORD', input.code);
    const updated = await one(
      client,
      `UPDATE naya.users SET password_hash = $2, token_version = token_version + 1,
              phone_verified_at = coalesce(phone_verified_at, now()), updated_at = now()
        WHERE phone = $1 AND status = 'ACTIVE' RETURNING id`,
      [input.phone, passwordHash],
    );
    if (!updated) throw new AppError(400, 'Namba si sahihi au imeisha muda. Omba namba mpya.');
  });
  return { reset: true };
}
