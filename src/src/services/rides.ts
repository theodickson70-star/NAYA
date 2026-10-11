// Safari: kuagiza, kumpata dereva (dispatch), hali za safari, kughairi, rating, mapato, na ofisi.
//
// Hali:  SEARCHING → ACCEPTED → ARRIVED → IN_PROGRESS → COMPLETED
//                  ↘ NO_DRIVER          ↘ CANCELLED (abiria / ofisi)
// Dereva akighairi kabla ya safari kuanza, safari inarudi SEARCHING (tunamtafutia abiria dereva mwingine).
//
// Kila badiliko linafanyika ndani ya transaction kwa "UPDATE … WHERE status = <inayotarajiwa>" au row lock,
// na database ina unique indexes zinazozuia dereva/abiria kuwa na safari mbili zinazoendelea.
import { randomInt } from 'node:crypto';
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { publish } from '../realtime/hub.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { readDocument } from './drivers.js';
import { straightLineKm } from './fare-engine.js';
import { notify, notifyAdmins } from './notify.js';
import { estimateTrip, findLocation, nearestServicePoint, SERVICE_RADIUS_KM } from './places.js';
import { openSosFor } from './safety.js';
import { assertPhoneVerified } from './verification.js';
import { bestPromotion, driverLimitMessage, driverPromoUsage, driversOverPromoLimit } from './promotions.js';
import { assertSubscriptionOk, describeSubscription, getSettings, SUBSCRIPTION_OK_SQL } from './subscriptions.js';

export type RideStatus = 'SEARCHING' | 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_DRIVER';
type VehicleType = 'BODABODA' | 'BAJAJI';

/**
 * Kumpata dereva kwa MAWIMBI (kama Bolt/Uber):
 *   Wimbi la 1: dereva aliye karibu zaidi peke yake, sekunde FIRST_OFFER_SECONDS.
 *   Asipokubali (amekataa / muda umeisha): madereva WAVE_SIZE wanaofuata kwa PAMOJA, sekunde OFFER_SECONDS —
 *   anayebonyeza "Kubali" kwanza ndiye anapata safari; wengine ombi linaondoka ("dereva mwingine amewahi").
 *   Bado hakuna? Wimbi jingine la madereva WAVE_SIZE wanaofuata, mpaka SEARCH_TIMEOUT_SECONDS.
 */
export const FIRST_OFFER_SECONDS = 20;
export const OFFER_SECONDS = 30; // kila wimbi baada ya la kwanza (na ombi la ofisi kwa dereva maalum)
export const WAVE_SIZE = 3;
export const SEARCH_TIMEOUT_SECONDS = 600; // dakika 10 bila dereva → NO_DRIVER
export const NEARBY_LIMIT = 3; // "NAYA karibu nawe": madereva wangapi wa kila chombo abiria anawaona
export const MAX_PICKUP_KM = 10; // dereva awe ndani ya umbali huu kutoka kwa abiria
export const DRIVER_STALE_SECONDS = 120; // dereva wa browser asiyeonekana kwa muda huu hapewi maombi
/**
 * Dereva mwenye app ya NAYA (APK, Firebase): skrini ikizimwa Android inasimamisha ukurasa, lakini kengele (FCM)
 * bado inamwamsha. Kwa hiyo anabaki kwenye orodha ya maombi kwa muda huu tangu alipoonekana mara ya mwisho.
 * (APK mpya inatuma mahali alipo chinichini kila sekunde 30 — mahali pake panabaki sahihi.)
 */
export const APP_DRIVER_STALE_SECONDS = 30 * 60;
/** Dereva akikosa kujibu maombi haya mfululizo (simu imezimika / hayupo), anawekwa offline — wateja wasisubiri bure. */
export const MISSED_OFFERS_OFFLINE = 2;
/**
 * Safari rahisi (kama Bolt): PIN ni ya safari za ofa tu. GPS ya dereva inasaidia:
 *  - ndani ya mita 100 za abiria → "Nimefika" yenyewe;
 *  - "Nimefika" kwa mkono inakataliwa dereva akiwa zaidi ya km 1 (GPS mpya);
 *  - ameondoka zaidi ya mita 300 kuelekea unakoenda (bila PIN) → safari inaanza yenyewe;
 *  - ndani ya mita 200 za unakoenda → anakumbushwa "Maliza"; baada ya dakika 5 safari inamalizwa yenyewe.
 * Alama kwa ofisi: START_FAR (alianza mbali na abiria), ENDED_FAR (alimaliza mbali na unakoenda), TOO_SHORT, AUTO_TIMEOUT.
 */
const AUTO_ARRIVE_KM = 0.1;
const ARRIVE_MAX_KM = 1;
const START_LEAVE_KM = 0.3;
const START_FAR_KM = 0.5;
const DEST_NEAR_KM = 0.2;
const END_FAR_KM = 0.5;
export const AUTO_COMPLETE_MINUTES = 5;
const MAX_TRIP_HOURS = 3;
const GPS_FRESH_SECONDS = 120;
export const PIN_MAX_ATTEMPTS = 5; // PIN ya safari ikikosewa mara hizi, dereva hawezi kuanza safari (wasiliana na ofisi)
const CITY_SPEED_KMH = 22; // makadirio ya mwendo mjini (bodaboda/bajaji) kwa muda wa kufika
const ROAD_FACTOR = 1.3;

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
  start_pin: string | null;
  pin_attempts: number;
  share_token_hash: Buffer | null;
  /** Ofa (migration 019): abiria analipa fare − promo_discount; NAYA inamlipa dereva promo_discount. */
  promotion_id: string | null;
  promo_discount: number;
  promo_title: string | null;
  /** Migration 021: alama za ofisi, GPS ya kufika, na nani alimaliza safari. */
  flags: string[];
  near_dest_at: Date | null;
  auto_arrived: boolean;
  auto_started: boolean;
  completed_by: 'DRIVER' | 'PASSENGER' | 'AUTO' | 'ADMIN' | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Dakika za kufika (km za mstari ulionyooka × barabara ÷ mwendo wa mjini), angalau dakika 1. */
export const etaMinutes = (km: number) => Math.max(1, Math.ceil(((km * ROAD_FACTOR) / CITY_SPEED_KMH) * 60));
const newPin = () => String(randomInt(0, 10_000)).padStart(4, '0');
const tsh = (n: number) => `TSh ${Math.round(n).toLocaleString('en-US')}`;
/** Maandishi ya ombi kwa dereva: safari ya ofa inaonyesha abiria analipa kiasi gani na NAYA inamlipa kiasi gani. */
const offerBody = (r: Pick<RideRow, 'fare' | 'promo_discount' | 'pickup_name' | 'dest_name'>) =>
  r.promo_discount > 0
    ? `${tsh(r.fare)} (abiria ${tsh(r.fare - r.promo_discount)} + NAYA ${tsh(r.promo_discount)}) · ${r.pickup_name} → ${r.dest_name}`
    : `${tsh(r.fare)} · ${r.pickup_name} → ${r.dest_name}`;

async function history(client: Db, rideId: string, from: RideStatus | null, to: RideStatus, actorId: string | null, note?: string) {
  await client.query(
    'INSERT INTO naya.ride_status_history (ride_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)',
    [rideId, from, to, actorId, note ?? null],
  );
}

