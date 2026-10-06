// Safari: kuagiza, kumpata dereva (dispatch), hali za safari, kughairi, rating, mapato, na ofisi.
//
// Hali:  SEARCHING → ACCEPTED → ARRIVED → IN_PROGRESS → COMPLETED
//                  ↘ NO_DRIVER          ↘ CANCELLED (abiria / ofisi)
// Dereva akighairi kabla ya safari kuanza, safari inarudi SEARCHING (tunamtafutia abiria dereva mwingine).
//
// Kila badiliko linafanyika ndani ya transaction kwa "UPDATE … WHERE status = <inayotarajiwa>" au row lock,
// na database ina unique indexes zinazozuia dereva/abiria kuwa na safari mbili zinazoendelea.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { readDocument } from './drivers.js';
import { straightLineKm } from './fare-engine.js';
import { estimateTrip, findLocation, insideServiceArea } from './places.js';

export type RideStatus = 'SEARCHING' | 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_DRIVER';
type VehicleType = 'BODABODA' | 'BAJAJI';

export const OFFER_SECONDS = 20; // muda wa dereva kukubali ombi
export const SEARCH_TIMEOUT_SECONDS = 180; // baada ya hapo bila dereva → NO_DRIVER
export const MAX_PICKUP_KM = 10; // dereva awe ndani ya umbali huu kutoka kwa abiria
export const DRIVER_STALE_SECONDS = 120; // dereva asiyeonekana kwa muda huu hapewi maombi

const ACTIVE: RideStatus[] = ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];
const WITH_DRIVER: RideStatus[] = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'];

