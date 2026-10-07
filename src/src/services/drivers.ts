// Madereva: usajili, chombo, nyaraka, kutuma kwa uthibitisho, na hatua za ofisi.
// Kila badiliko la hali linafanyika kwa "UPDATE ... WHERE status = <hali inayotarajiwa>" ndani ya transaction,
// kwa hiyo wasimamizi wawili hawawezi kumthibitisha na kumkataa dereva yule yule kwa wakati mmoja.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { conflict, forbidden, isUniqueViolation, notFound } from '../utils/http.js';
import type { DocumentType, VehicleInput } from '../validators/drivers.js';
import { auditFor, writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';
import { startTrialIfNeeded } from './subscriptions.js';
import { assertPhoneVerified } from './verification.js';
import { deleteFile, readFile, storeFile } from './files.js';
import { toPublicUser, type UserRow } from './users.js';

export type DriverStatus = 'INCOMPLETE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export const REQUIRED_DOCUMENTS: DocumentType[] = ['PROFILE_PHOTO', 'DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_PHOTO'];
/** Dereva anaweza kubadilisha taarifa zake akiwa katika hali hizi tu. */
const EDITABLE: DriverStatus[] = ['INCOMPLETE', 'REJECTED'];

interface DriverRow {
  user_id: string;
  status: DriverStatus;
  vehicle_type: 'BODABODA' | 'BAJAJI' | null;
  plate_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  license_number: string | null;
  national_id_number: string | null;
  rejection_reason: string | null;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  created_at: Date;
}

interface DocumentRow {
  doc_type: DocumentType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mime_type: string;
  size_bytes: number;
  storage: string;
  storage_key: string;
  review_note: string | null;
  uploaded_at: Date;
}

const toPublicDriver = (d: DriverRow) => ({
  status: d.status,
  vehicleType: d.vehicle_type,
  plateNumber: d.plate_number,
  vehicleMake: d.vehicle_make,
  vehicleModel: d.vehicle_model,
  vehicleColor: d.vehicle_color,
  licenseNumber: d.license_number,
  nationalIdNumber: d.national_id_number,
  rejectionReason: d.rejection_reason,
  submittedAt: d.submitted_at,
  reviewedAt: d.reviewed_at,
  createdAt: d.created_at,
});

/** Maelezo ya nyaraka — kamwe bila mahali faili lilipohifadhiwa. */
const toPublicDocument = (d: DocumentRow) => ({
  type: d.doc_type,
  status: d.status,
  mimeType: d.mime_type,
  sizeBytes: d.size_bytes,
  reviewNote: d.review_note,
  uploadedAt: d.uploaded_at,
});

function requirements(driver: DriverRow, documents: DocumentRow[]) {
  const vehicleComplete = Boolean(
    driver.vehicle_type && driver.plate_number && driver.vehicle_make && driver.vehicle_color && driver.license_number,
  );
  const uploaded = new Set(documents.map((d) => d.doc_type));
  const missingDocuments = REQUIRED_DOCUMENTS.filter((t) => !uploaded.has(t));
  const rejectedDocuments = documents.filter((d) => d.status === 'REJECTED').map((d) => d.doc_type);
  const editable = EDITABLE.includes(driver.status);
  return {
    editable,
    vehicleComplete,
    requiredDocuments: REQUIRED_DOCUMENTS,
    missingDocuments,
    rejectedDocuments,
    canSubmit: editable && vehicleComplete && missingDocuments.length === 0 && rejectedDocuments.length === 0,
  };
}

const findDriver = (client: Db, userId: string, lock = false) =>
  one<DriverRow>(client, `SELECT * FROM naya.drivers WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`, [userId]);

const findDocuments = (client: Db, userId: string) =>
  many<DocumentRow>(
    client,
    `SELECT doc_type, status, mime_type, size_bytes, storage, storage_key, review_note, uploaded_at
       FROM naya.driver_documents WHERE driver_id = $1 ORDER BY doc_type`,
    [userId],
  );

async function profile(client: Db, userId: string) {
  const driver = await findDriver(client, userId);
  if (!driver) throw notFound('Bado hujaomba kuwa dereva. Chagua mode ya Dereva kwanza.');
  const documents = await findDocuments(client, userId);
  return {
    driver: toPublicDriver(driver),
    documents: documents.map(toPublicDocument),
    requirements: requirements(driver, documents),
  };
}

// ---------------------------------------------------------------- dereva mwenyewe

/** "Kuwa dereva": inafungua ombi la udereva (INCOMPLETE) kwa akaunti ile ile. Haitengenezi akaunti mpya.
 *  Inarudisha true kama ombi limefunguliwa sasa hivi. */
export async function ensureDriverProfile(client: Db, userId: string): Promise<boolean> {
  const created = await client.query('INSERT INTO naya.drivers (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  if (created.rowCount === 1) {
    await writeAudit(client, { actorId: userId, action: 'driver.applied', targetType: 'driver', targetId: userId });
    return true;
  }
  return false;
}

/** Hali ya udereva ya mtumiaji (null = hajawahi kuomba kuwa dereva). */
export async function driverStatusOf(client: Db, userId: string): Promise<DriverStatus | null> {
  const row = await one<{ status: DriverStatus }>(client, 'SELECT status FROM naya.drivers WHERE user_id = $1', [userId]);
  return row?.status ?? null;
}

export const getDriverProfile = (userId: string) => profile(db, userId);

async function lockEditable(client: Db, userId: string): Promise<DriverRow> {
  const driver = await findDriver(client, userId, true);
  if (!driver) throw notFound('Bado hujaomba kuwa dereva. Chagua mode ya Dereva kwanza.');
  if (!EDITABLE.includes(driver.status)) {
    throw forbidden(
      driver.status === 'PENDING'
        ? 'Taarifa zako zinakaguliwa na ofisi. Subiri majibu kabla ya kubadilisha.'
        : 'Taarifa za dereva aliyethibitishwa zinabadilishwa na ofisi ya NAYA tu.',
    );
  }
  return driver;
}

export async function updateVehicle(userId: string, input: VehicleInput) {
  try {
    await transaction(async (client) => {
      await lockEditable(client, userId);
      await client.query(
        `UPDATE naya.drivers
            SET vehicle_type = $2, plate_number = $3, vehicle_make = $4, vehicle_model = $5, vehicle_color = $6,
                license_number = $7, national_id_number = $8, updated_at = now()
          WHERE user_id = $1`,
        [
          userId,
          input.vehicleType,
          input.plateNumber,
          input.vehicleMake,
          input.vehicleModel,
          input.vehicleColor,
          input.licenseNumber,
          input.nationalIdNumber,
        ],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya plate tayari imesajiliwa na dereva mwingine.');
    throw error;
  }
  return getDriverProfile(userId);
}

/** Kupakia (au kubadilisha) nyaraka moja. Faili la zamani linafutwa ndani ya transaction ile ile. */
export async function saveDocument(userId: string, type: DocumentType, content: Buffer, declaredMime: string | undefined) {
  await transaction(async (client) => {
    await lockEditable(client, userId);
    const previous = await one<{ storage: string; storage_key: string }>(
      client,
      'SELECT storage, storage_key FROM naya.driver_documents WHERE driver_id = $1 AND doc_type = $2',
      [userId, type],
    );
    const stored = await storeFile(client, content, declaredMime);
    await client.query(
      `INSERT INTO naya.driver_documents (driver_id, doc_type, mime_type, size_bytes, sha256, storage, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (driver_id, doc_type) DO UPDATE
         SET status = 'PENDING', mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
             sha256 = EXCLUDED.sha256, storage = EXCLUDED.storage, storage_key = EXCLUDED.storage_key,
             review_note = NULL, reviewed_at = NULL, uploaded_at = now()`,
      [userId, type, stored.mimeType, stored.sizeBytes, stored.sha256, stored.storage, stored.storageKey],
    );
    if (previous) await deleteFile(client, previous.storage, previous.storage_key);
    await client.query('UPDATE naya.drivers SET updated_at = now() WHERE user_id = $1', [userId]);
  });
  return getDriverProfile(userId);
}

export async function readDocument(driverId: string, type: DocumentType): Promise<{ mimeType: string; content: Buffer }> {
  const doc = await one<DocumentRow>(
    db,
    'SELECT * FROM naya.driver_documents WHERE driver_id = $1 AND doc_type = $2',
    [driverId, type],
  );
  if (!doc) throw notFound('Nyaraka hii haijapakiwa');
  const content = await readFile(db, doc.storage, doc.storage_key);
  if (!content) throw notFound('Faili la nyaraka hii halikupatikana');
  return { mimeType: doc.mime_type, content };
}

export async function submitForReview(userId: string) {
  await transaction(async (client) => {
    const driver = await lockEditable(client, userId);
    const check = requirements(driver, await findDocuments(client, userId));
    if (!check.vehicleComplete) throw conflict('Jaza taarifa za chombo chako kwanza.');
    if (check.missingDocuments.length > 0) throw conflict('Pakia nyaraka zote zinazohitajika kwanza.');
    if (check.rejectedDocuments.length > 0) throw conflict('Badilisha nyaraka zilizokataliwa kwanza.');
    await assertPhoneVerified(client, userId);
    await client.query(
      `UPDATE naya.drivers SET status = 'PENDING', submitted_at = now(), rejection_reason = NULL, updated_at = now()
        WHERE user_id = $1`,
      [userId],
    );
    await writeAudit(client, { actorId: userId, action: 'driver.submitted', targetType: 'driver', targetId: userId });
  });
  await notifyAdmins();
  return getDriverProfile(userId);
}

// ---------------------------------------------------------------- ofisi (admin)

export async function listDrivers(filter: { status: DriverStatus | 'ALL'; q?: string; limit: number; offset: number }) {
  const status = filter.status === 'ALL' ? null : filter.status;
  const q = filter.q ? `%${filter.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const digits = filter.q ? filter.q.replace(/\D/g, '').replace(/^0/, '').replace(/^255/, '') : '';
  const phoneLike = digits.length >= 3 ? `%${digits}%` : null;

  const where = `($1::naya.driver_status IS NULL OR d.status = $1)
    AND ($2::text IS NULL OR u.full_name ILIKE $2 OR d.plate_number ILIKE $2 OR ($3::text IS NOT NULL AND u.phone LIKE $3))`;
  const [drivers, total, counts] = await Promise.all([
    many(
      db,
      `SELECT d.user_id AS id, u.full_name AS "fullName", u.phone, u.status AS "accountStatus", d.status,
              d.vehicle_type AS "vehicleType", d.plate_number AS "plateNumber",
              d.submitted_at AS "submittedAt", d.created_at AS "createdAt",
              (SELECT count(*)::int FROM naya.driver_documents x WHERE x.driver_id = d.user_id) AS "documentCount"
         FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
        WHERE ${where}
        ORDER BY (d.status = 'PENDING') DESC, d.submitted_at ASC NULLS LAST, d.created_at DESC
        LIMIT $4 OFFSET $5`,
      [status, q, phoneLike, filter.limit, filter.offset],
    ),
    one<{ total: number }>(
      db,
      `SELECT count(*)::int AS total FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id WHERE ${where}`,
      [status, q, phoneLike],
    ),
    countDriversByStatus(db),
  ]);
  return { drivers, total: total?.total ?? 0, counts };
}

export async function countDriversByStatus(client: Db): Promise<Record<DriverStatus, number>> {
  const rows = await many<{ status: DriverStatus; total: number }>(
    client,
    'SELECT status, count(*)::int AS total FROM naya.drivers GROUP BY status',
  );
  const counts: Record<DriverStatus, number> = { INCOMPLETE: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  for (const r of rows) counts[r.status] = r.total;
  return counts;
}

export async function getDriverForAdmin(driverId: string) {
  const user = await one<UserRow>(
    db,
    'SELECT u.* FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id WHERE u.id = $1',
    [driverId],
  );
  if (!user) throw notFound('Dereva hajapatikana');
  const [details, history] = await Promise.all([profile(db, driverId), auditFor(db, 'driver', driverId)]);
  return { user: toPublicUser(user), ...details, history };
}

/** Badiliko la hali kutoka `from` kwenda `to` — linashindwa kwa 409 kama mtu mwingine ameshabadilisha. */
async function transition(
  client: Db,
  driverId: string,
  from: DriverStatus,
  to: DriverStatus,
  adminId: string,
  reason: string | null,
): Promise<void> {
  const updated = await one<{ user_id: string }>(
    client,
    `UPDATE naya.drivers
        SET status = $3, rejection_reason = $4, reviewed_at = now(), reviewed_by = $5, updated_at = now()
      WHERE user_id = $1 AND status = $2
      RETURNING user_id`,
    [driverId, from, to, reason, adminId],
  );
  if (!updated) {
    const exists = await findDriver(client, driverId);
    if (!exists) throw notFound('Dereva hajapatikana');
    throw conflict('Hali ya dereva huyu imeshabadilika. Fungua upya ukurasa uone hali ya sasa.');
  }
}

export async function approveDriver(adminId: string, driverId: string) {
  await transaction(async (client) => {
    await transition(client, driverId, 'PENDING', 'APPROVED', adminId, null);
    await client.query(
      `UPDATE naya.driver_documents SET status = 'APPROVED', review_note = NULL, reviewed_at = now() WHERE driver_id = $1`,
      [driverId],
    );
    await startTrialIfNeeded(client, driverId); // siku za bure za ada ya mwezi (mara ya kwanza tu)
    await writeAudit(client, { actorId: adminId, action: 'driver.approved', targetType: 'driver', targetId: driverId });
  });
  await notify({
    userId: driverId,
    event: 'account',
    kind: 'driver_approved',
    title: 'Umethibitishwa kuwa dereva wa NAYA!',
    body: 'Fungua NAYA, bonyeza NENDA ONLINE upokee safari.',
    sms: 'NAYA: Hongera! Umethibitishwa kuwa dereva wa NAYA. Fungua app ya NAYA na ubonyeze NENDA ONLINE upokee safari.',
  });
  await notifyAdmins();
  return getDriverForAdmin(driverId);
}

export async function rejectDriver(adminId: string, driverId: string, reason: string, documents: DocumentType[]) {
  await transaction(async (client) => {
    await transition(client, driverId, 'PENDING', 'REJECTED', adminId, reason);
    if (documents.length > 0) {
      await client.query(
        `UPDATE naya.driver_documents SET status = 'REJECTED', review_note = $3, reviewed_at = now()
          WHERE driver_id = $1 AND doc_type = ANY($2::naya.document_type[])`,
        [driverId, documents, reason],
      );
    }
    await writeAudit(client, {
      actorId: adminId,
      action: 'driver.rejected',
      targetType: 'driver',
      targetId: driverId,
      details: { reason, documents },
    });
  });
  await notify({
    userId: driverId,
    event: 'account',
    kind: 'driver_rejected',
    title: 'Ombi lako la udereva linahitaji marekebisho',
    body: reason,
    sms: `NAYA: Ombi lako la udereva linahitaji marekebisho: ${reason.slice(0, 90)}. Fungua app ya NAYA urekebishe.`,
  });
  await notifyAdmins();
  return getDriverForAdmin(driverId);
}

export async function suspendDriver(adminId: string, driverId: string, reason: string) {
  await transaction(async (client) => {
    await transition(client, driverId, 'APPROVED', 'SUSPENDED', adminId, reason);
    await writeAudit(client, {
      actorId: adminId,
      action: 'driver.suspended',
      targetType: 'driver',
      targetId: driverId,
      details: { reason },
    });
  });
  await notify({ userId: driverId, event: 'account', kind: 'driver_suspended', title: 'Udereva wako umesimamishwa', body: reason });
  await notifyAdmins();
  return getDriverForAdmin(driverId);
}

export async function reinstateDriver(adminId: string, driverId: string) {
  await transaction(async (client) => {
    await transition(client, driverId, 'SUSPENDED', 'APPROVED', adminId, null);
    await writeAudit(client, { actorId: adminId, action: 'driver.reinstated', targetType: 'driver', targetId: driverId });
  });
  await notify({ userId: driverId, event: 'account', kind: 'driver_reinstated', title: 'Umerudishwa kazini', body: 'Unaweza kwenda online na kupokea safari tena.' });
  await notifyAdmins();
  return getDriverForAdmin(driverId);
}
