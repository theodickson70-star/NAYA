// NAYA Staff (0.19.0): wasaidizi wa NAYA wanaoingia kwenye app ya NAYA na kupata kazi zao tu:
//   - kusajili bodaboda/bajaji (akaunti + chombo + nyaraka) → "Inasubiri uthibitisho"; ofisi PEKEE ndiyo inathibitisha;
//   - kupendekeza maeneo (GPS ya simu) → yanasubiri ofisi iyaidhinishe kabla wateja hawajayaona;
//   - kuona kazi zao.
// Staff hawezi kuona pesa, mipangilio, wateja wala kuthibitisha. Ofisi inatengeneza / kusimamisha akaunti zao.
import { randomInt } from 'node:crypto';
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { AppError, conflict, isUniqueViolation, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { bumpTokenVersion } from './users.js';
import { hashPassword } from './auth.js';
import { getDriverProfile, REQUIRED_DOCUMENTS } from './drivers.js';
import { removeAllFcmTokens } from './fcm.js';
import { notifyAdmins } from './notify.js';
import type { LocationInput } from '../validators/places.js';

// Herufi zisizochanganya (hakuna 0/O, 1/l/I)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
/** Password ya muda: herufi 10 za nasibu (inaonyeshwa MARA MOJA tu; inabadilishwa akiingia mara ya kwanza). */
export const tempPassword = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

// ------------------------------------------------------------------ ofisi: akaunti za staff

export async function listStaff() {
  return many(
    db,
    `SELECT u.id, u.full_name AS "fullName", u.phone, u.status, u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
            u.must_change_password AS "mustChangePassword",
            (SELECT count(*)::int FROM naya.drivers d WHERE d.registered_by = u.id) AS "driversRegistered",
            (SELECT count(*)::int FROM naya.drivers d WHERE d.registered_by = u.id AND d.status = 'APPROVED') AS "driversApproved",
            (SELECT count(*)::int FROM naya.drivers d WHERE d.registered_by = u.id AND d.status = 'PENDING') AS "driversPending",
            (SELECT count(*)::int FROM naya.locations l WHERE l.created_by = u.id) AS "locationsAdded",
            (SELECT count(*)::int FROM naya.locations l WHERE l.created_by = u.id AND l.review_status = 'PENDING') AS "locationsPending"
       FROM naya.users u WHERE u.role = 'STAFF'
      ORDER BY u.status, u.full_name`,
  );
}

export async function createStaff(adminId: string, input: { fullName: string; phone: string }) {
  const password = tempPassword();
  try {
    const user = await transaction(async (client) => {
      const row = await one<{ id: string }>(
        client,
        `INSERT INTO naya.users (phone, full_name, role, password_hash, must_change_password, created_by)
         VALUES ($1, $2, 'STAFF', $3, true, $4) RETURNING id`,
        [input.phone, input.fullName, await hashPassword(password), adminId],
      );
      await writeAudit(client, { actorId: adminId, action: 'staff.created', targetType: 'user', targetId: row!.id, details: { fullName: input.fullName } });
      return row!;
    });
    return { id: user.id, fullName: input.fullName, phone: input.phone, tempPassword: password };
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya simu tayari ina akaunti ya NAYA. Tumia namba nyingine kwa staff.');
    throw error;
  }
}

async function staffRow(client: Db, id: string, lock = false) {
  const row = await one<{ id: string; full_name: string; phone: string; status: string }>(
    client,
    `SELECT id, full_name, phone, status FROM naya.users WHERE id = $1 AND role = 'STAFF'${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  if (!row) throw notFound('Staff hakupatikana');
  return row;
}

/** Simamisha / rudisha staff. Akisimamishwa anatolewa kwenye app papo hapo (vikao vyote vinakufa). */
export async function setStaffActive(adminId: string, id: string, active: boolean) {
  await transaction(async (client) => {
    await staffRow(client, id, true);
    await client.query(`UPDATE naya.users SET status = $2, updated_at = now() WHERE id = $1`, [id, active ? 'ACTIVE' : 'SUSPENDED']);
    if (!active) await bumpTokenVersion(client, id);
    await writeAudit(client, { actorId: adminId, action: active ? 'staff.activated' : 'staff.suspended', targetType: 'user', targetId: id });
  });
  if (!active) await removeAllFcmTokens(id).catch(() => {});
  return listStaff();
}

/** Password mpya ya muda (staff ameisahau) — vikao vya zamani vinakufa. */
export async function resetStaffPassword(adminId: string, id: string) {
  const password = tempPassword();
  const row = await transaction(async (client) => {
    const s = await staffRow(client, id, true);
    await client.query(
      `UPDATE naya.users SET password_hash = $2, must_change_password = true, token_version = token_version + 1, updated_at = now() WHERE id = $1`,
      [id, await hashPassword(password)],
    );
    await writeAudit(client, { actorId: adminId, action: 'staff.password_reset', targetType: 'user', targetId: id });
    return s;
  });
  await removeAllFcmTokens(id).catch(() => {});
  return { id, fullName: row.full_name, phone: row.phone, tempPassword: password };
}

// ------------------------------------------------------------------ staff mwenyewe

export async function staffHome(staffId: string) {
  const counts = await one<Record<string, number>>(
    db,
    `SELECT count(*) FILTER (WHERE d.status IN ('INCOMPLETE', 'REJECTED'))::int AS "driversIncomplete",
            count(*) FILTER (WHERE d.status = 'PENDING')::int AS "driversPending",
            count(*) FILTER (WHERE d.status = 'APPROVED')::int AS "driversApproved",
            count(*)::int AS "driversTotal",
            (SELECT count(*)::int FROM naya.locations l WHERE l.created_by = $1 AND l.review_status = 'PENDING') AS "locationsPending",
            (SELECT count(*)::int FROM naya.locations l WHERE l.created_by = $1 AND l.review_status = 'APPROVED') AS "locationsApproved",
            (SELECT count(*)::int FROM naya.locations l WHERE l.created_by = $1 AND l.review_status = 'REJECTED') AS "locationsRejected"
       FROM naya.drivers d WHERE d.registered_by = $1`,
    [staffId],
  );
  return { counts: counts ?? {}, requiredDocuments: REQUIRED_DOCUMENTS };
}

/** Akaunti ya dereva mpya: password ya muda inaonyeshwa kwa staff mara moja tu (anampa dereva). */
export async function registerDriver(
  staffId: string,
  input: {
    fullName: string;
    phone: string;
    vehicle: {
      vehicleType: 'BODABODA' | 'BAJAJI';
      plateNumber: string;
      vehicleMake: string;
      vehicleModel: string | null;
      vehicleColor: string;
      licenseNumber: string;
      nationalIdNumber: string | null;
    };
  },
) {
  const password = tempPassword();
  try {
    const id = await transaction(async (client) => {
      const exists = await one(client, 'SELECT 1 FROM naya.users WHERE phone = $1', [input.phone]);
      if (exists) {
        throw conflict('Namba hii tayari ina akaunti ya NAYA. Mwambie dereva aingie kwenye app yake na achague "Kuwa dereva" mwenyewe.');
      }
      const user = await one<{ id: string }>(
        client,
        `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, must_change_password, created_by)
         VALUES ($1, $2, 'USER', $3, 'DRIVER', true, $4) RETURNING id`,
        [input.phone, input.fullName, await hashPassword(password), staffId],
      );
      const v = input.vehicle;
      await client.query(
        `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_model, vehicle_color, license_number,
                                   national_id_number, registered_by)
         VALUES ($1, 'INCOMPLETE', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [user!.id, v.vehicleType, v.plateNumber, v.vehicleMake, v.vehicleModel, v.vehicleColor, v.licenseNumber, v.nationalIdNumber, staffId],
      );
      await writeAudit(client, { actorId: staffId, action: 'staff.driver_registered', targetType: 'driver', targetId: user!.id, details: { plate: v.plateNumber } });
      return user!.id;
    });
    return { id, fullName: input.fullName, phone: input.phone, tempPassword: password };
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya plate tayari imesajiliwa na dereva mwingine.');
    throw error;
  }
}

