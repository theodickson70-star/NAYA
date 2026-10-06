// Safari.
//   Abiria: /api/rides…        Dereva: /api/driver…        Ofisi: /api/admin/rides…
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  acceptOffer,
  advanceRide,
  cancelByAdmin,
  cancelByDriver,
  cancelByPassenger,
  closeForDriver,
  closeForPassenger,
  currentRideForPassenger,
  declineOffer,
  driverHistory,
  driverPhotoForPassenger,
  driverState,
  listRidesForAdmin,
  passengerHistory,
  ratePassenger,
  rateDriver,
  requestRide,
  rideForAdmin,
  setOnline,
  startRide,
  updateDriverLocation,
} from '../services/rides.js';
import { ok } from '../utils/http.js';
import { VEHICLE_TYPES } from '../validators/drivers.js';
import { estimateSchema } from '../validators/places.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const requestSchema = estimateSchema.extend({ vehicleType: z.enum(VEHICLE_TYPES, { error: 'Chagua bodaboda au bajaji' }) });
const optionalReason = z.object({
  reason: z
    .string()
    .trim()
    .max(300, 'Sababu ni ndefu mno')
    .optional()
    .transform((v) => (v ? v : null)),
});
const requiredReason = z.object({
  reason: z.string({ error: 'Andika sababu' }).trim().min(3, 'Andika sababu fupi (angalau herufi 3)').max(300, 'Sababu ni ndefu mno'),
});
const ratingSchema = z.object({
  rating: z.number({ error: 'Chagua nyota 1 hadi 5' }).int('Chagua nyota 1 hadi 5').min(1, 'Chagua nyota 1 hadi 5').max(5, 'Chagua nyota 1 hadi 5'),
  comment: z
    .string()
    .trim()
    .max(300, 'Maoni ni marefu mno')
    .optional()
    .transform((v) => (v ? v : null)),
});
const lat = z.number().min(-12.5).max(-0.5);
const lng = z.number().min(29).max(41);
const onlineSchema = z.object({
  online: z.boolean({ error: 'online iwe true au false' }),
  lat: lat.optional(),
  lng: lng.optional(),
  locationId: z.uuid().optional(),
});
const pingSchema = z.object({ lat, lng });

export async function rideRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  // ---------------- Abiria ----------------
  app.post('/api/rides', { ...user, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const ride = await requestRide(uid(request), requestSchema.parse(request.body));
    request.log.info({ rideId: ride.id }, 'safari mpya imeagizwa');
    return reply.status(201).send(ok(ride));
  });
  app.get('/api/rides/current', user, async (request) => ok(await currentRideForPassenger(uid(request))));
  app.get('/api/rides/history', user, async (request) => ok(await passengerHistory(uid(request))));
  app.post('/api/rides/:id/cancel', user, async (request) => {
    const { id } = idParam.parse(request.params);
    const { reason } = optionalReason.parse(request.body ?? {});
    return ok(await cancelByPassenger(uid(request), id, reason));
  });
  app.post('/api/rides/:id/rate', user, async (request) => {
    const { id } = idParam.parse(request.params);
    const { rating, comment } = ratingSchema.parse(request.body);
    return ok(await rateDriver(uid(request), id, rating, comment));
  });
  app.post('/api/rides/:id/close', user, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await closeForPassenger(uid(request), id));
  });
  app.get('/api/rides/:id/driver-photo', user, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const file = await driverPhotoForPassenger(uid(request), id);
    return reply.header('content-type', file.mimeType).header('cache-control', 'private, max-age=300').send(file.content);
  });

  // ---------------- Dereva ----------------
  app.get('/api/driver/state', user, async (request) => ok(await driverState(uid(request))));
  app.get('/api/driver/rides', user, async (request) => ok(await driverHistory(uid(request))));
  app.post('/api/driver/online', user, async (request) => ok(await setOnline(uid(request), onlineSchema.parse(request.body))));
  app.post('/api/driver/location', { ...user, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) =>
    ok(await updateDriverLocation(uid(request), pingSchema.parse(request.body))),
  );
  app.post('/api/driver/offers/:id/accept', user, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await acceptOffer(uid(request), id));
  });
  app.post('/api/driver/offers/:id/decline', user, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await declineOffer(uid(request), id));
  });
  app.post('/api/driver/rides/:id/start', { ...user, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { pin } = z.object({ pin: z.string().trim().regex(/^\d{4}$/, 'PIN ni tarakimu 4').optional() }).parse(request.body ?? {});
    return ok(await startRide(uid(request), id, pin));
  });
  for (const step of ['arrive', 'complete'] as const) {
    app.post(`/api/driver/rides/:id/${step}`, user, async (request) => {
      const { id } = idParam.parse(request.params);
      return ok(await advanceRide(uid(request), id, step));
    });
  }
  app.post('/api/driver/rides/:id/cancel', user, async (request) => {
    const { id } = idParam.parse(request.params);
    const { reason } = requiredReason.parse(request.body);
    return ok(await cancelByDriver(uid(request), id, reason));
  });
  app.post('/api/driver/rides/:id/rate', user, async (request) => {
    const { id } = idParam.parse(request.params);
    const { rating } = ratingSchema.parse(request.body);
    return ok(await ratePassenger(uid(request), id, rating));
  });
  app.post('/api/driver/rides/:id/close', user, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await closeForDriver(uid(request), id));
  });

  // ---------------- Ofisi ----------------
  app.get('/api/admin/rides', adminOnly, async (request) => {
    const { scope } = z.object({ scope: z.enum(['active', 'all']).default('active') }).parse(request.query);
    return ok(await listRidesForAdmin(scope));
  });
  app.get('/api/admin/rides/:id', adminOnly, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await rideForAdmin(id));
  });
  app.post('/api/admin/rides/:id/cancel', adminOnly, async (request) => {
    const { id } = idParam.parse(request.params);
    const { reason } = requiredReason.parse(request.body);
    return ok(await cancelByAdmin(request.currentUser.id, id, reason));
  });
}
