// Usalama wa safari: kushiriki safari na ndugu (link), na kitufe cha dharura (SOS) kinachofika ofisini papo hapo.
import { randomBytes } from 'node:crypto';
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { conflict, isUniqueViolation, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notifyAdmins } from './notify.js';
import { hashToken } from './rider.js';

const LIVE = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];
const SHARE_AFTER_END_MS = 2 * 60 * 60 * 1000; // link inaonyesha "safari imeisha" kwa saa 2, kisha inakufa


export async function openSosFor(client: Db, userId: string, rideId: string): Promise<boolean> {
  return !!(await one(client, `SELECT 1 FROM naya.sos_alerts WHERE user_id = $1 AND ride_id = $2 AND status = 'OPEN'`, [userId, rideId]));
}

// ------------------------------------------------------------------ Kushiriki safari

/**
 * Abiria anapata link ya kumtumia ndugu. Link ni token ya nasibu (bytes 24); database inahifadhi SHA-256 yake tu.
 * Kila ombi linatengeneza link mpya (ya zamani inaacha kufanya kazi).
 */
export async function createShareLink(passengerId: string, rideId: string) {
  const token = randomBytes(24).toString('base64url');
  const updated = await one(
    db,
    `UPDATE naya.rides SET share_token_hash = $3, shared_at = now(), updated_at = now()
      WHERE id = $1 AND passenger_id = $2 AND status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS') RETURNING id`,
    [rideId, passengerId, hashToken(token)],
  );
  if (!updated) {
    const ride = await one<{ passenger_id: string }>(db, 'SELECT passenger_id FROM naya.rides WHERE id = $1', [rideId]);
    if (!ride || ride.passenger_id !== passengerId) throw notFound('Safari haikupatikana');
    throw conflict('Unaweza kushiriki safari dereva akishapatikana na kabla haijaisha.');
  }
  // Token iko baada ya "#": haitumwi kwa server kwenye URL, kwa hiyo haiingii kwenye logs.
  return { path: `/safari/#${token}` };
}

/**
 * Ukurasa wa umma /safari/ — link za aina mbili:
 *  - SHARE: ndugu anafuatilia safari (taarifa chache, hakuna namba za simu).
 *  - RIDER (0.25.0): anayesafiri kwenye safari ya mtu mwingine — anaona pia namba ya dereva, PIN ya ofa, nauli,
 *    na anaweza kutuma dharura. Inafanya kazi tangu kuagiza (SEARCHING) mpaka saa 2 baada ya safari kuisha.
 */