/** Dereva huyu alisajiliwa na staff huyu? (staff anaona / kubadilisha waliowasajili yeye tu) */
export async function assertMyDriver(staffId: string, driverId: string) {
  const row = await one(db, 'SELECT 1 FROM naya.drivers WHERE user_id = $1 AND registered_by = $2', [driverId, staffId]);
  if (!row) throw notFound('Dereva hakupatikana kwenye usajili wako');
}

export async function myDrivers(staffId: string) {
  return many(
    db,
    `SELECT d.user_id AS id, u.full_name AS "fullName", u.phone, d.status, d.vehicle_type AS "vehicleType", d.plate_number AS "plateNumber",
            d.rejection_reason AS "rejectionReason", d.created_at AS "createdAt", d.submitted_at AS "submittedAt", d.reviewed_at AS "reviewedAt",
            (SELECT count(*)::int FROM naya.driver_documents x WHERE x.driver_id = d.user_id AND x.doc_type = ANY($2::naya.document_type[])) AS "docsUploaded",
            u.last_login_at IS NOT NULL AS "driverLoggedIn"
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
      WHERE d.registered_by = $1
      ORDER BY d.created_at DESC LIMIT 200`,
    [staffId, REQUIRED_DOCUMENTS],
  );
}

export async function myDriver(staffId: string, driverId: string) {
  await assertMyDriver(staffId, driverId);
  const u = await one<{ full_name: string; phone: string; last_login_at: Date | null }>(
    db,
    'SELECT full_name, phone, last_login_at FROM naya.users WHERE id = $1',
    [driverId],
  );
  return { id: driverId, fullName: u!.full_name, phone: u!.phone, driverLoggedIn: !!u!.last_login_at, ...(await getDriverProfile(driverId)) };
}

