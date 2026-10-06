// Maeneo ya huduma, kanuni za nauli, na makadirio ya safari.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../utils/http.js';
import type { FareRuleInput, LocationInput } from '../validators/places.js';
import { writeAudit } from './audit.js';
import { fareForDistance, type FareQuote, type FareRule, type Point, quoteFare, straightLineKm } from './fare-engine.js';

/** Mahali pa kuanzia (GPS) lazima pawe ndani ya km hizi kutoka eneo lolote la huduma. */
export const SERVICE_RADIUS_KM = 30;

export interface LocationView {
  id: string;
  name: string;
  area: string | null;
  category: string;
  lat: number;
  lng: number;
  isActive: boolean;
}

const LOCATION_COLUMNS = 'id, name, area, category, lat, lng, is_active AS "isActive"';

// ---------------------------------------------------------------- maeneo

export function listLocations(options: { q?: string; includeInactive?: boolean } = {}) {
  const q = options.q ? `%${options.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  return many<LocationView>(
    db,
    `SELECT ${LOCATION_COLUMNS} FROM naya.locations
      WHERE ($1::boolean OR is_active) AND ($2::text IS NULL OR name ILIKE $2 OR area ILIKE $2)
      ORDER BY is_active DESC, name`,
    [options.includeInactive ?? false, q],
  );
}

const findLocation = (client: Db, id: string) =>
  one<LocationView>(client, `SELECT ${LOCATION_COLUMNS} FROM naya.locations WHERE id = $1`, [id]);

function duplicateName(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict('Kuna eneo jingine lenye jina hili. Tumia jina tofauti.');
  throw error;
}

export async function createLocation(adminId: string, input: LocationInput) {
  try {
    return await transaction(async (client) => {
      const row = await one<LocationView>(
        client,
        `INSERT INTO naya.locations (name, area, category, lat, lng, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${LOCATION_COLUMNS}`,
        [input.name, input.area, input.category, input.lat, input.lng, adminId],
      );
      await writeAudit(client, { actorId: adminId, action: 'location.created', targetType: 'location', targetId: row!.id, details: { name: input.name } });
      return row!;
    });
  } catch (error) {
    duplicateName(error);
  }
}

export async function updateLocation(adminId: string, id: string, input: LocationInput & { isActive?: boolean }) {
  try {
    return await transaction(async (client) => {
      const row = await one<LocationView>(
        client,
        `UPDATE naya.locations
            SET name = $2, area = $3, category = $4, lat = $5, lng = $6,
                is_active = COALESCE($7, is_active), updated_at = now()
          WHERE id = $1 RETURNING ${LOCATION_COLUMNS}`,
        [id, input.name, input.area, input.category, input.lat, input.lng, input.isActive ?? null],
      );
      if (!row) throw notFound('Eneo halijapatikana');
      await writeAudit(client, { actorId: adminId, action: 'location.updated', targetType: 'location', targetId: id, details: { name: input.name } });
      return row;
    });
  } catch (error) {
    duplicateName(error);
  }
}

export async function setLocationActive(adminId: string, id: string, isActive: boolean) {
  try {
    return await transaction(async (client) => {
      const row = await one<LocationView>(
        client,
        `UPDATE naya.locations SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING ${LOCATION_COLUMNS}`,
        [id, isActive],
      );
      if (!row) throw notFound('Eneo halijapatikana');
      await writeAudit(client, {
        actorId: adminId,
        action: isActive ? 'location.activated' : 'location.deactivated',
        targetType: 'location',
        targetId: id,
        details: { name: row.name },
      });
      return row;
    });
  } catch (error) {
    duplicateName(error);
  }
}

// ---------------------------------------------------------------- kanuni za nauli

interface FareRuleRow extends FareRule {
  isActive: boolean;
  updatedAt: Date;
}

export const listFareRules = () =>
  many<FareRuleRow>(
    db,
    `SELECT vehicle_type AS "vehicleType", base_fare AS "baseFare", per_km AS "perKm", minimum_fare AS "minimumFare",
            rounding_step AS "roundingStep", road_factor AS "roadFactor", is_active AS "isActive", updated_at AS "updatedAt"
       FROM naya.fare_rules ORDER BY vehicle_type`,
  );

export async function saveFareRule(adminId: string, vehicleType: FareRule['vehicleType'], input: FareRuleInput) {
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor, is_active, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (vehicle_type) DO UPDATE
         SET base_fare = EXCLUDED.base_fare, per_km = EXCLUDED.per_km, minimum_fare = EXCLUDED.minimum_fare,
             rounding_step = EXCLUDED.rounding_step, road_factor = EXCLUDED.road_factor, is_active = EXCLUDED.is_active,
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [vehicleType, input.baseFare, input.perKm, input.minimumFare, input.roundingStep, input.roadFactor, input.isActive, adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'fare.updated', targetType: 'fare_rule', targetId: null, details: { vehicleType, ...input } });
  });
  return listFareRules();
}

/** Mfano wa nauli kwa umbali wa kawaida — ofisi inaona matokeo kabla ya kuhifadhi. */
export const SAMPLE_DISTANCES_KM = [1, 2, 3, 5, 8, 12];
export function previewFares(input: FareRuleInput) {
  return SAMPLE_DISTANCES_KM.map((km) => ({ distanceKm: km, fare: fareForDistance(input, km) }));
}

// ---------------------------------------------------------------- makadirio ya abiria

type PlaceRef = { locationId: string } | { lat: number; lng: number };

async function resolvePlace(ref: PlaceRef, role: 'pickup' | 'destination') {
  if ('locationId' in ref) {
    const location = await findLocation(db, ref.locationId);
    if (!location || !location.isActive) {
      throw notFound(role === 'pickup' ? 'Eneo la kuanzia halipatikani tena. Chagua jingine.' : 'Eneo unakoenda halipatikani tena. Chagua jingine.');
    }
    return { source: 'location' as const, id: location.id, name: location.name, lat: location.lat, lng: location.lng };
  }
  return { source: 'gps' as const, id: null, name: 'Mahali ulipo', lat: ref.lat, lng: ref.lng };
}

export async function estimateTrip(input: { pickup: PlaceRef; destination: { locationId: string } }) {
  const [pickup, destination] = await Promise.all([resolvePlace(input.pickup, 'pickup'), resolvePlace(input.destination, 'destination')]);

  if (pickup.source === 'gps') {
    const active = await listLocations();
    const nearest = Math.min(...active.map((l) => straightLineKm(pickup, l)));
    if (!Number.isFinite(nearest) || nearest > SERVICE_RADIUS_KM) {
      throw badRequest('Uko nje ya eneo la huduma la NAYA kwa sasa. Chagua unapoanzia kwenye orodha ya maeneo.');
    }
  }
  if (pickup.id === destination.id || straightLineKm(pickup, destination) < 0.05) {
    throw badRequest('Mahali pa kuanzia na unakoenda ni pamoja. Chagua unakoenda kwingine.');
  }

  const rules = (await listFareRules()).filter((r) => r.isActive);
  const options: FareQuote[] = rules.map((rule) => quoteFare(rule, pickup as Point, destination as Point));
  return {
    pickup: { source: pickup.source, id: pickup.id, name: pickup.name },
    destination: { id: destination.id, name: destination.name },
    straightKm: Math.round(straightLineKm(pickup, destination) * 10) / 10,
    options,
  };
}

// ---------------------------------------------------------------- maandalizi (dashboard)

export async function setupStatus() {
  const [locations, fares] = await Promise.all([
    one<{ total: number }>(db, 'SELECT count(*)::int AS total FROM naya.locations WHERE is_active'),
    many<{ vehicleType: string }>(db, 'SELECT vehicle_type AS "vehicleType" FROM naya.fare_rules WHERE is_active'),
  ]);
  return { activeLocations: locations?.total ?? 0, pricedVehicleTypes: fares.map((f) => f.vehicleType) };
}