export async function viewSharedRide(token: string) {
  const r = await findByToken(token);
  const live = LIVE.includes(r.status);
  const base = {
    status: r.status,
    passengerFirstName: (r.rider_name ?? r.passenger_name).split(' ')[0], // safari ya mtu mwingine: anayesafiri
    vehicleType: r.vehicle_type,
    pickup: { name: r.pickup_name, lat: r.pickup_lat, lng: r.pickup_lng },
    destination: { name: r.dest_name, lat: r.dest_lat, lng: r.dest_lng },
    driver: r.driver_name
      ? {
          name: r.driver_name,
          plateNumber: r.plate_number,
          vehicle: [r.vehicle_make, r.vehicle_color].filter(Boolean).join(' · '),
          location: live && r.last_lat !== null && r.last_lng !== null ? { lat: r.last_lat, lng: r.last_lng, at: r.last_seen_at } : null,
          ...(r.rider && live ? { phone: r.driver_phone } : {}),
        }
      : null,
    acceptedAt: r.accepted_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
  if (!r.rider) return { ...base, mode: 'SHARE' as const };
  const settled = r.fare_settlement === 'MOBILE' || r.fare_settlement === 'WALLET';
  return {
    ...base,
    mode: 'RIDER' as const,
    bookedBy: r.passenger_name.split(' ')[0],
    pin: ['ACCEPTED', 'ARRIVED'].includes(r.status) ? r.start_pin : null,
    fare: { amount: r.fare - (r.promo_discount ?? 0), paid: settled },
    sosOpen: live ? await openSosFor(db, r.passenger_id, r.id) : false,
  };
}

type TokenRide = {
  id: string;
  passenger_id: string;
  rider: boolean;
  rider_name: string | null;
  status: string;
  passenger_name: string;
  pickup_name: string;
  pickup_lat: number;
  pickup_lng: number;
  dest_name: string;
  dest_lat: number;
  dest_lng: number;
  vehicle_type: string;
  driver_name: string | null;
  driver_phone: string | null;
  plate_number: string | null;
  vehicle_make: string | null;
  vehicle_color: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: Date | null;
  accepted_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  start_pin: string | null;
  fare: number;
  promo_discount: number;
  fare_settlement: string | null;
};

async function findByToken(token: string): Promise<TokenRide> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw notFound('Link hii si sahihi au imeisha muda.');
  const hash = hashToken(token);
  const r = await one<TokenRide>(
    db,
    `SELECT r.id, r.passenger_id, (r.rider_token_hash = $1) AS rider, r.rider_name,
            r.status, p.full_name AS passenger_name, r.pickup_name, r.pickup_lat, r.pickup_lng, r.dest_name, r.dest_lat, r.dest_lng,
            r.vehicle_type, du.full_name AS driver_name, du.phone AS driver_phone, d.plate_number, d.vehicle_make, d.vehicle_color,
            d.last_lat, d.last_lng, d.last_seen_at, r.accepted_at, r.started_at,
            coalesce(r.completed_at, r.cancelled_at, CASE WHEN r.status = 'NO_DRIVER' THEN r.updated_at END) AS ended_at,
            r.start_pin, r.fare, r.promo_discount, r.fare_settlement
       FROM naya.rides r
       JOIN naya.users p ON p.id = r.passenger_id
       LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
       LEFT JOIN naya.users du ON du.id = r.driver_id
      WHERE r.share_token_hash = $1 OR r.rider_token_hash = $1
      LIMIT 1`,
    [hash],
  );
  if (!r) throw notFound('Link hii si sahihi au imeisha muda.');
  const open = LIVE.includes(r.status) || (r.rider && r.status === 'SEARCHING');
  if (!open && (!r.ended_at || Date.now() - r.ended_at.getTime() > SHARE_AFTER_END_MS)) {
    throw notFound('Link hii si sahihi au imeisha muda.');
  }
  return r;
}

