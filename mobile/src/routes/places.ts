// Maeneo na nauli.
//   App (mtumiaji):  GET /api/locations, POST /api/fares/estimate
//   Ofisi (admin):   /api/admin/locations..., /api/admin/fares..., /api/admin/route-fares/:eneo (bei maalum kati ya maeneo)
import type { FastifyInstance } from 'fastify';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  createLocation,
  estimateTrip,
  listFareRules,
  listLocations,
  previewFares,
  saveFareRule,
  setLocationActive,
  updateLocation,
} from '../services/places.js';
import { routeFareCounts, routeFaresFrom, saveRouteFares } from '../services/route-fares.js';
import { ok } from '../utils/http.js';
import {
  estimateSchema,
  fareRuleSchema,
  locationIdParam,
  locationQuery,
  locationSchema,
  routeFaresSchema,
  vehicleTypeParam,
} from '../validators/places.js';

export async function placeRoutes(app: FastifyInstance): Promise<void> {
  const userOnly = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  // ---- App ----
  app.get('/api/locations', userOnly, async (request) => {
    const { q } = locationQuery.parse(request.query);
    const locations = await listLocations({ q });
    return ok(locations.map(({ isActive: _active, ...l }) => l));
  });

  app.post('/api/fares/estimate', { ...userOnly, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) =>
    ok(await estimateTrip(estimateSchema.parse(request.body))),
  );

  // ---- Ofisi ----
  app.get('/api/admin/locations', adminOnly, async (request) => {
    const { q } = locationQuery.parse(request.query);
    return ok(await listLocations({ q, includeInactive: true }));
  });

  app.post('/api/admin/locations', adminOnly, async (request, reply) => {
    const location = await createLocation(request.currentUser.id, locationSchema.parse(request.body));
    return reply.status(201).send(ok(location));
  });

  app.put('/api/admin/locations/:id', adminOnly, async (request) => {
    const { id } = locationIdParam.parse(request.params);
    return ok(await updateLocation(request.currentUser.id, id, locationSchema.parse(request.body)));
  });

  app.post('/api/admin/locations/:id/deactivate', adminOnly, async (request) => {
    const { id } = locationIdParam.parse(request.params);
    return ok(await setLocationActive(request.currentUser.id, id, false));
  });

  app.post('/api/admin/locations/:id/activate', adminOnly, async (request) => {
    const { id } = locationIdParam.parse(request.params);
    return ok(await setLocationActive(request.currentUser.id, id, true));
  });

  app.get('/api/admin/fares', adminOnly, async () => ok(await listFareRules()));

  app.put('/api/admin/fares/:vehicleType', adminOnly, async (request) => {
    const { vehicleType } = vehicleTypeParam.parse(request.params);
    return ok(await saveFareRule(request.currentUser.id, vehicleType, fareRuleSchema.parse(request.body)));
  });

  // Bei maalum kati ya maeneo
  app.get('/api/admin/route-fares/counts', adminOnly, async () => ok(await routeFareCounts()));

  app.get('/api/admin/route-fares/:id', adminOnly, async (request) => {
    const { id } = locationIdParam.parse(request.params);
    return ok(await routeFaresFrom(id));
  });

  app.put('/api/admin/route-fares/:id', adminOnly, async (request) => {
    const { id } = locationIdParam.parse(request.params);
    const { routes } = routeFaresSchema.parse(request.body);
    return ok(await saveRouteFares(request.currentUser.id, id, routes));
  });

  app.post('/api/admin/fares/preview', adminOnly, async (request) => ok(previewFares(fareRuleSchema.parse(request.body))));
}