/** Staff anatuma usajili kwa ofisi. Masharti ya dereva yanakubaliwa na dereva mwenyewe akiingia kwenye app. */
export async function submitDriver(staffId: string, driverId: string) {
  await assertMyDriver(staffId, driverId);
  const profile = await getDriverProfile(driverId);
  const r = profile.requirements;
  if (!r.editable) throw conflict('Usajili huu tayari umetumwa kwa ofisi.');
  if (!r.vehicleComplete) throw conflict('Jaza taarifa za chombo kwanza.');
  if (r.missingDocuments.length) throw conflict('Piga picha za nyaraka zote zinazohitajika kwanza.');
  if (r.rejectedDocuments.length) throw conflict('Badilisha nyaraka zilizokataliwa na ofisi kwanza.');
  await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE naya.drivers SET status = 'PENDING', submitted_at = now(), rejection_reason = NULL, updated_at = now()
        WHERE user_id = $1 AND status IN ('INCOMPLETE', 'REJECTED')`,
      [driverId],
    );
    if (!updated.rowCount) throw conflict('Usajili huu tayari umetumwa kwa ofisi.');
    await writeAudit(client, { actorId: staffId, action: 'staff.driver_submitted', targetType: 'driver', targetId: driverId });
  });
  await notifyAdmins();
  return myDriver(staffId, driverId);
}

// ------------------------------------------------------------------ maeneo

const LOC = `id, name, area, category, lat::float8 AS lat, lng::float8 AS lng, review_status AS "reviewStatus", review_note AS "reviewNote",
             created_at AS "createdAt", reviewed_at AS "reviewedAt"`;

export async function proposeLocation(staffId: string, input: LocationInput) {
  const dup = await one(
    db,
    `SELECT 1 FROM naya.locations WHERE lower(name) = lower($1) AND (is_active OR review_status = 'PENDING')`,
    [input.name],
  );
  if (dup) throw conflict('Eneo lenye jina hili tayari lipo (au linasubiri kuidhinishwa). Tumia jina tofauti.');
  return transaction(async (client) => {
    const row = await one(
      client,
      `INSERT INTO naya.locations (name, area, category, lat, lng, is_active, review_status, created_by)
       VALUES ($1, $2, $3, $4, $5, false, 'PENDING', $6) RETURNING ${LOC}`,
      [input.name, input.area, input.category, input.lat, input.lng, staffId],
    );
    await writeAudit(client, { actorId: staffId, action: 'staff.location_proposed', targetType: 'location', targetId: (row as { id: string }).id, details: { name: input.name } });
    return row;
  }).finally(() => notifyAdmins().catch(() => {}));
}

export const myLocations = (staffId: string) =>
  many(db, `SELECT ${LOC} FROM naya.locations WHERE created_by = $1 ORDER BY created_at DESC LIMIT 200`, [staffId]);

// ------------------------------------------------------------------ ofisi: maeneo yanayosubiri

export async function pendingLocations() {
  return many(
    db,
    `SELECT l.id, l.name, l.area, l.category, l.lat::float8 AS lat, l.lng::float8 AS lng, l.created_at AS "createdAt",
            u.full_name AS "proposedBy", u.phone AS "proposedByPhone"
       FROM naya.locations l LEFT JOIN naya.users u ON u.id = l.created_by
      WHERE l.review_status = 'PENDING' ORDER BY l.created_at`,
  );
}

export async function reviewLocation(adminId: string, id: string, approve: boolean, note: string | null) {
  try {
    await transaction(async (client) => {
      const loc = await one<{ review_status: string; name: string }>(client, 'SELECT review_status, name FROM naya.locations WHERE id = $1 FOR UPDATE', [id]);
      if (!loc) throw notFound('Eneo halijapatikana');
      if (loc.review_status !== 'PENDING') throw conflict('Eneo hili tayari limeshughulikiwa.');
      await client.query(
        `UPDATE naya.locations SET review_status = $2, is_active = $3, review_note = $4, reviewed_by = $5, reviewed_at = now(), updated_at = now()
          WHERE id = $1`,
        [id, approve ? 'APPROVED' : 'REJECTED', approve, note, adminId],
      );
      await writeAudit(client, { actorId: adminId, action: approve ? 'location.approved' : 'location.rejected', targetType: 'location', targetId: id, details: { name: loc.name, note } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Kuna eneo jingine linalotumika lenye jina hili. Badilisha jina kwanza (Maeneo → hariri) au kataa hili.');
    throw error;
  }
  return pendingLocations();
}

/** Ulinzi wa ziada: staff mwenye password ya muda hawezi kufanya kazi mpaka aibadilishe. */
export function assertPasswordChanged(user: { must_change_password?: boolean }) {
  if (user.must_change_password) throw new AppError(403, 'Badilisha password yako ya muda kwanza.');
}

