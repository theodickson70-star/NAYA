// Bei maalum kati ya maeneo: ofisi inaandika bei moja kwa moja (mf. Stendi Kuu ↔ Soko Kuu: bodaboda 1,000).
// Bei ni ile ile kwenda na kurudi. Safari isiyo na bei maalum inatumia kanuni ya km (fare-engine).
import { type Db, db, many, transaction } from '../db/pool.js';
import { VEHICLE_TYPES } from '../validators/drivers.js';
import { notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';

export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** Abiria akitumia GPS ndani ya mita hizi kutoka eneo lililosajiliwa, bei maalum ya eneo hilo inatumika. */
export const ROUTE_MATCH_KM = 0.3;

const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);

/** Bei maalum za jozi moja ya maeneo: { BODABODA: 1000, BAJAJI: 2000 } (chombo kisicho na bei hakipo). */
export async function routeFaresBetween(client: Db, fromId: string, toId: string): Promise<Partial<Record<VehicleType, number>>> {
  const [a, b] = pair(fromId, toId);
  const rows = await many<{ vehicle_type: VehicleType; fare: number }>(
    client,
    'SELECT vehicle_type, fare FROM naya.route_fares WHERE location_a = $1 AND location_b = $2',
    [a, b],
  );
  return Object.fromEntries(rows.map((r) => [r.vehicle_type, r.fare]));
}

export interface RouteFareRow {
  locationId: string;
  name: string;
  area: string | null;
  fares: Partial<Record<VehicleType, number>>;
}

/** Ofisi: maeneo yote mengine yanayotumika, na bei maalum (kama ipo) kutoka eneo `fromId`. */
export async function routeFaresFrom(fromId: string): Promise<{ from: { id: string; name: string }; routes: RouteFareRow[] }> {
  const from = await many<{ id: string; name: string }>(db, 'SELECT id, name FROM naya.locations WHERE id = $1', [fromId]);
  if (!from[0]) throw notFound('Eneo halijapatikana');
  const rows = await many<{ id: string; name: string; area: string | null; vehicle_type: VehicleType | null; fare: number | null }>(
    db,
    `SELECT l.id, l.name, l.area, rf.vehicle_type, rf.fare
       FROM naya.locations l
       LEFT JOIN naya.route_fares rf
         ON (rf.location_a = LEAST($1::uuid, l.id) AND rf.location_b = GREATEST($1::uuid, l.id))
      WHERE l.is_active AND l.id <> $1
      ORDER BY l.name`,
    [fromId],
  );
  const byId = new Map<string, RouteFareRow>();
  for (const r of rows) {
    const row = byId.get(r.id) ?? { locationId: r.id, name: r.name, area: r.area, fares: {} };
    if (r.vehicle_type && r.fare !== null) row.fares[r.vehicle_type] = r.fare;
    byId.set(r.id, row);
  }
  return { from: from[0], routes: [...byId.values()] };
}

/** Ofisi: idadi ya njia zenye bei maalum kwa kila eneo (kuonyesha kwenye orodha ya kuchagua). */
export async function routeFareCounts(): Promise<Record<string, number>> {
  const rows = await many<{ id: string; n: number }>(
    db,
    `SELECT id, count(DISTINCT other)::int AS n FROM (
       SELECT location_a AS id, location_b AS other FROM naya.route_fares
       UNION ALL
       SELECT location_b AS id, location_a AS other FROM naya.route_fares
     ) x GROUP BY id`,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

export interface RouteFareInput {
  toId: string;
  fares: Partial<Record<VehicleType, number | null>>;
}

/** Ofisi: hifadhi bei za njia nyingi kutoka eneo moja kwa mara moja. null/0 = ondoa bei maalum (kanuni ya km itatumika). */
export async function saveRouteFares(adminId: string, fromId: string, routes: RouteFareInput[]) {
  await transaction(async (client) => {
    const ids = [fromId, ...routes.map((r) => r.toId)];
    const known = await many<{ id: string }>(client, 'SELECT id FROM naya.locations WHERE id = ANY($1::uuid[])', [ids]);
    if (new Set(known.map((k) => k.id)).size !== new Set(ids).size) throw notFound('Eneo moja halijapatikana. Pakia ukurasa upya.');
    let saved = 0;
    let removed = 0;
    for (const route of routes) {
      if (route.toId === fromId) continue;
      const [a, b] = pair(fromId, route.toId);
      for (const type of VEHICLE_TYPES) {
        if (!(type in route.fares)) continue;
        const fare = route.fares[type];
        if (fare) {
          await client.query(
            `INSERT INTO naya.route_fares (location_a, location_b, vehicle_type, fare, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (location_a, location_b, vehicle_type)
             DO UPDATE SET fare = EXCLUDED.fare, updated_by = EXCLUDED.updated_by, updated_at = now()
             WHERE naya.route_fares.fare <> EXCLUDED.fare`,
            [a, b, type, fare, adminId],
          );
          saved += 1;
        } else {
          const res = await client.query('DELETE FROM naya.route_fares WHERE location_a = $1 AND location_b = $2 AND vehicle_type = $3', [a, b, type]);
          removed += res.rowCount ?? 0;
        }
      }
    }
    await writeAudit(client, {
      actorId: adminId,
      action: 'route_fares.updated',
      targetType: 'location',
      targetId: fromId,
      details: { saved, removed },
    });
  });
  return routeFaresFrom(fromId);
}
