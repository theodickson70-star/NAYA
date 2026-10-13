// NAYA Staff (0.19.0)
//   Staff (app):  GET  /api/staff/home
//                 GET  /api/staff/drivers · POST /api/staff/drivers · GET /api/staff/drivers/:id
//                 PUT  /api/staff/drivers/:id/vehicle · PUT /api/staff/drivers/:id/documents/:type (picha/PDF)
//                 GET  /api/staff/drivers/:id/documents/:type/file · POST /api/staff/drivers/:id/submit
//                 GET  /api/staff/locations · POST /api/staff/locations
//   Ofisi:        GET/POST /api/admin/staff · POST /api/admin/staff/:id/suspend|activate|reset-password
//                 GET /api/admin/locations/pending · POST /api/admin/locations/:id/review
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { readDocument, saveDocument, updateVehicle } from '../services/drivers.js';
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES } from '../services/files.js';
import {
  assertMyDriver,
  assertPasswordChanged,
  createStaff,
  listStaff,
  myDriver,
  myDrivers,
  myLocations,
  pendingLocations,
  proposeLocation,
  registerDriver,
  resetStaffPassword,
  reviewLocation,
  setStaffActive,
  staffHome,
  submitDriver,
} from '../services/staff.js';
import { badRequest, ok } from '../utils/http.js';
import { phoneSchema } from '../validators/auth.js';
import { documentTypeParam, vehicleSchema } from '../validators/drivers.js';
import { locationSchema } from '../validators/places.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const fullName = z.string({ error: 'Weka jina kamili' }).trim().min(3, 'Jina liwe na angalau herufi 3').max(120, 'Jina ni refu mno');

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  // Picha za nyaraka zinatumwa kama bytes tupu (kama dereva mwenyewe) — parser hii ipo ndani ya plugin hii tu.
  app.addContentTypeParser([...ALLOWED_MIME_TYPES], { parseAs: 'buffer', bodyLimit: MAX_DOCUMENT_BYTES }, (_req, body, done) => done(null, body));

  const staffOnly = {
    preHandler: [
      requireRole('STAFF'),
      async (request: FastifyRequest) => assertPasswordChanged(request.currentUser as { must_change_password?: boolean }),
    ],
  };
  const sid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  app.get('/api/staff/home', staffOnly, async (request) => ok(await staffHome(sid(request))));

  // ---- bodaboda
  app.get('/api/staff/drivers', staffOnly, async (request) => ok(await myDrivers(sid(request))));
  app.post('/api/staff/drivers', { ...staffOnly, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const body = z.object({ fullName, phone: phoneSchema }).parse(request.body);
    const vehicle = vehicleSchema.parse(request.body);
    return reply.status(201).send(ok(await registerDriver(sid(request), { ...body, vehicle })));
  });
  app.get('/api/staff/drivers/:id', staffOnly, async (request) => ok(await myDriver(sid(request), idParam.parse(request.params).id)));
  app.put('/api/staff/drivers/:id/vehicle', staffOnly, async (request) => {
    const { id } = idParam.parse(request.params);
    await assertMyDriver(sid(request), id);
    await updateVehicle(id, vehicleSchema.parse(request.body));
    return ok(await myDriver(sid(request), id));
  });
  app.put(
    '/api/staff/drivers/:id/documents/:type',
    { ...staffOnly, bodyLimit: MAX_DOCUMENT_BYTES, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const { type } = documentTypeParam.parse(request.params);
      if (!Buffer.isBuffer(request.body)) throw badRequest('Tuma picha (JPG, PNG, WEBP) au PDF.');
      await assertMyDriver(sid(request), id);
      await saveDocument(id, type, request.body, request.headers['content-type']);
      return ok(await myDriver(sid(request), id));
    },
  );
  app.get('/api/staff/drivers/:id/documents/:type/file', staffOnly, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { type } = documentTypeParam.parse(request.params);
    await assertMyDriver(sid(request), id);
    const file = await readDocument(id, type);
    return reply.header('content-type', file.mimeType).header('cache-control', 'private, no-store').send(file.content);
  });
  app.post('/api/staff/drivers/:id/submit', staffOnly, async (request) => ok(await submitDriver(sid(request), idParam.parse(request.params).id)));

  // ---- maeneo
  app.get('/api/staff/locations', staffOnly, async (request) => ok(await myLocations(sid(request))));
  app.post('/api/staff/locations', { ...staffOnly, config: { rateLimit: { max: 40, timeWindow: '10 minutes' } } }, async (request, reply) =>
    reply.status(201).send(ok(await proposeLocation(sid(request), locationSchema.parse(request.body)))),
  );

  // ---- ofisi
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const aid = sid;
  app.get('/api/admin/staff', adminOnly, async () => ok(await listStaff()));
  app.post('/api/admin/staff', adminOnly, async (request, reply) => {
    const input = z.object({ fullName, phone: phoneSchema }).parse(request.body);
    return reply.status(201).send(ok(await createStaff(aid(request), input)));
  });
  app.post('/api/admin/staff/:id/suspend', adminOnly, async (request) => ok(await setStaffActive(aid(request), idParam.parse(request.params).id, false)));
  app.post('/api/admin/staff/:id/activate', adminOnly, async (request) => ok(await setStaffActive(aid(request), idParam.parse(request.params).id, true)));
  app.post('/api/admin/staff/:id/reset-password', adminOnly, async (request) => ok(await resetStaffPassword(aid(request), idParam.parse(request.params).id)));
  app.get('/api/admin/locations/pending', adminOnly, async () => ok(await pendingLocations()));
  app.post('/api/admin/locations/:id/review', adminOnly, async (request) => {
    const { approve, note } = z
      .object({ approve: z.boolean({ error: 'Chagua kuidhinisha au kukataa' }), note: z.string().trim().max(200).optional().transform((v) => v || null) })
      .parse(request.body);
    return ok(await reviewLocation(aid(request), idParam.parse(request.params).id, approve, note));
  });
}