interface RideRow {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  vehicle_type: VehicleType;
  status: RideStatus;
  pickup_name: string;
  pickup_lat: number;
  pickup_lng: number;
  dest_name: string;
  dest_lat: number;
  dest_lng: number;
  distance_km: number;
  fare: number;
  payment_method: string;
  cancelled_by: string | null;
  cancel_reason: string | null;
  rating_for_driver: number | null;
  rating_for_passenger: number | null;
  passenger_closed: boolean;
  driver_closed: boolean;
  requested_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function history(client: Db, rideId: string, from: RideStatus | null, to: RideStatus, actorId: string | null, note?: string) {
  await client.query(
    'INSERT INTO naya.ride_status_history (ride_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)',
    [rideId, from, to, actorId, note ?? null],
  );
}

// Umbali (km) kwa SQL — kwa kuchagua dereva aliye karibu zaidi.
const DISTANCE_SQL = (latCol: string, lngCol: string, latParam: string, lngParam: string) => `
  (6371.0088 * 2 * asin(sqrt(
     power(sin(radians((${latCol})::float8 - ${latParam}::float8) / 2), 2) +
     cos(radians(${latParam}::float8)) * cos(radians((${latCol})::float8)) *
     power(sin(radians((${lngCol})::float8 - ${lngParam}::float8) / 2), 2))))`;

// =================================================================== DISPATCH

/** Inaisha maombi yaliyopitwa na muda, kisha inajaribu kumpata dereva kwa kila safari inayotafuta. */
export async function dispatchPending(): Promise<void> {
  await db.query(`UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE status = 'PENDING' AND expires_at <= now()`);
  const rides = await many<{ id: string }>(db, `SELECT id FROM naya.rides WHERE status = 'SEARCHING' ORDER BY requested_at LIMIT 50`);
  for (const ride of rides) await dispatchRide(ride.id);
}

/** Kwa safari moja: kama hakuna ombi linalosubiri, mpe dereva aliye karibu zaidi; muda ukiisha → NO_DRIVER. */
export async function dispatchRide(rideId: string): Promise<void> {
  await transaction(async (client) => {
    const ride = await one<RideRow & { search_age_s: number }>(
      client,
      `SELECT *, extract(epoch FROM now() - search_started_at)::float8 AS search_age_s
         FROM naya.rides WHERE id = $1 AND status = 'SEARCHING' FOR UPDATE SKIP LOCKED`,
      [rideId],
    );
    if (!ride) return;
    await client.query(
      `UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' AND expires_at <= now()`,
      [rideId],
    );
    const waiting = await one(client, `SELECT 1 FROM naya.ride_offers WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
    if (waiting) return;

    const candidates = await many<{ user_id: string; km: number }>(
      client,
      `SELECT d.user_id, ${DISTANCE_SQL('d.last_lat', 'd.last_lng', '$2', '$3')} AS km
         FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
        WHERE d.status = 'APPROVED' AND d.is_online AND u.status = 'ACTIVE' AND d.vehicle_type = $4
          AND d.last_lat IS NOT NULL AND d.last_seen_at > now() - make_interval(secs => $5::float8)
          AND d.user_id <> $6
          AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
          AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.passenger_id = d.user_id AND r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
          AND NOT EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'PENDING')
          AND NOT EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.ride_id = $1 AND o.driver_id = d.user_id)
        ORDER BY km ASC
        LIMIT 5`,
      [rideId, ride.pickup_lat, ride.pickup_lng, ride.vehicle_type, DRIVER_STALE_SECONDS, ride.passenger_id],
    );
    for (const candidate of candidates) {
      if (candidate.km > MAX_PICKUP_KM) break;
      // ON CONFLICT: dereva huyu amepewa ombi jingine sekunde hii hii → jaribu anayefuata.
      const offered = await one(
        client,
        `INSERT INTO naya.ride_offers (ride_id, driver_id, distance_km, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4::float8))
         ON CONFLICT DO NOTHING RETURNING id`,
        [rideId, candidate.user_id, round1(candidate.km), OFFER_SECONDS],
      );
      if (offered) return;
    }

    if (ride.search_age_s > SEARCH_TIMEOUT_SECONDS) {
      await client.query(`UPDATE naya.rides SET status = 'NO_DRIVER', updated_at = now() WHERE id = $1`, [rideId]);
      await history(client, rideId, 'SEARCHING', 'NO_DRIVER', null, 'Hakuna dereva aliyepatikana');
    }
  });
}

// =================================================================== MAONESHO (views)

async function driverCard(client: Db, driverId: string) {
  const row = await one<{
    full_name: string;
    phone: string;
    vehicle_type: VehicleType;
    plate_number: string;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_color: string | null;
    last_lat: number | null;
    last_lng: number | null;
    has_photo: boolean;
    rating_avg: number | null;
    rating_count: number;
  }>(
    client,
    `SELECT u.full_name, u.phone, d.vehicle_type, d.plate_number, d.vehicle_make, d.vehicle_model, d.vehicle_color,
            d.last_lat, d.last_lng,
            EXISTS (SELECT 1 FROM naya.driver_documents x WHERE x.driver_id = d.user_id AND x.doc_type = 'PROFILE_PHOTO') AS has_photo,
            (SELECT round(avg(r.rating_for_driver)::numeric, 1)::float8 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.rating_for_driver IS NOT NULL) AS rating_avg,
            (SELECT count(*)::int FROM naya.rides r WHERE r.driver_id = d.user_id AND r.rating_for_driver IS NOT NULL) AS rating_count
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id WHERE d.user_id = $1`,
    [driverId],
  );
  if (!row) return null;
  return {
    name: row.full_name,
    phone: row.phone,
    vehicleType: row.vehicle_type,
    plateNumber: row.plate_number,
    vehicle: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' '),
    color: row.vehicle_color,
    hasPhoto: row.has_photo,
    rating: row.rating_count > 0 ? { average: row.rating_avg, count: row.rating_count } : null,
    location: row.last_lat !== null && row.last_lng !== null ? { lat: row.last_lat, lng: row.last_lng } : null,
  };
}

function baseView(r: RideRow) {
  return {
    id: r.id,
    status: r.status,
    vehicleType: r.vehicle_type,
    pickup: { name: r.pickup_name, lat: r.pickup_lat, lng: r.pickup_lng },
    destination: { name: r.dest_name, lat: r.dest_lat, lng: r.dest_lng },
    distanceKm: r.distance_km,
    fare: r.fare,
    currency: 'TZS' as const,
    paymentMethod: r.payment_method,
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
    requestedAt: r.requested_at,
    acceptedAt: r.accepted_at,
    arrivedAt: r.arrived_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
  };
}

async function passengerView(client: Db, r: RideRow) {
  const driver = r.driver_id && r.status !== 'SEARCHING' ? await driverCard(client, r.driver_id) : null;
  const redispatched =
    r.status === 'SEARCHING' &&
    !!(await one(client, `SELECT 1 FROM naya.ride_status_history WHERE ride_id = $1 AND to_status = 'SEARCHING' AND from_status IS NOT NULL`, [r.id]));
  return {
    ...baseView(r),
    ratingForDriver: r.rating_for_driver,
    redispatched,
    driver: driver && {
      ...driver,
      distanceToPickupKm: driver.location ? round1(straightLineKm(driver.location, { lat: r.pickup_lat, lng: r.pickup_lng })) : null,
    },
  };
}

async function driverView(client: Db, r: RideRow) {
  const passenger = await one<{ full_name: string; phone: string }>(client, 'SELECT full_name, phone FROM naya.users WHERE id = $1', [r.passenger_id]);
  return {
    ...baseView(r),
    ratingForPassenger: r.rating_for_passenger,
    passenger: passenger && { name: passenger.full_name, phone: passenger.phone },
  };
}

const findRide = (client: Db, id: string, lock = false) =>
  one<RideRow>(client, `SELECT * FROM naya.rides WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);

// =================================================================== ABIRIA

export async function requestRide(
  passengerId: string,
  input: { pickup: { locationId: string } | { lat: number; lng: number }; destination: { locationId: string }; vehicleType: VehicleType },
) {
  const online = await one(db, 'SELECT 1 FROM naya.drivers WHERE user_id = $1 AND is_online', [passengerId]);
  if (online) throw conflict('Uko online kama dereva. Nenda offline kwanza ili kuagiza safari.');

  // Nauli inahesabiwa na server (kamwe haitoki kwa app).
  const estimate = await estimateTrip(input);
  const option = estimate.options.find((o) => o.vehicleType === input.vehicleType);
  if (!option) throw conflict('Bei za chombo hiki bado hazijawekwa. Chagua chombo kingine.');

  let rideId: string;
  try {
    rideId = await transaction(async (client) => {
      const row = await one<{ id: string }>(
        client,
        `INSERT INTO naya.rides (passenger_id, vehicle_type, pickup_location_id, pickup_name, pickup_lat, pickup_lng,
                                 dest_location_id, dest_name, dest_lat, dest_lng, distance_km, fare)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          passengerId,
          input.vehicleType,
          estimate.pickup.id,
          estimate.pickup.name,
          estimate.pickup.lat,
          estimate.pickup.lng,
          estimate.destination.id,
          estimate.destination.name,
          estimate.destination.lat,
          estimate.destination.lng,
          option.distanceKm,
          option.fare,
        ],
      );
      await history(client, row!.id, null, 'SEARCHING', passengerId);
      return row!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Una safari inayoendelea tayari.');
    throw error;
  }
  await dispatchRide(rideId);
  return passengerView(db, (await findRide(db, rideId))!);
}

/** Safari ambayo abiria bado anaiona kwenye skrini (inaendelea, au imeisha lakini hajaifunga). */
export async function currentRideForPassenger(passengerId: string) {
  const ride = await one<RideRow>(
    db,
    'SELECT * FROM naya.rides WHERE passenger_id = $1 AND NOT passenger_closed ORDER BY requested_at DESC LIMIT 1',
    [passengerId],
  );
  if (!ride) return null;
  if (ride.status === 'SEARCHING') {
    await dispatchRide(ride.id); // kusonga mbele hata kama kipima-muda cha server hakijafika
    return passengerView(db, (await findRide(db, ride.id))!);
  }
  return passengerView(db, ride);
}

async function ownRide(client: Db, rideId: string, passengerId: string) {
  const ride = await findRide(client, rideId, true);
  if (!ride || ride.passenger_id !== passengerId) throw notFound('Safari haikupatikana');
  return ride;
}

export async function cancelByPassenger(passengerId: string, rideId: string, reason: string | null) {
  await transaction(async (client) => {
    const ride = await ownRide(client, rideId, passengerId);
    if (ride.status === 'IN_PROGRESS') throw conflict('Safari imeshaanza. Huwezi kughairi sasa.');
    if (!['SEARCHING', 'ACCEPTED', 'ARRIVED'].includes(ride.status)) throw conflict('Safari hii imeshaisha.');
    await client.query(
      `UPDATE naya.rides SET status = 'CANCELLED', cancelled_by = 'PASSENGER', cancel_reason = $2, cancelled_at = now(),
              passenger_closed = true, updated_at = now() WHERE id = $1`,
      [rideId, reason],
    );
    await client.query(`UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
    await history(client, rideId, ride.status, 'CANCELLED', passengerId, reason ?? 'Abiria ameghairi');
  });
  return passengerView(db, (await findRide(db, rideId))!);
}

export async function rateDriver(passengerId: string, rideId: string, rating: number, comment: string | null) {
  await transaction(async (client) => {
    const ride = await ownRide(client, rideId, passengerId);
    if (ride.status !== 'COMPLETED') throw conflict('Unaweza kutoa nyota baada ya safari kuisha tu.');
    if (ride.rating_for_driver !== null) throw conflict('Umeshampa dereva nyota kwa safari hii.');
    await client.query(
      `UPDATE naya.rides SET rating_for_driver = $2, comment_for_driver = $3, passenger_closed = true, updated_at = now() WHERE id = $1`,
      [rideId, rating, comment],
    );
  });
  return { rated: true };
}

/** Kufunga skrini ya safari iliyoisha (bila nyota, au baada ya NO_DRIVER / kughairiwa na ofisi). */
export async function closeForPassenger(passengerId: string, rideId: string) {
  await transaction(async (client) => {
    const ride = await ownRide(client, rideId, passengerId);
    if (ACTIVE.includes(ride.status)) throw conflict('Safari bado inaendelea.');
    await client.query('UPDATE naya.rides SET passenger_closed = true, updated_at = now() WHERE id = $1', [rideId]);
  });
  return { closed: true };
}

export async function passengerHistory(passengerId: string) {
  const rides = await many<RideRow>(
    db,
    `SELECT * FROM naya.rides WHERE passenger_id = $1 AND status IN ('COMPLETED', 'CANCELLED', 'NO_DRIVER')
      ORDER BY requested_at DESC LIMIT 20`,
    [passengerId],
  );
  return rides.map(baseView);
}

/** Picha ya dereva kwa abiria wa safari yake tu. */
export async function driverPhotoForPassenger(passengerId: string, rideId: string) {
  const ride = await findRide(db, rideId);
  if (!ride || ride.passenger_id !== passengerId || !ride.driver_id || ride.status === 'SEARCHING') throw notFound('Picha haipatikani');
  return readDocument(ride.driver_id, 'PROFILE_PHOTO');
}

// =================================================================== DEREVA

async function approvedDriver(client: Db, userId: string) {
  const d = await one<{ status: string; is_online: boolean }>(client, 'SELECT status, is_online FROM naya.drivers WHERE user_id = $1', [userId]);
  if (!d) throw notFound('Bado hujaomba kuwa dereva.');
  if (d.status !== 'APPROVED') throw forbidden('Udereva wako haujathibitishwa. Huwezi kupokea safari kwa sasa.');
  return d;
}

const activeDriverRide = (client: Db, driverId: string) =>
  one<RideRow>(client, `SELECT * FROM naya.rides WHERE driver_id = $1 AND status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS')`, [driverId]);

export async function setOnline(
  driverId: string,
  input: { online: boolean; lat?: number; lng?: number; locationId?: string },
) {
  let declinedRide: string | null = null;
  await transaction(async (client) => {
    await approvedDriver(client, driverId);
    if (!input.online) {
      if (await activeDriverRide(client, driverId)) throw conflict('Maliza safari yako kwanza kabla ya kwenda offline.');
      const pending = await one<{ ride_id: string }>(
        client,
        `UPDATE naya.ride_offers SET status = 'DECLINED', responded_at = now() WHERE driver_id = $1 AND status = 'PENDING' RETURNING ride_id`,
        [driverId],
      );
      declinedRide = pending?.ride_id ?? null;
      await client.query('UPDATE naya.drivers SET is_online = false, updated_at = now() WHERE user_id = $1', [driverId]);
      return;
    }
    const passengerRide = await one(
      client,
      `SELECT 1 FROM naya.rides WHERE passenger_id = $1 AND status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')`,
      [driverId],
    );
    if (passengerRide) throw conflict('Una safari inayoendelea kama abiria. Imalize kwanza.');
    let point: { lat: number; lng: number };
    if (input.locationId) {
      const location = await findLocation(client, input.locationId);
      if (!location || !location.isActive) throw notFound('Eneo halipatikani. Chagua jingine.');
      point = { lat: location.lat, lng: location.lng };
    } else if (input.lat !== undefined && input.lng !== undefined) {
      point = { lat: input.lat, lng: input.lng };
      if (!(await insideServiceArea(point))) throw badRequest('Uko nje ya eneo la huduma la NAYA. Huwezi kwenda online hapa.');
    } else {
      throw badRequest('Tunahitaji mahali ulipo: washa GPS au chagua eneo ulilopo.');
    }
    await client.query(
      `UPDATE naya.drivers SET is_online = true, last_lat = $2, last_lng = $3, last_seen_at = now(), updated_at = now() WHERE user_id = $1`,
      [driverId, point.lat, point.lng],
    );
    await client.query(`UPDATE naya.users SET active_mode = 'DRIVER' WHERE id = $1`, [driverId]);
  });
  if (declinedRide) await dispatchRide(declinedRide);
  return driverState(driverId);
}

export async function updateDriverLocation(driverId: string, point: { lat: number; lng: number }) {
  const updated = await one(
    db,
    `UPDATE naya.drivers SET last_lat = $2, last_lng = $3, last_seen_at = now() WHERE user_id = $1 AND is_online RETURNING user_id`,
    [driverId, point.lat, point.lng],
  );
  return { updated: !!updated };
}

/** Kila kitu dereva anahitaji kwenye skrini: online?, ombi linalosubiri, safari inayoendelea, mapato. */
export async function driverState(driverId: string) {
  const d = await one<{ status: string; is_online: boolean }>(db, 'SELECT status, is_online FROM naya.drivers WHERE user_id = $1', [driverId]);
  if (!d) throw notFound('Bado hujaomba kuwa dereva.');
  // App iko wazi → dereva anaonekana (mapigo ya moyo).
  if (d.is_online) await db.query('UPDATE naya.drivers SET last_seen_at = now() WHERE user_id = $1', [driverId]);
  await db.query(
    `UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE driver_id = $1 AND status = 'PENDING' AND expires_at <= now()`,
    [driverId],
  );

  const offerRow = await one<{
    id: string;
    ride_id: string;
    distance_km: number;
    seconds_left: number;
  }>(
    db,
    `SELECT id, ride_id, distance_km, greatest(0, extract(epoch FROM expires_at - now()))::float8 AS seconds_left
       FROM naya.ride_offers WHERE driver_id = $1 AND status = 'PENDING'`,
    [driverId],
  );
  let offer = null;
  if (offerRow) {
    const ride = (await findRide(db, offerRow.ride_id))!;
    offer = {
      id: offerRow.id,
      secondsLeft: Math.floor(offerRow.seconds_left),
      distanceToPickupKm: offerRow.distance_km,
      ride: { ...baseView(ride) },
    };
  }

  const rideRow = await one<RideRow>(
    db,
    'SELECT * FROM naya.rides WHERE driver_id = $1 AND NOT driver_closed ORDER BY requested_at DESC LIMIT 1',
    [driverId],
  );
  const earnings = await one<{ today_trips: number; today_total: number; week_trips: number; week_total: number }>(
    db,
    `WITH bounds AS (
       SELECT (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') AS day_start,
              (date_trunc('week', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') AS week_start)
     SELECT count(*) FILTER (WHERE completed_at >= day_start)::int AS today_trips,
            coalesce(sum(fare) FILTER (WHERE completed_at >= day_start), 0)::int AS today_total,
            count(*) FILTER (WHERE completed_at >= week_start)::int AS week_trips,
            coalesce(sum(fare) FILTER (WHERE completed_at >= week_start), 0)::int AS week_total
       FROM naya.rides, bounds
      WHERE driver_id = $1 AND status = 'COMPLETED'`,
    [driverId],
  );
  return {
    driverStatus: d.status,
    online: d.is_online,
    offer,
    ride: rideRow ? await driverView(db, rideRow) : null,
    earnings: {
      today: { trips: earnings?.today_trips ?? 0, total: earnings?.today_total ?? 0 },
      week: { trips: earnings?.week_trips ?? 0, total: earnings?.week_total ?? 0 },
    },
  };
}

export async function acceptOffer(driverId: string, offerId: string) {
  let lostRide: string | null = null;
  try {
    await transaction(async (client) => {
      await approvedDriver(client, driverId);
      const offer = await one<{ id: string; ride_id: string; status: string; expired: boolean }>(
        client,
        `SELECT id, ride_id, status, expires_at <= now() AS expired FROM naya.ride_offers WHERE id = $1 AND driver_id = $2 FOR UPDATE`,
        [offerId, driverId],
      );
      if (!offer) throw notFound('Ombi halikupatikana.');
      if (offer.status !== 'PENDING' || offer.expired) {
        if (offer.status === 'PENDING') {
          await client.query(`UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE id = $1`, [offerId]);
          lostRide = offer.ride_id;
        }
        throw conflict('Ombi hili limeisha muda.');
      }
      const ride = (await findRide(client, offer.ride_id, true))!;
      if (ride.status !== 'SEARCHING') {
        await client.query(`UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE id = $1`, [offerId]);
        throw conflict('Safari hii haipatikani tena.');
      }
      await client.query(
        `UPDATE naya.rides SET driver_id = $2, status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = $1`,
        [ride.id, driverId],
      );
      await client.query(`UPDATE naya.ride_offers SET status = 'ACCEPTED', responded_at = now() WHERE id = $1`, [offerId]);
      await history(client, ride.id, 'SEARCHING', 'ACCEPTED', driverId);
    });
  } catch (error) {
    if (lostRide) await dispatchRide(lostRide);
    if (isUniqueViolation(error)) throw conflict('Una safari nyingine inayoendelea.');
    throw error;
  }
  return driverState(driverId);
}

export async function declineOffer(driverId: string, offerId: string) {
  const offer = await one<{ ride_id: string }>(
    db,
    `UPDATE naya.ride_offers SET status = 'DECLINED', responded_at = now()
      WHERE id = $1 AND driver_id = $2 AND status = 'PENDING' RETURNING ride_id`,
    [offerId, driverId],
  );
  if (offer) await dispatchRide(offer.ride_id);
  return driverState(driverId);
}

const STEP = {
  arrive: { from: 'ACCEPTED', to: 'ARRIVED', column: 'arrived_at' },
  start: { from: 'ARRIVED', to: 'IN_PROGRESS', column: 'started_at' },
  complete: { from: 'IN_PROGRESS', to: 'COMPLETED', column: 'completed_at' },
} as const;

/** Nimefika → Anza safari → Maliza safari (dereva wa safari hii tu, kwa mpangilio huo tu). */
export async function advanceRide(driverId: string, rideId: string, step: keyof typeof STEP) {
  const { from, to, column } = STEP[step];
  await transaction(async (client) => {
    const updated = await one(
      client,
      `UPDATE naya.rides SET status = $3, ${column} = now(), updated_at = now()
        WHERE id = $1 AND driver_id = $2 AND status = $4 RETURNING id`,
      [rideId, driverId, to, from],
    );
    if (!updated) {
      const ride = await findRide(client, rideId);
      if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
      throw conflict(ride.status === 'CANCELLED' ? 'Abiria ameghairi safari hii.' : 'Hatua hii haiwezekani kwa sasa.');
    }
    await history(client, rideId, from, to, driverId);
  });
  return driverState(driverId);
}

/** Dereva akighairi kabla ya safari kuanza: safari inarudi kutafuta dereva mwingine. */
export async function cancelByDriver(driverId: string, rideId: string, reason: string) {
  await transaction(async (client) => {
    const ride = await findRide(client, rideId, true);
    if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
    if (!['ACCEPTED', 'ARRIVED'].includes(ride.status)) throw conflict('Huwezi kughairi safari iliyoanza au kuisha.');
    await client.query(
      `UPDATE naya.rides SET status = 'SEARCHING', driver_id = NULL, accepted_at = NULL, arrived_at = NULL,
              search_started_at = now(), updated_at = now() WHERE id = $1`,
      [rideId],
    );
    await history(client, rideId, ride.status, 'SEARCHING', driverId, `Dereva ameghairi: ${reason}`);
  });
  await dispatchRide(rideId);
  return driverState(driverId);
}

export async function ratePassenger(driverId: string, rideId: string, rating: number) {
  await transaction(async (client) => {
    const ride = await findRide(client, rideId, true);
    if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
    if (ride.status !== 'COMPLETED') throw conflict('Unaweza kutoa nyota baada ya safari kuisha tu.');
    if (ride.rating_for_passenger !== null) throw conflict('Umeshampa abiria nyota kwa safari hii.');
    await client.query('UPDATE naya.rides SET rating_for_passenger = $2, driver_closed = true, updated_at = now() WHERE id = $1', [rideId, rating]);
  });
  return driverState(driverId);
}

export async function closeForDriver(driverId: string, rideId: string) {
  await transaction(async (client) => {
    const ride = await findRide(client, rideId, true);
    if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
    if (WITH_DRIVER.includes(ride.status)) throw conflict('Safari bado inaendelea.');
    await client.query('UPDATE naya.rides SET driver_closed = true, updated_at = now() WHERE id = $1', [rideId]);
  });
  return driverState(driverId);
}

export async function driverHistory(driverId: string) {
  const rides = await many<RideRow>(
    db,
    `SELECT * FROM naya.rides WHERE driver_id = $1 AND status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 20`,
    [driverId],
  );
  return rides.map(baseView);
}

/** Kubadili mode kunaruhusiwa tu kama hakuna safari inayoendelea upande unaoachwa. */
export async function assertCanSwitchMode(client: Db, userId: string, to: 'PASSENGER' | 'DRIVER') {
  if (to === 'PASSENGER') {
    if (await activeDriverRide(client, userId)) throw conflict('Maliza safari yako ya udereva kwanza.');
    const pending = await one<{ ride_id: string }>(
      client,
      `UPDATE naya.ride_offers SET status = 'DECLINED', responded_at = now() WHERE driver_id = $1 AND status = 'PENDING' RETURNING ride_id`,
      [userId],
    );
    await client.query('UPDATE naya.drivers SET is_online = false WHERE user_id = $1', [userId]);
    return pending?.ride_id ?? null;
  }
  const passengerRide = await one(
    client,
    `SELECT 1 FROM naya.rides WHERE passenger_id = $1 AND status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')`,
    [userId],
  );
  if (passengerRide) throw conflict('Una safari inayoendelea kama abiria. Imalize kwanza.');
  return null;
}

// =================================================================== OFISI

export async function listRidesForAdmin(scope: 'active' | 'all') {
  return many(
    db,
    `SELECT r.id, r.status, r.vehicle_type AS "vehicleType", r.pickup_name AS "pickupName", r.dest_name AS "destinationName",
            r.fare, r.distance_km AS "distanceKm", r.requested_at AS "requestedAt", r.completed_at AS "completedAt",
            p.full_name AS "passengerName", p.phone AS "passengerPhone",
            du.full_name AS "driverName", du.phone AS "driverPhone", d.plate_number AS "plateNumber"
       FROM naya.rides r
       JOIN naya.users p ON p.id = r.passenger_id
       LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
       LEFT JOIN naya.users du ON du.id = r.driver_id
      WHERE ($1 = 'all' OR r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
      ORDER BY r.requested_at DESC
      LIMIT 100`,
    [scope],
  );
}

export async function rideForAdmin(rideId: string) {
  const ride = await findRide(db, rideId);
  if (!ride) throw notFound('Safari haikupatikana');
  const [passenger, driver, timeline, offers] = await Promise.all([
    one<{ full_name: string; phone: string }>(db, 'SELECT full_name, phone FROM naya.users WHERE id = $1', [ride.passenger_id]),
    ride.driver_id ? driverCard(db, ride.driver_id) : null,
    many(
      db,
      `SELECT h.from_status AS "from", h.to_status AS "to", h.note, h.created_at AS "at", u.full_name AS "actorName"
         FROM naya.ride_status_history h LEFT JOIN naya.users u ON u.id = h.actor_id
        WHERE h.ride_id = $1 ORDER BY h.id`,
      [rideId],
    ),
    many(
      db,
      `SELECT o.status, o.distance_km AS "distanceKm", o.offered_at AS "offeredAt", u.full_name AS "driverName"
         FROM naya.ride_offers o JOIN naya.users u ON u.id = o.driver_id WHERE o.ride_id = $1 ORDER BY o.offered_at`,
      [rideId],
    ),
  ]);
  return {
    ...baseView(ride),
    ratingForDriver: ride.rating_for_driver,
    ratingForPassenger: ride.rating_for_passenger,
    passenger: passenger && { name: passenger.full_name, phone: passenger.phone },
    driver,
    timeline,
    offers,
  };
}

export async function cancelByAdmin(adminId: string, rideId: string, reason: string) {
  await transaction(async (client) => {
    const ride = await findRide(client, rideId, true);
    if (!ride) throw notFound('Safari haikupatikana');
    if (!ACTIVE.includes(ride.status)) throw conflict('Safari hii imeshaisha.');
    await client.query(
      `UPDATE naya.rides SET status = 'CANCELLED', cancelled_by = 'ADMIN', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1`,
      [rideId, reason],
    );
    await client.query(`UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
    await history(client, rideId, ride.status, 'CANCELLED', adminId, reason);
    await writeAudit(client, { actorId: adminId, action: 'ride.cancelled', targetType: 'ride', targetId: rideId, details: { reason } });
  });
  return rideForAdmin(rideId);
}

export async function rideStats() {
  const row = await one<{ active: number; completed_today: number; value_today: number; no_driver_today: number; drivers_online: number }>(
    db,
    `WITH day AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') AS start)
     SELECT
       (SELECT count(*)::int FROM naya.rides WHERE status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')) AS active,
       (SELECT count(*)::int FROM naya.rides, day WHERE status = 'COMPLETED' AND completed_at >= day.start) AS completed_today,
       (SELECT coalesce(sum(fare), 0)::int FROM naya.rides, day WHERE status = 'COMPLETED' AND completed_at >= day.start) AS value_today,
       (SELECT count(*)::int FROM naya.rides, day WHERE status = 'NO_DRIVER' AND requested_at >= day.start) AS no_driver_today,
       (SELECT count(*)::int FROM naya.drivers WHERE is_online AND last_seen_at > now() - make_interval(secs => $1::float8)) AS drivers_online`,
    [DRIVER_STALE_SECONDS],
  );
  return {
    active: row?.active ?? 0,
    completedToday: row?.completed_today ?? 0,
    valueToday: row?.value_today ?? 0,
    noDriverToday: row?.no_driver_today ?? 0,
    driversOnline: row?.drivers_online ?? 0,
  };
}