// Umbali (km) kwa SQL — kwa kuchagua dereva aliye karibu zaidi.
/** Dereva "anaonekana": ndani ya sekunde ${staleParam} (browser), au dakika 30 kama ana app ya NAYA yenye kengele. */
export const FRESH_SQL = (alias: string, staleParam: string) =>
  `(${alias}.last_seen_at > now() - make_interval(secs => ${staleParam}::float8)
    OR (${alias}.last_seen_at > now() - make_interval(secs => ${APP_DRIVER_STALE_SECONDS}::float8)
        AND EXISTS (SELECT 1 FROM naya.fcm_tokens t WHERE t.user_id = ${alias}.user_id AND t.failures < 5)))`;

const DISTANCE_SQL = (latCol: string, lngCol: string, latParam: string, lngParam: string) => `
  (6371.0088 * 2 * asin(sqrt(
     power(sin(radians((${latCol})::float8 - ${latParam}::float8) / 2), 2) +
     cos(radians(${latParam}::float8)) * cos(radians((${latCol})::float8)) *
     power(sin(radians((${lngCol})::float8 - ${lngParam}::float8) / 2), 2))))`;

// =================================================================== DISPATCH

/** Inaisha maombi yaliyopitwa na muda, kisha inajaribu kumpata dereva kwa kila safari inayotafuta. */
export async function dispatchPending(): Promise<void> {
  const expired = await many<{ driver_id: string; ride_id: string }>(
    db,
    `UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE status = 'PENDING' AND expires_at <= now()
     RETURNING driver_id, ride_id`,
  );
  for (const o of expired) await notify({ userId: o.driver_id, event: 'offer', rideId: o.ride_id });
  if (expired.length) await offlineDriversWhoMissOffers([...new Set(expired.map((o) => o.driver_id))]);
  const rides = await many<{ id: string }>(db, `SELECT id FROM naya.rides WHERE status = 'SEARCHING' ORDER BY requested_at LIMIT 50`);
  for (const ride of rides) await dispatchRide(ride.id);
  await autoCompleteRides();
}

/** Madereva waliokosa kujibu maombi MISSED_OFFERS_OFFLINE mfululizo tangu waende online → offline, na wanajulishwa. */
async function offlineDriversWhoMissOffers(driverIds: string[]) {
  const off = await many<{ user_id: string }>(
    db,
    `UPDATE naya.drivers d SET is_online = false, updated_at = now()
      WHERE d.user_id = ANY($1::uuid[]) AND d.is_online
        AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
        AND (SELECT count(*) FROM (
              SELECT o.status FROM naya.ride_offers o
               WHERE o.driver_id = d.user_id AND o.offered_at >= coalesce(d.online_since, '-infinity'::timestamptz)
               ORDER BY o.offered_at DESC LIMIT $2) last
             WHERE last.status = 'EXPIRED') = $2
      RETURNING d.user_id`,
    [driverIds, MISSED_OFFERS_OFFLINE],
  );
  for (const d of off) {
    await notify({
      userId: d.user_id,
      event: 'driver',
      kind: 'auto_offline',
      title: 'Umewekwa offline',
      body: 'Hukujibu maombi 2 ya safari mfululizo. Ukiwa tayari kupokea safari, fungua NAYA na ubonyeze NENDA ONLINE.',
    });
  }
  if (off.length) await notifyAdmins();
}

/** Kwa safari moja: wimbi linalofuata la maombi (kama hakuna ombi linalosubiri); muda wa kutafuta ukiisha → NO_DRIVER. */
/** Madereva wanaoweza kupewa ombi la safari hii sasa, aliye karibu zaidi kwanza. */
async function findCandidates(
  client: Db,
  p: { rideId: string | null; lat: number; lng: number; vehicleType: VehicleType; passengerId: string; graceDays: number; limit: number; exclude: string[] },
) {
  return many<{ user_id: string; km: number }>(
    client,
    `SELECT d.user_id, ${DISTANCE_SQL('d.last_lat', 'd.last_lng', '$2', '$3')} AS km
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
      WHERE d.status = 'APPROVED' AND d.is_online AND u.status = 'ACTIVE' AND d.vehicle_type = $4
        AND d.last_lat IS NOT NULL AND ${FRESH_SQL('d', '$5')}
        AND d.user_id <> $6
        AND ${SUBSCRIPTION_OK_SQL('d', '$7')}
        AND d.user_id <> ALL($9::uuid[])
        AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
        AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.passenger_id = d.user_id AND r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
        AND NOT EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'PENDING')
        AND NOT EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.ride_id = $1::uuid AND o.driver_id = d.user_id)
      ORDER BY km ASC
      LIMIT $8`,
    [p.rideId, p.lat, p.lng, p.vehicleType, DRIVER_STALE_SECONDS, p.passengerId, p.graceDays, p.limit, p.exclude],
  );
}