/** 0.25.0: anayesafiri (kupitia link yake, bila akaunti) anabonyeza Dharura → ofisi, chini ya akaunti ya aliyeagiza. */
export async function raiseRiderSos(token: string, input: { lat?: number; lng?: number }) {
  const ride = await findByToken(token);
  if (!ride.rider) throw notFound('Link hii si sahihi au imeisha muda.');
  if (!LIVE.includes(ride.status)) throw conflict('Safari hii haiendelei. Kwa dharura piga 112.');
  let created = true;
  try {
    await transaction(async (client) => {
      const alert = await one<{ id: string }>(
        client,
        `INSERT INTO naya.sos_alerts (user_id, ride_id, role, lat, lng) VALUES ($1, $2, 'RIDER', $3, $4) RETURNING id`,
        [ride.passenger_id, ride.id, input.lat ?? null, input.lng ?? null],
      );
      await writeAudit(client, { actorId: null, action: 'sos.raised', targetType: 'ride', targetId: ride.id, details: { alertId: alert!.id, role: 'RIDER' } });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    created = false;
  }
  await notifyAdmins(ride.id);
  return { sent: true, alreadyOpen: !created };
}

// ------------------------------------------------------------------ Dharura (SOS)

/** Abiria au dereva wa safari inayoendelea anabonyeza "Dharura". Kubonyeza tena hakuleti nakala. */
export async function raiseSos(userId: string, input: { rideId: string; lat?: number; lng?: number }) {
  const ride = await one<{ id: string; passenger_id: string; driver_id: string | null; status: string }>(
    db,
    'SELECT id, passenger_id, driver_id, status FROM naya.rides WHERE id = $1',
    [input.rideId],
  );
  if (!ride || (ride.passenger_id !== userId && ride.driver_id !== userId)) throw notFound('Safari haikupatikana');
  if (!LIVE.includes(ride.status)) throw conflict('Safari hii haiendelei. Kwa dharura piga 112.');
  const role = ride.passenger_id === userId ? 'PASSENGER' : 'DRIVER';
  let created = true;
  try {
    await transaction(async (client) => {
      const alert = await one<{ id: string }>(
        client,
        `INSERT INTO naya.sos_alerts (user_id, ride_id, role, lat, lng) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, ride.id, role, input.lat ?? null, input.lng ?? null],
      );
      await writeAudit(client, { actorId: userId, action: 'sos.raised', targetType: 'ride', targetId: ride.id, details: { alertId: alert!.id, role } });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    created = false; // tayari kuna dharura iliyo wazi — ofisi imeshaarifiwa
  }
  await notifyAdmins(ride.id);
  return { sent: true, alreadyOpen: !created };
}

export async function listSos(scope: 'open' | 'all') {
  return many(
    db,
    `SELECT s.id, s.role, s.status, s.lat, s.lng, s.created_at AS "createdAt", s.resolved_at AS "resolvedAt",
            s.resolution_note AS "note", s.ride_id AS "rideId",
            -- RIDER (0.25.0): dharura ya anayesafiri kwenye safari ya mtu mwingine; aliyeagiza anaonyeshwa kama mtu wa kumpigia
            CASE WHEN s.role = 'RIDER' THEN r.rider_name ELSE u.full_name END AS "name",
            CASE WHEN s.role = 'RIDER' THEN r.rider_phone ELSE u.phone END AS "phone",
            CASE WHEN s.role = 'RIDER' THEN 'Aliyemwagizia: ' || u.full_name ELSE u.emergency_name END AS "emergencyName",
            CASE WHEN s.role = 'RIDER' THEN u.phone ELSE u.emergency_phone END AS "emergencyPhone",
            r.pickup_name AS "pickupName", r.dest_name AS "destinationName", r.status AS "rideStatus",
            CASE WHEN s.role = 'DRIVER' AND r.rider_name IS NOT NULL THEN r.rider_name ELSE other.full_name END AS "otherName",
            CASE WHEN s.role = 'DRIVER' AND r.rider_phone IS NOT NULL THEN r.rider_phone ELSE other.phone END AS "otherPhone",
            d.plate_number AS "plateNumber",
            dl.last_lat AS "driverLat", dl.last_lng AS "driverLng", dl.last_seen_at AS "driverSeenAt",
            ru.full_name AS "resolvedBy"
       FROM naya.sos_alerts s
       JOIN naya.users u ON u.id = s.user_id
       LEFT JOIN naya.rides r ON r.id = s.ride_id
       LEFT JOIN naya.users other ON other.id = CASE WHEN s.role IN ('PASSENGER', 'RIDER') THEN r.driver_id ELSE r.passenger_id END
       LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
       LEFT JOIN naya.drivers dl ON dl.user_id = r.driver_id
       LEFT JOIN naya.users ru ON ru.id = s.resolved_by
      WHERE ($1 = 'all' OR s.status = 'OPEN')
      ORDER BY (s.status = 'OPEN') DESC, s.created_at DESC
      LIMIT 100`,
    [scope],
  );
}

export async function openSosCount(): Promise<number> {
  const row = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM naya.sos_alerts WHERE status = 'OPEN'`);
  return row?.n ?? 0;
}

export async function resolveSos(adminId: string, alertId: string, note: string) {
  await transaction(async (client) => {
    const updated = await one<{ ride_id: string | null }>(
      client,
      `UPDATE naya.sos_alerts SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2, resolution_note = $3
        WHERE id = $1 AND status = 'OPEN' RETURNING ride_id`,
      [alertId, adminId, note],
    );
    if (!updated) {
      const exists = await one(client, 'SELECT 1 FROM naya.sos_alerts WHERE id = $1', [alertId]);
      if (!exists) throw notFound('Dharura haikupatikana');
      throw conflict('Dharura hii imeshashughulikiwa.');
    }
    await writeAudit(client, { actorId: adminId, action: 'sos.resolved', targetType: 'sos', targetId: alertId, details: { note } });
  });
  await notifyAdmins();
  return listSos('open');
}
