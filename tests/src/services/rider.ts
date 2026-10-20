// 0.25.0: Safari ya mtu mwingine — link na SMS za anayesafiri.
//
// Link ya anayesafiri inatengenezwa kutoka siri ya server + id ya safari (HMAC), kwa hiyo server inaweza kuitengeneza
// tena wakati wowote (mf. dereva akikubali → SMS) bila kuihifadhi. Database inahifadhi SHA-256 yake tu (kwa kuitafuta).
import { createHash, createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { db, one } from '../db/pool.js';
import { sendSms } from './sms.js';

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Token ya herufi 32 (base64url) — muundo ule ule wa link ya "Shiriki safari". */
export const riderToken = (rideId: string) =>
  createHmac('sha256', env.jwtSecret).update(`naya-rider:${rideId}`).digest('base64url').slice(0, 32);

export const riderLinkPath = (rideId: string) => `/safari/#${riderToken(rideId)}`;

/** Anwani kamili ya NAYA kwa link za SMS. Railway: PUBLIC_URL (si lazima). */
export const publicUrl = () => env.publicUrl;

const VEHICLE: Record<string, string> = { BODABODA: 'bodaboda', BAJAJI: 'bajaji' };
const first = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'Mteja wa NAYA';
const localPhone = (phone: string) => `0${phone.slice(3)}`;

/**
 * Dereva amekubali safari ya mtu mwingine → SMS kwa anayesafiri: dereva ni nani, plate, simu na link ya kufuatilia.
 * Inatumwa mara moja kwa kila dereva (dereva akighairi na mwingine akakubali, anayesafiri anapata SMS mpya).
 * Haitupi kosa kamwe — SMS ikishindwa, safari inaendelea (dereva atampigia).
 */
export async function smsRiderDriverFound(rideId: string): Promise<void> {
  try {
    const r = await one<{
      rider_name: string | null;
      rider_phone: string | null;
      booker: string;
      vehicle_type: string;
      pickup_name: string;
      driver_name: string | null;
      driver_phone: string | null;
      plate_number: string | null;
    }>(
      db,
      `SELECT r.rider_name, r.rider_phone, p.full_name AS booker, r.vehicle_type, r.pickup_name,
              du.full_name AS driver_name, du.phone AS driver_phone, d.plate_number
         FROM naya.rides r
         JOIN naya.users p ON p.id = r.passenger_id
         LEFT JOIN naya.users du ON du.id = r.driver_id
         LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
        WHERE r.id = $1 AND r.status = 'ACCEPTED' AND r.rider_phone IS NOT NULL`,
      [rideId],
    );
    if (!r || !r.rider_phone || !r.driver_name) return;
    const message =
      `NAYA: ${first(r.booker)} amekuagizia ${VEHICLE[r.vehicle_type] ?? 'safari'}. ` +
      `Dereva ${first(r.driver_name)} (${r.plate_number ?? ''}), simu ${localPhone(r.driver_phone ?? '')}, anakuja ${r.pickup_name}. ` +
      `Fuatilia: ${publicUrl()}${riderLinkPath(rideId)}`;
    const sent = await sendSms(r.rider_phone, message, 'rider_driver_found');
    if (sent) await db.query('UPDATE naya.rides SET rider_sms_at = now() WHERE id = $1', [rideId]);
  } catch (error) {
    console.error(`[rider] SMS ya anayesafiri haikutumwa: ${(error as Error).message}`);
  }
}

/** Safari ya mtu mwingine imeghairiwa baada ya anayesafiri kupata SMS → mwambie asisubiri. */
export async function smsRiderCancelled(rideId: string): Promise<void> {
  try {
    const r = await one<{ rider_phone: string | null; pickup_name: string; booker: string }>(
      db,
      `SELECT r.rider_phone, r.pickup_name, p.full_name AS booker FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
        WHERE r.id = $1 AND r.status = 'CANCELLED' AND r.rider_phone IS NOT NULL AND r.rider_sms_at IS NOT NULL`,
      [rideId],
    );
    if (!r?.rider_phone) return;
    await sendSms(
      r.rider_phone,
      `NAYA: Safari uliyoagiziwa na ${first(r.booker)} kutoka ${r.pickup_name} imeghairiwa. Usimsubiri dereva.`,
      'rider_cancelled',
    );
  } catch (error) {
    console.error(`[rider] SMS ya kughairi haikutumwa: ${(error as Error).message}`);
  }
}