export async function dispatchRide(rideId: string): Promise<void> {
  type Outcome = { offeredTo?: string[]; seconds?: number; noDriver?: boolean; passengerId?: string; ride?: RideRow };
  let promoDropped: { passengerId: string; fare: number } | null = null;
  const outcome: Outcome = await transaction(async (client): Promise<Outcome> => {
    const ride = await one<RideRow & { search_age_s: number }>(
      client,
      `SELECT *, extract(epoch FROM now() - search_started_at)::float8 AS search_age_s
         FROM naya.rides WHERE id = $1 AND status = 'SEARCHING' FOR UPDATE SKIP LOCKED`,
      [rideId],
    );
    if (!ride) return {};
    await client.query(
      `UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' AND expires_at <= now()`,
      [rideId],
    );
    // Wimbi bado linaendelea (angalau dereva mmoja bado anaweza kukubali) → subiri.
    const waiting = await one(client, `SELECT 1 FROM naya.ride_offers WHERE ride_id = $1 AND status = 'PENDING' LIMIT 1`, [rideId]);
    if (waiting) return {};
    const tried = await one<{ n: number }>(client, `SELECT count(*)::int AS n FROM naya.ride_offers WHERE ride_id = $1`, [rideId]);
    const firstWave = (tried?.n ?? 0) === 0;
    const waveSize = firstWave ? 1 : WAVE_SIZE;
    const seconds = firstWave ? FIRST_OFFER_SECONDS : OFFER_SECONDS;

    const { graceDays } = await getSettings(client);
    const base = { rideId, lat: ride.pickup_lat, lng: ride.pickup_lng, vehicleType: ride.vehicle_type, passengerId: ride.passenger_id, graceDays, limit: waveSize + 5 };
    // Safari ya ofa yenye kikomo cha dereva: madereva waliofikia kikomo hawapewi.
    let candidates = await findCandidates(client, { ...base, exclude: ride.promotion_id ? await driversOverPromoLimit(client, ride.promotion_id) : [] });
    if (ride.promotion_id && !candidates.some((c) => c.km <= MAX_PICKUP_KM)) {
      const everyone = await findCandidates(client, { ...base, exclude: [] });
      if (everyone.some((c) => c.km <= MAX_PICKUP_KM)) {
        // Hakuna dereva mwenye nafasi ya ofa karibu: safari inaendelea bila ofa (abiria anaambiwa, anaweza kughairi bure).
        await client.query(`UPDATE naya.rides SET promotion_id = NULL, promo_discount = 0, promo_title = NULL, start_pin = NULL, updated_at = now() WHERE id = $1`, [rideId]);
        await history(client, rideId, 'SEARCHING', 'SEARCHING', null, `Ofa imeondolewa: madereva waliopo wamefikia kikomo cha ofa (${ride.promo_title ?? ''})`);
        promoDropped = { passengerId: ride.passenger_id, fare: ride.fare };
        ride.promotion_id = null;
        ride.promo_discount = 0;
        ride.promo_title = null;
        candidates = everyone;
      }
    }
    const offeredTo: string[] = [];
    for (const candidate of candidates) {
      if (candidate.km > MAX_PICKUP_KM || offeredTo.length >= waveSize) break;
      // ON CONFLICT: dereva huyu amepewa ombi jingine sekunde hii hii → jaribu anayefuata.
      const offered = await one(
        client,
        `INSERT INTO naya.ride_offers (ride_id, driver_id, distance_km, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4::float8))
         ON CONFLICT DO NOTHING RETURNING id`,
        [rideId, candidate.user_id, round1(candidate.km), seconds],
      );
      if (offered) offeredTo.push(candidate.user_id);
    }
    if (offeredTo.length) return { offeredTo, seconds, ride };

    if (ride.search_age_s > SEARCH_TIMEOUT_SECONDS) {
      await client.query(`UPDATE naya.rides SET status = 'NO_DRIVER', updated_at = now() WHERE id = $1`, [rideId]);
      await history(client, rideId, 'SEARCHING', 'NO_DRIVER', null, 'Hakuna dereva aliyepatikana');
      return { noDriver: true, passengerId: ride.passenger_id };
    }
    return {};
  });

  if (outcome.offeredTo?.length && outcome.ride) {
    const r = outcome.ride;
    await Promise.all(
      outcome.offeredTo.map((userId) =>
        notify({
          userId,
          event: 'offer',
          rideId,
          kind: 'offer',
          title: r.promo_discount > 0 ? 'Ombi jipya la safari (ofa)' : 'Ombi jipya la safari',
          body: offerBody(r),
          urgent: true,
          ttlSeconds: outcome.seconds ?? OFFER_SECONDS,
        }),
      ),
    );
    await notifyAdmins(rideId);
  }
  if (promoDropped) {
    const d = promoDropped as { passengerId: string; fare: number };
    await notify({
      userId: d.passengerId,
      event: 'ride',
      rideId,
      kind: 'promo_dropped',
      title: 'Ofa haipatikani kwa safari hii',
      body: `Madereva walio karibu wamefikia kikomo cha safari za ofa. Tunaendelea kukutafutia dereva kwa nauli ya kawaida ${tsh(d.fare)}. Unaweza kughairi bila gharama.`,
    });
  }
  if (outcome.noDriver && outcome.passengerId) {
    await notify({
      userId: outcome.passengerId,
      event: 'ride',
      rideId,
      kind: 'no_driver',
      title: 'Hakuna dereva aliyepatikana',
      body: 'Samahani, hakuna dereva karibu kwa sasa. Jaribu tena baada ya dakika chache.',
    });
    await notifyAdmins(rideId);
  }
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
    last_seen_at: Date | null;
    has_photo: boolean;
    rating_avg: number | null;
    rating_count: number;
  }>(
    client,
    `SELECT u.full_name, u.phone, d.vehicle_type, d.plate_number, d.vehicle_make, d.vehicle_model, d.vehicle_color,
            d.last_lat, d.last_lng, d.last_seen_at,
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
    location: row.last_lat !== null && row.last_lng !== null ? { lat: row.last_lat, lng: row.last_lng, at: row.last_seen_at } : null,
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
    // Ofa: abiria analipa dereva passengerPays taslimu; NAYA inamlipa dereva promo.discount.
    passengerPays: r.fare - (r.promo_discount ?? 0),
    promo: r.promo_discount > 0 ? { title: r.promo_title, discount: r.promo_discount } : null,
    completedBy: r.completed_by,
    autoStarted: r.auto_started,
    nearDestination: !!r.near_dest_at,
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
  const target = r.status === 'IN_PROGRESS' ? { lat: r.dest_lat, lng: r.dest_lng } : { lat: r.pickup_lat, lng: r.pickup_lng };
  const km = driver?.location ? straightLineKm(driver.location, target) : null;
  const live = WITH_DRIVER.includes(r.status);
  return {
    ...baseView(r),
    ratingForDriver: r.rating_for_driver,
    redispatched,
    // PIN ya kuanza safari: abiria anampa dereva akishapanda (inaonekana kwa abiria tu).
    pin: ['ACCEPTED', 'ARRIVED'].includes(r.status) ? r.start_pin : null,
    shared: live && r.share_token_hash !== null,
    sosOpen: live ? await openSosFor(client, r.passenger_id, r.id) : false,
    driver: driver && {
      ...driver,
      location: live ? driver.location : null,
      distanceToPickupKm: driver.location && r.status === 'ACCEPTED' ? round1(km!) : null,
      // ACCEPTED: muda wa dereva kufika kwa abiria · IN_PROGRESS: muda uliobaki kufika unakoenda
      etaMinutes: km !== null && (r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS') ? etaMinutes(km) : null,
    },
  };
}

async function driverView(client: Db, r: RideRow) {
  const passenger = await one<{ full_name: string; phone: string }>(client, 'SELECT full_name, phone FROM naya.users WHERE id = $1', [r.passenger_id]);
  return {
    ...baseView(r),
    ratingForPassenger: r.rating_for_passenger,
    passenger: passenger && { name: passenger.full_name, phone: passenger.phone },
    pinRequired: r.status === 'ARRIVED' && r.start_pin !== null,
    pinAttemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - r.pin_attempts),
    sosOpen: r.driver_id && WITH_DRIVER.includes(r.status) ? await openSosFor(client, r.driver_id, r.id) : false,
  };
}

const findRide = (client: Db, id: string, lock = false) =>
  one<RideRow>(client, `SELECT * FROM naya.rides WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);

// =================================================================== NAYA KARIBU NAWE

/**
 * Madereva walio karibu na abiria (kabla hajaagiza): hadi 3 kwa kila chombo — wale tu wanaoweza kupewa safari sasa hivi.
 * Faragha ya dereva: hakuna jina wala namba; mahali panazungushwa hadi ~mita 100, na kila dereva ana namba ya muda tu.
 */
export async function nearbyDrivers(userId: string, point: { lat: number; lng: number }) {
  const { graceDays } = await getSettings();
  const rows = await many<{ vehicle_type: VehicleType; lat: number; lng: number; km: number; rank: number }>(
    db,
    `WITH c AS (
       SELECT d.vehicle_type, d.last_lat AS lat, d.last_lng AS lng, ${DISTANCE_SQL('d.last_lat', 'd.last_lng', '$1', '$2')} AS km
         FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
        WHERE d.status = 'APPROVED' AND d.is_online AND u.status = 'ACTIVE' AND d.vehicle_type IS NOT NULL
          AND d.last_lat IS NOT NULL AND ${FRESH_SQL('d', '$3')}
          AND d.user_id <> $4
          AND ${SUBSCRIPTION_OK_SQL('d', '$5')}
          AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
     )
     SELECT * FROM (
       SELECT c.*, row_number() OVER (PARTITION BY vehicle_type ORDER BY km) AS rank FROM c WHERE km <= $6
     ) x WHERE rank <= $7 ORDER BY vehicle_type, km`,
    [point.lat, point.lng, DRIVER_STALE_SECONDS, userId, graceDays, MAX_PICKUP_KM, NEARBY_LIMIT],
  );
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const group = (type: VehicleType) =>
    rows
      .filter((r) => r.vehicle_type === type)
      .map((r) => ({ key: `${type[0]}${r.rank}`, lat: round3(r.lat), lng: round3(r.lng), distanceKm: round1(r.km), etaMinutes: etaMinutes(r.km) }));
  return { BODABODA: group('BODABODA'), BAJAJI: group('BAJAJI') };
}

