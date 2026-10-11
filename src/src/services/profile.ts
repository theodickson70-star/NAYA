// Wasifu wa mtumiaji (0.15.0): picha yake, jina, mtu wa dharura, na takwimu fupi.
//  - Picha inahifadhiwa kama nyaraka nyingine (naya.document_files) — picha tu (JPG/PNG/WEBP), si PDF.
//  - Dereva anaona picha ya abiria akipewa ombi la safari na wakati wa safari — si mtu mwingine yeyote.
//  - Dereva aliyesajiliwa hawezi kubadilisha jina mwenyewe: jina lake limethibitishwa na nyaraka (aende Msaada).
import { db, many, one, transaction } from '../db/pool.js';
import { badRequest, notFound } from '../utils/http.js';
import { normalizeTzPhone } from '../utils/phone.js';
import { writeAudit } from './audit.js';
import { deleteFile, readFile, storeFile } from './files.js';

const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];

interface ProfileRow {
  id: string;
  full_name: string;
  phone: string;
  created_at: Date;
  photo_file_id: string | null;
  photo_updated_at: Date | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  driver_status: string | null;
}

async function profileRow(userId: string) {
  const row = await one<ProfileRow>(
    db,
    `SELECT u.id, u.full_name, u.phone, u.created_at, u.photo_file_id, u.photo_updated_at, u.emergency_name, u.emergency_phone,
            d.status::text AS driver_status
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  if (!row) throw notFound('Akaunti haikupatikana');
  return row;
}

/** Jina limefungwa kwa dereva ambaye ofisi imeshaanza kumhakiki (jina linatoka kwenye leseni / kitambulisho). */
const nameLocked = (driverStatus: string | null) => driverStatus !== null && driverStatus !== 'INCOMPLETE';

export async function getProfile(userId: string) {
  const u = await profileRow(userId);
  const stats = await one<{ trips: number; rating: number | null; ratings: number; saved: number }>(
    db,
    `SELECT count(*) FILTER (WHERE status = 'COMPLETED')::int AS trips,
            round(avg(rating_for_passenger)::numeric, 1)::float8 AS rating,
            count(rating_for_passenger)::int AS ratings,
            coalesce(sum(promo_discount) FILTER (WHERE status = 'COMPLETED'), 0)::int AS saved
       FROM naya.rides WHERE passenger_id = $1`,
    [userId],
  );
  return {
    fullName: u.full_name,
    phone: u.phone,
    memberSince: u.created_at,
    hasPhoto: !!u.photo_file_id,
    photoVersion: u.photo_updated_at ? u.photo_updated_at.getTime() : null,
    canEditName: !nameLocked(u.driver_status),
    emergency: u.emergency_phone ? { name: u.emergency_name ?? '', phone: u.emergency_phone } : null,
    stats: {
      trips: stats?.trips ?? 0,
      rating: stats?.ratings ? stats.rating : null,
      ratings: stats?.ratings ?? 0,
      saved: stats?.saved ?? 0,
    },
  };
}

export async function updateProfile(userId: string, input: { fullName?: string }) {
  const u = await profileRow(userId);
  if (input.fullName !== undefined && input.fullName !== u.full_name) {
    if (nameLocked(u.driver_status)) {
      throw badRequest('Jina lako la udereva limethibitishwa na nyaraka zako. Kulibadilisha, wasiliana na Msaada wa NAYA.');
    }
    await transaction(async (client) => {
      await client.query('UPDATE naya.users SET full_name = $2, updated_at = now() WHERE id = $1', [userId, input.fullName]);
      await writeAudit(client, { actorId: userId, action: 'profile.name_changed', targetType: 'user', targetId: userId, details: { from: u.full_name, to: input.fullName } });
    });
  }
  return getProfile(userId);
}

export async function setEmergencyContact(userId: string, input: { name: string; phone: string } | null) {
  const u = await profileRow(userId);
  if (input) {
    const phone = normalizeTzPhone(input.phone);
    if (!phone) throw badRequest('Namba ya simu ya mtu wa dharura si sahihi (mfano: 0712 345 678)');
    if (phone === u.phone) throw badRequest('Weka namba ya mtu mwingine — si namba yako mwenyewe.');
    await db.query('UPDATE naya.users SET emergency_name = $2, emergency_phone = $3, updated_at = now() WHERE id = $1', [userId, input.name, phone]);
  } else {
    await db.query('UPDATE naya.users SET emergency_name = NULL, emergency_phone = NULL, updated_at = now() WHERE id = $1', [userId]);
  }
  return getProfile(userId);
}

export async function savePhoto(userId: string, content: Buffer, declaredMime: string | undefined) {
  if (declaredMime && !PHOTO_MIME.includes(declaredMime.split(';')[0]!.trim())) throw badRequest('Chagua picha (JPG, PNG au WEBP).');
  const u = await profileRow(userId);
  await transaction(async (client) => {
    const file = await storeFile(client, content, declaredMime);
    if (!PHOTO_MIME.includes(file.mimeType)) throw badRequest('Chagua picha (JPG, PNG au WEBP).');
    await client.query('UPDATE naya.users SET photo_file_id = $2, photo_updated_at = now(), updated_at = now() WHERE id = $1', [userId, file.storageKey]);
    if (u.photo_file_id) await deleteFile(client, 'db', u.photo_file_id);
  });
  return getProfile(userId);
}

export async function deletePhoto(userId: string) {
  const u = await profileRow(userId);
  if (u.photo_file_id) {
    await transaction(async (client) => {
      await client.query('UPDATE naya.users SET photo_file_id = NULL, photo_updated_at = now(), updated_at = now() WHERE id = $1', [userId]);
      await deleteFile(client, 'db', u.photo_file_id!);
    });
  }
  return getProfile(userId);
}

/** Picha ya mtumiaji (kwa yeye mwenyewe, ofisi, au dereva wa safari yake). */
export async function readUserPhoto(userId: string) {
  const row = await one<{ photo_file_id: string | null }>(db, 'SELECT photo_file_id FROM naya.users WHERE id = $1', [userId]);
  if (!row?.photo_file_id) throw notFound('Hana picha');
  const content = await readFile(db, 'db', row.photo_file_id);
  if (!content) throw notFound('Hana picha');
  const mimeType = content[0] === 0x89 ? 'image/png' : content.toString('latin1', 0, 4) === 'RIFF' ? 'image/webp' : 'image/jpeg';
  return { content, mimeType };
}

/**
 * Dereva anaona picha ya abiria: akiwa amepewa ombi la safari hiyo (bado linasubiri), au akiwa ndiye dereva wake.
 * Madereva wengine wote → 404 (hakuna anayeweza kuvinjari picha za wateja).
 */
export async function passengerPhotoForDriver(driverId: string, rideId: string) {
  const ride = await one<{ passenger_id: string }>(
    db,
    `SELECT r.passenger_id FROM naya.rides r
      WHERE r.id = $1 AND (r.driver_id = $2 OR EXISTS (
        SELECT 1 FROM naya.ride_offers o WHERE o.ride_id = r.id AND o.driver_id = $2 AND o.status = 'PENDING'))`,
    [rideId, driverId],
  );
  if (!ride) throw notFound('Picha haipatikani');
  return readUserPhoto(ride.passenger_id);
}

/** Kwa dereva: abiria ni nani (jina la kwanza, picha, nyota) — kwenye ombi na wakati wa safari. */
export async function passengerCard(passengerId: string) {
  const row = await one<{ full_name: string; has_photo: boolean; rating: number | null; ratings: number; trips: number }>(
    db,
    `SELECT u.full_name, (u.photo_file_id IS NOT NULL) AS has_photo,
            (SELECT round(avg(r.rating_for_passenger)::numeric, 1)::float8 FROM naya.rides r WHERE r.passenger_id = u.id AND r.rating_for_passenger IS NOT NULL) AS rating,
            (SELECT count(*)::int FROM naya.rides r WHERE r.passenger_id = u.id AND r.rating_for_passenger IS NOT NULL) AS ratings,
            (SELECT count(*)::int FROM naya.rides r WHERE r.passenger_id = u.id AND r.status = 'COMPLETED') AS trips
       FROM naya.users u WHERE u.id = $1`,
    [passengerId],
  );
  if (!row) return null;
  return {
    firstName: row.full_name.split(' ')[0] ?? row.full_name,
    hasPhoto: row.has_photo,
    rating: row.ratings ? { average: row.rating, count: row.ratings } : null,
    trips: row.trips,
  };
}

/** Kwa ofisi: picha + mtu wa dharura wa watumiaji kadhaa. */
export async function emergencyFor(userIds: string[]) {
  if (!userIds.length) return new Map<string, { name: string; phone: string }>();
  const rows = await many<{ id: string; emergency_name: string | null; emergency_phone: string }>(
    db,
    'SELECT id, emergency_name, emergency_phone FROM naya.users WHERE id = ANY($1::uuid[]) AND emergency_phone IS NOT NULL',
    [userIds],
  );
  return new Map(rows.map((r) => [r.id, { name: r.emergency_name ?? '', phone: r.emergency_phone }]));
}
