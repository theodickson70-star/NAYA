// Namba za siri za mara moja (OTP) kwa SMS: kuthibitisha namba ya simu na kurejesha password.
//
// - Code ya tarakimu 6 (crypto.randomInt), inadumu dakika 10, majaribio 5 tu.
// - Database inahifadhi HMAC-SHA256 ya code (ufunguo: JWT_SECRET) — hata database ikivuja, code hazisomeki.
// - Kuzuia matumizi mabaya (na gharama ya SMS): sekunde 60 kati ya SMS mbili kwa namba moja, na SMS 5 kwa saa.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { type Db, db, one } from '../db/pool.js';
import { AppError } from '../utils/http.js';
import { sendSms } from './sms.js';

export type OtpPurpose = 'VERIFY_PHONE' | 'RESET_PASSWORD';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_PER_HOUR = 5;

const hashCode = (phone: string, purpose: OtpPurpose, code: string) =>
  createHmac('sha256', env.jwtSecret).update(`${phone}:${purpose}:${code}`).digest();

const MESSAGES: Record<OtpPurpose, (code: string) => string> = {
  VERIFY_PHONE: (code) => `NAYA: Namba yako ya kuthibitisha ni ${code}. Inaisha baada ya dakika ${OTP_TTL_MINUTES}. Usimpe mtu yeyote.`,
  RESET_PASSWORD: (code) =>
    `NAYA: Namba ya kubadilisha password ni ${code}. Inaisha baada ya dakika ${OTP_TTL_MINUTES}. Kama hukuomba, puuza ujumbe huu.`,
};

/** Kosa la "subiri kidogo" — app inaonyesha sekunde zilizobaki. */
export class OtpCooldownError extends AppError {
  constructor(readonly retryAfter: number) {
    super(429, `Subiri sekunde ${retryAfter} kabla ya kuomba namba nyingine.`);
  }
}

/**
 * Tengeneza na tuma code. Inarudisha sekunde za kusubiri kabla ya kuomba tena.
 * `silent`: usitupe kosa la cooldown (kwa "umesahau password" — jibu linafanana kila mara).
 */
export async function issueOtp(phone: string, purpose: OtpPurpose, { silent = false } = {}): Promise<{ sent: boolean; retryAfter: number }> {
  const recent = await one<{ last_age: number | null; last_hour: number }>(
    db,
    `SELECT extract(epoch FROM now() - max(created_at))::float8 AS last_age,
            count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour
       FROM naya.otp_codes WHERE phone = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'`,
    [phone, purpose],
  );
  if (recent?.last_age != null && recent.last_age < OTP_RESEND_SECONDS) {
    const retryAfter = Math.ceil(OTP_RESEND_SECONDS - recent.last_age);
    if (silent) return { sent: false, retryAfter };
    throw new OtpCooldownError(retryAfter);
  }
  if ((recent?.last_hour ?? 0) >= OTP_MAX_PER_HOUR) {
    if (silent) return { sent: false, retryAfter: 3600 };
    throw new AppError(429, 'Umeomba namba mara nyingi. Jaribu tena baada ya saa moja, au wasiliana na ofisi ya NAYA.');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `INSERT INTO naya.otp_codes (phone, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4::int))`,
    [phone, purpose, hashCode(phone, purpose, code), OTP_TTL_MINUTES],
  );
  const sent = await sendSms(phone, MESSAGES[purpose](code), `otp_${purpose.toLowerCase()}`);
  if (!sent && !silent) throw new AppError(503, 'SMS haikutumwa kwa sasa. Jaribu tena baada ya dakika moja.');
  return { sent, retryAfter: OTP_RESEND_SECONDS };
}

/**
 * Hakiki code ya mwisho ya namba hii. Ikiwa sahihi, inatumika (haiwezi kutumika tena).
 * `client`: tumia transaction ile ile ya kazi inayofuata (mf. kubadilisha password).
 */
export async function consumeOtp(client: Db, phone: string, purpose: OtpPurpose, code: string): Promise<void> {
  const row = await one<{ id: string; code_hash: Buffer; attempts: number; expired: boolean }>(
    client,
    `SELECT id, code_hash, attempts, expires_at <= now() AS expired FROM naya.otp_codes
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose],
  );
  const wrong = 'Namba si sahihi au imeisha muda. Omba namba mpya.';
  if (!row || row.expired || row.attempts >= OTP_MAX_ATTEMPTS) throw new AppError(400, wrong);
  const expected = hashCode(phone, purpose, code);
  if (!timingSafeEqual(expected, row.code_hash)) {
    // Jaribio baya linahesabiwa kwenye muunganisho tofauti — hata kazi ikirudishwa nyuma, hesabu inabaki.
    await db.query('UPDATE naya.otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
    throw new AppError(400, left > 0 ? `Namba si sahihi. Umebakiza majaribio ${left}.` : wrong);
  }
  // Code moja inatumika mara moja tu, hata maombi mawili yakifika pamoja.
  const used = await one(client, 'UPDATE naya.otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [row.id]);
  if (!used) throw new AppError(400, wrong);
}