// =================================================================== ABIRIA

export async function requestRide(
  passengerId: string,
  input: { pickup: { locationId: string } | { lat: number; lng: number }; destination: { locationId: string }; vehicleType: VehicleType },
) {
  await assertPhoneVerified(db, passengerId);
  const online = await one(db, 'SELECT 1 FROM naya.drivers WHERE user_id = $1 AND is_online', [passengerId]);
  if (online) throw conflict('Uko online kama dereva. Nenda offline kwanza ili kuagiza safari.');

  // Nauli inahesabiwa na server (kamwe haitoki kwa app).
  const estimate = await estimateTrip(input);
  const option = estimate.options.find((o) => o.vehicleType === input.vehicleType);
  if (!option) throw conflict('Bei za chombo hiki bado hazijawekwa. Chagua chombo kingine.');
  // Ofa (punguzo) — server inaamua. Kama ofa ina kikomo cha dereva, lazima kuwe na dereva mwenye nafasi karibu.
  let promo = await bestPromotion(db, passengerId, input.vehicleType, option.fare);
  let promoBlocked: string | null = null; // ofa ilimfaa, lakini madereva walio karibu wamemaliza nafasi zao
  if (promo) {
    const over = await driversOverPromoLimit(db, promo.promotionId);
    if (over.length) {
      const { graceDays } = await getSettings();
      const nearby = await findCandidates(db, {
        rideId: null, lat: estimate.pickup.lat, lng: estimate.pickup.lng, vehicleType: input.vehicleType, passengerId, graceDays, limit: 3, exclude: over,
      });
      const any = nearby.some((c) => c.km <= MAX_PICKUP_KM);
      const others = any ? true : (await findCandidates(db, { rideId: null, lat: estimate.pickup.lat, lng: estimate.pickup.lng, vehicleType: input.vehicleType, passengerId, graceDays, limit: 3, exclude: [] })).some((c) => c.km <= MAX_PICKUP_KM);
      // Hakuna dereva mwenye nafasi ya ofa lakini wapo wengine → safari ya kawaida (bei kamili inaonyeshwa).
      if (!any && others) {
        promoBlocked = promo.title;
        promo = null;
      }
    }
  }

  let rideId: string;
  try {
    rideId = await transaction(async (client) => {
      const row = await one<{ id: string }>(
        client,
        `INSERT INTO naya.rides (passenger_id, vehicle_type, pickup_location_id, pickup_name, pickup_lat, pickup_lng,
                                 dest_location_id, dest_name, dest_lat, dest_lng, distance_km, fare, start_pin,
                                 promotion_id, promo_discount, promo_title)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
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
          promo ? newPin() : null, // PIN ni kwa safari za ofa tu
          promo?.promotionId ?? null,
          promo?.discount ?? 0,
          promo?.title ?? null,
        ],
      );
      await history(client, row!.id, null, 'SEARCHING', passengerId);
      if (promoBlocked) await history(client, row!.id, 'SEARCHING', 'SEARCHING', null, `Ofa imeondolewa: madereva waliopo wamefikia kikomo cha ofa (${promoBlocked})`);
      return row!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Una safari inayoendelea tayari.');
    throw error;
  }
  await notifyAdmins(rideId);
  if (promoBlocked) {
    await notify({
      userId: passengerId,
      event: 'ride',
      rideId,
      kind: 'promo_dropped',
      title: 'Ofa haipatikani kwa safari hii',
      body: `Madereva walio karibu wamefikia kikomo cha safari za ofa. Tunakutafutia dereva kwa nauli ya kawaida ${tsh(option.fare)}. Unaweza kughairi bila gharama.`,
    });
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
  const affected = await transaction(async (client) => {
    const ride = await ownRide(client, rideId, passengerId);
    if (ride.status === 'IN_PROGRESS') throw conflict('Safari imeshaanza. Huwezi kughairi sasa.');
    if (!['SEARCHING', 'ACCEPTED', 'ARRIVED'].includes(ride.status)) throw conflict('Safari hii imeshaisha.');
    await client.query(
      `UPDATE naya.rides SET status = 'CANCELLED', cancelled_by = 'PASSENGER', cancel_reason = $2, cancelled_at = now(),
              passenger_closed = true, updated_at = now() WHERE id = $1`,
      [rideId, reason],
    );
    const offers = await many<{ driver_id: string }>(
      client,
      `UPDATE naya.ride_offers SET status = 'CANCELLED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' RETURNING driver_id`,
      [rideId],
    );
    await history(client, rideId, ride.status, 'CANCELLED', passengerId, reason ?? 'Abiria ameghairi');
    return { driverId: ride.driver_id, offerDrivers: offers.map((o) => o.driver_id), pickup: ride.pickup_name };
  });
  if (affected.driverId) {
    await notify({
      userId: affected.driverId,
      event: 'ride',
      rideId,
      kind: 'ride_cancelled',
      title: 'Abiria ameghairi safari',
      body: `Safari ya ${affected.pickup} imeghairiwa.`,
    });
  }
  for (const d of affected.offerDrivers) await notify({ userId: d, event: 'offer', rideId });
  await notifyAdmins(rideId);
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
    await assertPhoneVerified(client, driverId);
    await assertSubscriptionOk(client, driverId);
    let point: { lat: number; lng: number };
    if (input.locationId) {
      const location = await findLocation(client, input.locationId);
      if (!location || !location.isActive) throw notFound('Eneo halipatikani. Chagua jingine.');
      point = { lat: location.lat, lng: location.lng };
    } else if (input.lat !== undefined && input.lng !== undefined) {
      // Dereva hazuiwi kwenda online popote alipo: anapokea maombi ya wateja walio ndani ya km MAX_PICKUP_KM tu,
      // kwa hiyo akiwa mbali hapati maombi yasiyomhusu. App inamweleza (driverState.serviceArea).
      point = { lat: input.lat, lng: input.lng };
    } else {
      throw badRequest('Tunahitaji mahali ulipo: washa GPS au chagua eneo ulilopo.');
    }
    await client.query(
      `UPDATE naya.drivers SET is_online = true, online_since = CASE WHEN is_online THEN online_since ELSE now() END,
              last_lat = $2, last_lng = $3, last_seen_at = now(), updated_at = now() WHERE user_id = $1`,
      [driverId, point.lat, point.lng],
    );
    await client.query(`UPDATE naya.users SET active_mode = 'DRIVER' WHERE id = $1`, [driverId]);
  });
  if (declinedRide) await dispatchRide(declinedRide);
  await notifyAdmins();
  return driverState(driverId);
}

export async function updateDriverLocation(driverId: string, point: { lat: number; lng: number }) {
  const updated = await one(
    db,
    `UPDATE naya.drivers SET last_lat = $2, last_lng = $3, last_seen_at = now() WHERE user_id = $1 AND is_online RETURNING user_id`,
    [driverId, point.lat, point.lng],
  );
  if (updated) {
    // Abiria wa safari inayoendelea anaona pikipiki ikisogea kwenye ramani (yeye tu).
    const ride = await one<{
      id: string; driver_id: string; passenger_id: string; status: RideStatus; pickup_lat: number; pickup_lng: number; dest_lat: number; dest_lng: number;
      start_pin: string | null; flags: string[]; near_dest_at: Date | null;
    }>(
      db,
      `SELECT id, driver_id, passenger_id, status, pickup_lat, pickup_lng, dest_lat, dest_lng, start_pin, flags, near_dest_at FROM naya.rides
        WHERE driver_id = $1 AND status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS')`,
      [driverId],
    );
    if (ride) {
      const target = ride.status === 'IN_PROGRESS' ? { lat: ride.dest_lat, lng: ride.dest_lng } : { lat: ride.pickup_lat, lng: ride.pickup_lng };
      const km = straightLineKm(point, target);
      await publish({
        type: 'location',
        userId: ride.passenger_id,
        rideId: ride.id,
        data: {
          lat: point.lat,
          lng: point.lng,
          etaMinutes: ride.status === 'ARRIVED' ? null : etaMinutes(km),
          distanceKm: ride.status === 'ACCEPTED' ? round1(km) : null,
        },
      });
      await autoProgress(ride, point);
    }
  }
  return { updated: !!updated };
}

/** Kila kitu dereva anahitaji kwenye skrini: online?, ombi linalosubiri, safari inayoendelea, mapato. */
export async function driverState(driverId: string) {
  const d = await one<{ status: string; is_online: boolean; paid_until: Date | null; last_lat: number | null; last_lng: number | null }>(
    db,
    'SELECT status, is_online, paid_until, last_lat, last_lng FROM naya.drivers WHERE user_id = $1',
    [driverId],
  );
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
    total_seconds: number;
  }>(
    db,
    `SELECT id, ride_id, distance_km, greatest(0, extract(epoch FROM expires_at - now()))::float8 AS seconds_left,
            round(extract(epoch FROM expires_at - offered_at))::int AS total_seconds
       FROM naya.ride_offers WHERE driver_id = $1 AND status = 'PENDING'`,
    [driverId],
  );
  let offer = null;
  if (offerRow) {
    const ride = (await findRide(db, offerRow.ride_id))!;
    offer = {
      id: offerRow.id,
      secondsLeft: Math.floor(offerRow.seconds_left),
      totalSeconds: offerRow.total_seconds || OFFER_SECONDS,
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
  const settings = await getSettings();
  // Dereva online akiwa mbali na maeneo ya NAYA: mwambie (hapati maombi mpaka awe karibu na wateja).
  let serviceArea: { far: true; km: number; nearest: string; pickupKm: number } | null = null;
  if (d.is_online && d.last_lat !== null && d.last_lng !== null) {
    const nearest = await nearestServicePoint({ lat: Number(d.last_lat), lng: Number(d.last_lng) });
    if (nearest && nearest.km > SERVICE_RADIUS_KM) serviceArea = { far: true, km: Math.round(nearest.km), nearest: nearest.name, pickupKm: MAX_PICKUP_KM };
  }
  // Ombi la mwisho lililoondoka bila dereva kujibu (ili app imwambie kwa nini): mwingine amewahi / limeghairiwa.
  const lastOffer = offer
    ? null
    : await one<{ id: string; status: string }>(
        db,
        `SELECT id, status FROM naya.ride_offers
          WHERE driver_id = $1 AND status IN ('TAKEN', 'CANCELLED') AND responded_at > now() - interval '2 minutes'
          ORDER BY responded_at DESC LIMIT 1`,
        [driverId],
      );
  return {
    driverStatus: d.status,
    online: d.is_online,
    lastOffer,
    serviceArea,
    subscription: { ...describeSubscription(d.paid_until, settings), paymentInstructions: settings.paymentInstructions },
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
  let takenFrom: string[] = [];
  let takenRide = '';
  try {
    await transaction(async (client) => {
      await approvedDriver(client, driverId);
      const offer = await one<{ id: string; ride_id: string; status: string; expired: boolean }>(
        client,
        `SELECT id, ride_id, status, expires_at <= now() AS expired FROM naya.ride_offers WHERE id = $1 AND driver_id = $2 FOR UPDATE`,
        [offerId, driverId],
      );
      if (!offer) throw notFound('Ombi halikupatikana.');
      if (offer.status === 'TAKEN') throw conflict('Dereva mwingine amewahi kukubali safari hii.');
      if (offer.status === 'CANCELLED') throw conflict('Safari hii imeghairiwa.');
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
      if (ride.promotion_id) {
        const u = await driverPromoUsage(client, ride.promotion_id, driverId);
        if (u.limit !== null && u.used >= u.limit) {
          await client.query(`UPDATE naya.ride_offers SET status = 'DECLINED', responded_at = now() WHERE id = $1`, [offerId]);
          lostRide = ride.id;
          throw conflict(driverLimitMessage(u.limit, u.period));
        }
      }
      await client.query(
        `UPDATE naya.rides SET driver_id = $2, status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = $1`,
        [ride.id, driverId],
      );
      await client.query(`UPDATE naya.ride_offers SET status = 'ACCEPTED', responded_at = now() WHERE id = $1`, [offerId]);
      // Wengine wa wimbi hili: dereva huyu amewahi.
      const others = await many<{ driver_id: string }>(
        client,
        `UPDATE naya.ride_offers SET status = 'TAKEN', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' RETURNING driver_id`,
        [ride.id],
      );
      takenFrom = others.map((o) => o.driver_id);
      takenRide = ride.id;
      await history(client, ride.id, 'SEARCHING', 'ACCEPTED', driverId);
    });
  } catch (error) {
    if (lostRide) await dispatchRide(lostRide);
    if (isUniqueViolation(error)) throw conflict('Una safari nyingine inayoendelea.');
    throw error;
  }
  // Simu za wengine wa wimbi zinyamaze, na skrini zao ziondoe ombi.
  for (const d of takenFrom) await notify({ userId: d, event: 'offer', rideId: takenRide });
  const state = await driverState(driverId);
  if (state.ride) {
    const card = await driverCard(db, driverId);
    const ride = (await findRide(db, state.ride.id))!;
    await notify({
      userId: ride.passenger_id,
      event: 'ride',
      rideId: ride.id,
      kind: 'driver_found',
      title: 'Dereva amepatikana',
      body: `${card?.name ?? 'Dereva'} anakuja · ${card?.plateNumber ?? ''}`.trim(),
      urgent: true,
    });
    await notifyAdmins(ride.id);
  }
  return state;
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

/**
 * Kuanza safari kunahitaji PIN ya abiria (inathibitisha dereva amembeba abiria sahihi, na abiria yuko kwenye chombo sahihi).
 * Majaribio yanahesabiwa nje ya transaction ya kuanza, kwa hiyo kukosea kunahifadhiwa hata ombi likikataliwa.
 */
export async function startRide(driverId: string, rideId: string, pin: string | undefined) {
  const ride = await findRide(db, rideId);
  if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
  if (ride.status === 'ARRIVED' && ride.start_pin !== null) {
    if (ride.pin_attempts >= PIN_MAX_ATTEMPTS) {
      throw conflict('PIN imekosewa mara nyingi. Mpigie abiria, au wasiliana na ofisi ya NAYA.');
    }
    if (!pin) throw badRequest('Muulize abiria PIN yake ya tarakimu 4.');
    if (pin !== ride.start_pin) {
      const row = await one<{ pin_attempts: number }>(
        db,
        `UPDATE naya.rides SET pin_attempts = pin_attempts + 1, updated_at = now() WHERE id = $1 AND status = 'ARRIVED' RETURNING pin_attempts`,
        [rideId],
      );
      const left = Math.max(0, PIN_MAX_ATTEMPTS - (row?.pin_attempts ?? PIN_MAX_ATTEMPTS));
      if (left === 0) {
        await history(db, rideId, 'ARRIVED', 'ARRIVED', driverId, `PIN imekosewa mara ${PIN_MAX_ATTEMPTS}`);
        await notifyAdmins(rideId);
        throw conflict('PIN imekosewa mara nyingi. Mpigie abiria, au wasiliana na ofisi ya NAYA.');
      }
      throw badRequest(`PIN si sahihi. Umebakiza majaribio ${left}.`);
    }
  }
  return advanceRide(driverId, rideId, 'start');
}

/** Mahali pa dereva kama GPS yake ni ya karibuni (dakika 2), vinginevyo null. */
async function freshDriverPoint(client: Db, driverId: string) {
  const row = await one<{ lat: number; lng: number }>(
    client,
    `SELECT last_lat::float8 AS lat, last_lng::float8 AS lng FROM naya.drivers
      WHERE user_id = $1 AND last_lat IS NOT NULL AND last_seen_at > now() - make_interval(secs => $2::float8)`,
    [driverId, GPS_FRESH_SECONDS],
  );
  return row;
}

type StepActor = 'DRIVER' | 'SYSTEM' | 'PASSENGER';

/**
 * Nimefika → Anza safari → Maliza safari, kwa mpangilio huo tu.
 * by: DRIVER (amebonyeza), SYSTEM (GPS ya NAYA), PASSENGER (abiria amebonyeza "Nimefika" mwisho wa safari).
 */
export async function advanceRide(driverId: string, rideId: string, step: keyof typeof STEP, opts: { by?: StepActor; flags?: string[] } = {}) {
  const by = opts.by ?? 'DRIVER';
  const { from, to, column } = STEP[step];
  const before = await findRide(db, rideId);
  if (!before || before.driver_id !== driverId) throw notFound('Safari haikupatikana');
  const flags = [...(opts.flags ?? [])];
  const here = await freshDriverPoint(db, driverId);
  const pickup = { lat: Number(before.pickup_lat), lng: Number(before.pickup_lng) };
  const dest = { lat: Number(before.dest_lat), lng: Number(before.dest_lng) };
  if (step === 'arrive' && by === 'DRIVER' && here && straightLineKm(here, pickup) > ARRIVE_MAX_KM) {
    throw conflict(`Bado hujafika kwa abiria (uko km ${round1(straightLineKm(here, pickup))}). Ukifika karibu, NAYA itaweka "Nimefika" yenyewe.`);
  }
  if (step === 'start' && by === 'DRIVER' && here && straightLineKm(here, pickup) > START_FAR_KM) flags.push('START_FAR');
  if (step === 'complete' && by !== 'SYSTEM') {
    if (here && straightLineKm(here, dest) > END_FAR_KM) flags.push('ENDED_FAR');
    const seconds = before.started_at ? (Date.now() - new Date(before.started_at).getTime()) / 1000 : 0;
    if (seconds < 60 && Number(before.distance_km) > 0.5) flags.push('TOO_SHORT');
  }
  const completedBy = step === 'complete' ? (by === 'SYSTEM' ? 'AUTO' : by) : null;
  await transaction(async (client) => {
    const updated = await one(
      client,
      `UPDATE naya.rides SET status = $3, ${column} = now(), updated_at = now(),
              flags = (SELECT array(SELECT DISTINCT unnest(flags || $5::text[]))),
              auto_arrived = auto_arrived OR $6::boolean,
              auto_started = auto_started OR $7::boolean,
              completed_by = coalesce($8::varchar, completed_by)
        WHERE id = $1 AND driver_id = $2 AND status = $4 RETURNING id`,
      [rideId, driverId, to, from, flags, by === 'SYSTEM' && step === 'arrive', by === 'SYSTEM' && step === 'start', completedBy],
    );
    if (!updated) {
      const ride = await findRide(client, rideId);
      if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
      throw conflict(ride.status === 'CANCELLED' ? 'Abiria ameghairi safari hii.' : 'Hatua hii haiwezekani kwa sasa.');
    }
    const note = by === 'SYSTEM' ? 'NAYA (GPS)' : by === 'PASSENGER' ? 'Abiria amethibitisha amefika' : undefined;
    await history(client, rideId, from, to, by === 'DRIVER' ? driverId : by === 'PASSENGER' ? before.passenger_id : null, note);
  });
  const ride = (await findRide(db, rideId))!;
  const pays = tsh(ride.fare - ride.promo_discount);
  const messages = {
    arrive: { title: 'Dereva amefika!', body: `Anakusubiri ${ride.pickup_name}.`, urgent: true },
    start: null,
    complete: {
      title: `Umefika ${ride.dest_name}`,
      body: `Lipa dereva ${pays} taslimu.${ride.promo_discount > 0 ? ` Ofa ya NAYA imelipa ${tsh(ride.promo_discount)}.` : ''} Asante kwa kusafiri na NAYA.`,
      urgent: false,
    },
  } as const;
  const m = messages[step];
  // Abiria akimaliza mwenyewe, hapati arifa ya "umefika" — tayari yuko kwenye skrini.
  if (by === 'PASSENGER') await notify({ userId: ride.passenger_id, event: 'ride', rideId });
  else await notify({ userId: ride.passenger_id, event: 'ride', rideId, kind: `ride_${step}`, ...(m ?? {}) });
  if (by !== 'DRIVER') {
    // Dereva hakubonyeza: mjulishe (skrini yake inajisasisha)
    const driverMsg =
      step === 'start'
        ? { title: 'Safari imeanza', body: 'NAYA imeanza safari yenyewe — umeondoka na abiria. Ukifika, bonyeza Maliza safari.' }
        : step === 'complete'
          ? {
              title: by === 'PASSENGER' ? 'Abiria amefika' : 'Safari imekamilika',
              body: `${by === 'PASSENGER' ? 'Abiria amethibitisha amefika. ' : ''}Pokea ${pays} taslimu kutoka kwa abiria.`,
            }
          : null;
    await notify({ userId: driverId, event: 'ride', rideId, ...(driverMsg ? { kind: `ride_auto_${step}`, ...driverMsg } : {}) });
  }
  await notifyAdmins(rideId);
  return driverState(driverId);
}

/** Abiria: "Nimefika — maliza safari" (dereva akisahau kubonyeza Maliza). */
export async function completeByPassenger(passengerId: string, rideId: string) {
  const ride = await findRide(db, rideId);
  if (!ride || ride.passenger_id !== passengerId) throw notFound('Safari haikupatikana');
  if (ride.status !== 'IN_PROGRESS' || !ride.driver_id) throw conflict('Safari hii haiendelei kwa sasa.');
  await advanceRide(ride.driver_id, rideId, 'complete', { by: 'PASSENGER' });
  return passengerView(db, (await findRide(db, rideId))!);
}

/**
 * GPS ya dereva (kila ping wakati wa safari): fika / anza / kumbusha kumaliza — yenyewe.
 * Kosa lolote hapa halivunji ping (dereva anaendelea kuonekana kwenye ramani).
 */
async function autoProgress(
  ride: { id: string; driver_id: string; status: RideStatus; pickup_lat: number; pickup_lng: number; dest_lat: number; dest_lng: number; start_pin: string | null; flags: string[]; near_dest_at: Date | null },
  point: { lat: number; lng: number },
) {
  const pickup = { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) };
  const dest = { lat: Number(ride.dest_lat), lng: Number(ride.dest_lng) };
  try {
    if (ride.status === 'ACCEPTED' && straightLineKm(point, pickup) <= AUTO_ARRIVE_KM) {
      await advanceRide(ride.driver_id, ride.id, 'arrive', { by: 'SYSTEM' });
      return;
    }
    if (ride.status === 'ARRIVED' && straightLineKm(point, pickup) > START_LEAVE_KM) {
      const towardDest = straightLineKm(point, dest) < straightLineKm(pickup, dest) - 0.1;
      if (ride.start_pin === null && towardDest) {
        await advanceRide(ride.driver_id, ride.id, 'start', { by: 'SYSTEM' });
      } else if (ride.start_pin !== null && !ride.flags.includes('PIN_REMINDED')) {
        await db.query(`UPDATE naya.rides SET flags = array_append(flags, 'PIN_REMINDED') WHERE id = $1`, [ride.id]);
        await notify({
          userId: ride.driver_id,
          event: 'ride',
          rideId: ride.id,
          kind: 'pin_reminder',
          title: 'Ingiza PIN ya abiria',
          body: 'Hii ni safari ya ofa: muulize abiria PIN yake na uianze kwenye NAYA ili NAYA ikulipe sehemu yake.',
          urgent: true,
        });
      }
      return;
    }
    if (ride.status === 'IN_PROGRESS' && !ride.near_dest_at && straightLineKm(point, dest) <= DEST_NEAR_KM) {
      const set = await one(db, `UPDATE naya.rides SET near_dest_at = now() WHERE id = $1 AND near_dest_at IS NULL AND status = 'IN_PROGRESS' RETURNING id`, [ride.id]);
      if (set) {
        await notify({
          userId: ride.driver_id,
          event: 'ride',
          rideId: ride.id,
          kind: 'complete_reminder',
          title: 'Umefika?',
          body: `Bonyeza Maliza safari. Usipobonyeza, NAYA itamaliza safari yenyewe baada ya dakika ${AUTO_COMPLETE_MINUTES}.`,
          urgent: true,
        });
      }
    }
  } catch (error) {
    console.error(`[autoProgress] ${(error as Error).message}`);
  }
}

/** Kila mzunguko wa dispatcher: safari zilizofika unakoenda (dakika 5) au zilizopitiliza saa 3 zinamalizwa. */
export async function autoCompleteRides() {
  const due = await many<{ id: string; driver_id: string; timeout: boolean }>(
    db,
    `SELECT id, driver_id, (near_dest_at IS NULL) AS timeout FROM naya.rides
      WHERE status = 'IN_PROGRESS' AND driver_id IS NOT NULL
        AND ((near_dest_at IS NOT NULL AND near_dest_at < now() - make_interval(mins => $1::int))
             OR started_at < now() - make_interval(hours => $2::int))
      LIMIT 20`,
    [AUTO_COMPLETE_MINUTES, MAX_TRIP_HOURS],
  );
  for (const r of due) {
    try {
      await advanceRide(r.driver_id, r.id, 'complete', { by: 'SYSTEM', flags: r.timeout ? ['AUTO_TIMEOUT'] : [] });
    } catch (error) {
      console.error(`[autoComplete] ${(error as Error).message}`);
    }
  }
}

/** Dereva akighairi kabla ya safari kuanza: safari inarudi kutafuta dereva mwingine. */
export async function cancelByDriver(driverId: string, rideId: string, reason: string) {
  const passengerId = await transaction(async (client) => {
    const ride = await findRide(client, rideId, true);
    if (!ride || ride.driver_id !== driverId) throw notFound('Safari haikupatikana');
    if (!['ACCEPTED', 'ARRIVED'].includes(ride.status)) throw conflict('Huwezi kughairi safari iliyoanza au kuisha.');
    await client.query(
      `UPDATE naya.rides SET status = 'SEARCHING', driver_id = NULL, accepted_at = NULL, arrived_at = NULL,
              search_started_at = now(), updated_at = now() WHERE id = $1`,
      [rideId],
    );
    await history(client, rideId, ride.status, 'SEARCHING', driverId, `Dereva ameghairi: ${reason}`);
    return ride.passenger_id;
  });
  await notify({
    userId: passengerId,
    event: 'ride',
    rideId,
    kind: 'driver_cancelled',
    title: 'Dereva ameghairi',
    body: 'Usijali — tunakutafutia dereva mwingine sasa hivi.',
  });
  await dispatchRide(rideId);
  await notifyAdmins(rideId);
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
  const sos = await many(
    db,
    `SELECT s.id, s.role, s.status, s.created_at AS "createdAt", s.resolved_at AS "resolvedAt", s.resolution_note AS "note", u.full_name AS "name"
       FROM naya.sos_alerts s JOIN naya.users u ON u.id = s.user_id WHERE s.ride_id = $1 ORDER BY s.created_at`,
    [rideId],
  );
  return {
    ...baseView(ride),
    flags: ride.flags.filter((f) => f !== 'PIN_REMINDED'),
    autoArrived: ride.auto_arrived,
    ratingForDriver: ride.rating_for_driver,
    ratingForPassenger: ride.rating_for_passenger,
    pinAttempts: ride.pin_attempts,
    shared: ride.share_token_hash !== null,
    passenger: passenger && { id: ride.passenger_id, name: passenger.full_name, phone: passenger.phone },
    driver: driver && { ...driver, id: ride.driver_id },
    timeline,
    offers,
    sos,
  };
}

export async function cancelByAdmin(adminId: string, rideId: string, reason: string) {
  const affected = await transaction(async (client) => {
    const ride = await findRide(client, rideId, true);
    if (!ride) throw notFound('Safari haikupatikana');
    if (!ACTIVE.includes(ride.status)) throw conflict('Safari hii imeshaisha.');
    await client.query(
      `UPDATE naya.rides SET status = 'CANCELLED', cancelled_by = 'ADMIN', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1`,
      [rideId, reason],
    );
    const offers = await many<{ driver_id: string }>(
      client,
      `UPDATE naya.ride_offers SET status = 'CANCELLED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' RETURNING driver_id`,
      [rideId],
    );
    await history(client, rideId, ride.status, 'CANCELLED', adminId, reason);
    await writeAudit(client, { actorId: adminId, action: 'ride.cancelled', targetType: 'ride', targetId: rideId, details: { reason } });
    return { passengerId: ride.passenger_id, driverId: ride.driver_id, offerDrivers: offers.map((o) => o.driver_id) };
  });
  const notice = { event: 'ride' as const, rideId, kind: 'ride_cancelled', title: 'Safari imeghairiwa na ofisi ya NAYA', body: reason };
  await notify({ userId: affected.passengerId, ...notice });
  if (affected.driverId) await notify({ userId: affected.driverId, ...notice });
  for (const d of affected.offerDrivers) await notify({ userId: d, event: 'offer', rideId });
  await notifyAdmins(rideId);
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

// =================================================================== OFISI: ramani ya moja kwa moja na kuingilia safari

/** Madereva walio online (na mahali pao) + safari zote zinazoendelea — kwa ramani ya ofisi. */
export async function liveOverview() {
  const [drivers, rides] = await Promise.all([
    many(
      db,
      `SELECT d.user_id AS id, u.full_name AS "name", u.phone, d.vehicle_type AS "vehicleType", d.plate_number AS "plateNumber",
              d.last_lat::float8 AS lat, d.last_lng::float8 AS lng, d.last_seen_at AS "lastSeenAt",
              d.last_seen_at < now() - make_interval(secs => $1::float8) AS stale,
              (SELECT r.status FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS') LIMIT 1) AS "rideStatus",
              EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'PENDING') AS "hasOffer"
         FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
        WHERE d.is_online AND d.last_lat IS NOT NULL
        ORDER BY u.full_name`,
      [DRIVER_STALE_SECONDS],
    ),
    many(
      db,
      `SELECT r.id, r.status, r.vehicle_type AS "vehicleType", r.pickup_name AS "pickupName", r.dest_name AS "destinationName",
              r.pickup_lat::float8 AS "pickupLat", r.pickup_lng::float8 AS "pickupLng", r.dest_lat::float8 AS "destLat", r.dest_lng::float8 AS "destLng",
              r.fare, r.requested_at AS "requestedAt", extract(epoch FROM now() - coalesce(r.search_started_at, r.requested_at))::int AS "ageSeconds",
              p.full_name AS "passengerName", du.full_name AS "driverName"
         FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id LEFT JOIN naya.users du ON du.id = r.driver_id
        WHERE r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')
        ORDER BY r.requested_at`,
    ),
  ]);
  return { drivers, rides, staleSeconds: DRIVER_STALE_SECONDS };
}

/** Madereva wanaoweza kupewa safari inayotafuta dereva, wa karibu kwanza (ofisi inachagua mmoja). */
export async function candidatesForRide(rideId: string) {
  const ride = await findRide(db, rideId);
  if (!ride) throw notFound('Safari haikupatikana');
  if (ride.status !== 'SEARCHING') return [];
  const { graceDays } = await getSettings();
  return many(
    db,
    `SELECT d.user_id AS id, u.full_name AS name, d.plate_number AS "plateNumber", ${DISTANCE_SQL('d.last_lat', 'd.last_lng', '$2', '$3')}::float8 AS km,
            NOT ${FRESH_SQL('d', '$5')} AS stale,
            EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'PENDING') AS busy
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
      WHERE d.status = 'APPROVED' AND d.is_online AND u.status = 'ACTIVE' AND d.vehicle_type = $4 AND d.last_lat IS NOT NULL
        AND d.user_id <> $1 AND ${SUBSCRIPTION_OK_SQL('d', '$6')}
        AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
      ORDER BY km LIMIT 10`,
    [ride.passenger_id, ride.pickup_lat, ride.pickup_lng, ride.vehicle_type, DRIVER_STALE_SECONDS, graceDays],
  ).then((rows) => (rows as { km: number }[]).map((r) => ({ ...r, km: round1(r.km) })));
}

/** Ofisi inampa dereva maalum ombi la safari iliyokwama (simu yake inalia kama kawaida). */
export async function offerRideToDriver(adminId: string, rideId: string, driverId: string) {
  const ride = await transaction(async (client) => {
    const r = await one<RideRow>(client, `SELECT * FROM naya.rides WHERE id = $1 FOR UPDATE`, [rideId]);
    if (!r) throw notFound('Safari haikupatikana');
    if (r.status !== 'SEARCHING') throw conflict('Safari hii haitafuti dereva tena.');
    const { graceDays } = await getSettings(client);
    const driver = await one<{ km: number }>(
      client,
      `SELECT ${DISTANCE_SQL('d.last_lat', 'd.last_lng', '$2', '$3')}::float8 AS km
         FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
        WHERE d.user_id = $1 AND d.status = 'APPROVED' AND d.is_online AND u.status = 'ACTIVE' AND d.vehicle_type = $4
          AND d.last_lat IS NOT NULL AND ${SUBSCRIPTION_OK_SQL('d', '$5')}
          AND NOT EXISTS (SELECT 1 FROM naya.rides x WHERE x.driver_id = d.user_id AND x.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
          AND NOT EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'PENDING')`,
      [driverId, r.pickup_lat, r.pickup_lng, r.vehicle_type, graceDays],
    );
    if (!driver) throw conflict('Dereva huyu hapatikani sasa (hayuko online, ana safari/ombi jingine, chombo tofauti, au ada imeisha).');
    // Ombi lililokuwa likimsubiri dereva mwingine linaondolewa; ombi la dereva huyu ndilo pekee.
    const others = await many<{ driver_id: string }>(
      client,
      `UPDATE naya.ride_offers SET status = 'CANCELLED', responded_at = now() WHERE ride_id = $1 AND status = 'PENDING' RETURNING driver_id`,
      [rideId],
    );
    // Dereva aliyewahi kukataa safari hii anaweza kupewa tena na ofisi.
    await client.query(`DELETE FROM naya.ride_offers WHERE ride_id = $1 AND driver_id = $2 AND status <> 'PENDING'`, [rideId, driverId]);
    await client.query(
      `INSERT INTO naya.ride_offers (ride_id, driver_id, distance_km, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4::float8))`,
      [rideId, driverId, round1(driver.km), OFFER_SECONDS],
    );
    // Muda wa kutafuta unaanza upya ili safari isigeuke "hakuna dereva" wakati dereva anafikiria.
    await client.query('UPDATE naya.rides SET search_started_at = now(), updated_at = now() WHERE id = $1', [rideId]);
    await writeAudit(client, { actorId: adminId, action: 'ride.offered_by_admin', targetType: 'ride', targetId: rideId, details: { driverId } });
    return { r, others: others.map((o) => o.driver_id) };
  });
  for (const d of ride.others) await notify({ userId: d, event: 'offer', rideId });
  await notify({
    userId: driverId,
    event: 'offer',
    rideId,
    kind: 'offer',
    title: 'Ombi jipya la safari',
    body: offerBody(ride.r),
    urgent: true,
    ttlSeconds: OFFER_SECONDS,
  });
  await notifyAdmins(rideId);
  return rideForAdmin(rideId);
}

/** Safari iliyokwama (dereva amesahau kubonyeza "Maliza") — ofisi inaimaliza. */
export async function completeByAdmin(adminId: string, rideId: string, note: string) {
  const ride = await transaction(async (client) => {
    const r = await findRide(client, rideId, true);
    if (!r) throw notFound('Safari haikupatikana');
    if (r.status !== 'IN_PROGRESS') throw conflict('Ofisi inaweza kumaliza safari inayoendelea (imeanza) tu.');
    await client.query(`UPDATE naya.rides SET status = 'COMPLETED', completed_at = now(), completed_by = 'ADMIN', updated_at = now() WHERE id = $1`, [rideId]);
    await history(client, rideId, 'IN_PROGRESS', 'COMPLETED', adminId, note || 'Imemalizwa na ofisi');
    await writeAudit(client, { actorId: adminId, action: 'ride.completed_by_admin', targetType: 'ride', targetId: rideId, details: { note } });
    return r;
  });
  await notify({ userId: ride.passenger_id, event: 'ride', rideId, kind: 'ride_complete', title: `Umefika ${ride.dest_name}`, body: 'Safari imekamilishwa na ofisi ya NAYA.' });
  if (ride.driver_id) await notify({ userId: ride.driver_id, event: 'ride', rideId });
  await notifyAdmins(rideId);
  return rideForAdmin(rideId);
}
