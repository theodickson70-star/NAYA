// /api/admin/drivers — ofisi inakagua, inathibitisha, inakataa, inasimamisha madereva.
import type { FastifyInstance } from 'fastify';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  approveDriver,
  getDriverForAdmin,
  listDrivers,
  readDocument,
  rejectDriver,
  reinstateDriver,
  suspendDriver,
} from '../services/drivers.js';
import { ok } from '../utils/http.js';
import { documentTypeParam, driverIdParam, driverListQuery, rejectSchema, suspendSchema } from '../validators/drivers.js';

export async function adminDriverRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  app.get('/api/admin/drivers', adminOnly, async (request) => ok(await listDrivers(driverListQuery.parse(request.query))));

  app.get('/api/admin/drivers/:id', adminOnly, async (request) => {
    const { id } = driverIdParam.parse(request.params);
    return ok(await getDriverForAdmin(id));
  });

  app.get('/api/admin/drivers/:id/documents/:type/file', adminOnly, async (request, reply) => {
    const { id } = driverIdParam.parse(request.params);
    const { type } = documentTypeParam.parse(request.params);
    const file = await readDocument(id, type);
    return reply
      .header('content-type', file.mimeType)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .send(file.content);
  });

  app.post('/api/admin/drivers/:id/approve', adminOnly, async (request) => {
    const { id } = driverIdParam.parse(request.params);
    const result = await approveDriver(request.currentUser.id, id);
    request.log.info({ driverId: id, adminId: request.currentUser.id }, 'dereva amethibitishwa');
    return ok(result);
  });

  app.post('/api/admin/drivers/:id/reject', adminOnly, async (request) => {
    const { id } = driverIdParam.parse(request.params);
    const { reason, documents } = rejectSchema.parse(request.body);
    return ok(await rejectDriver(request.currentUser.id, id, reason, documents));
  });

  app.post('/api/admin/drivers/:id/suspend', adminOnly, async (request) => {
    const { id } = driverIdParam.parse(request.params);
    const { reason } = suspendSchema.parse(request.body);
    return ok(await suspendDriver(request.currentUser.id, id, reason));
  });

  app.post('/api/admin/drivers/:id/reinstate', adminOnly, async (request) => {
    const { id } = driverIdParam.parse(request.params);
    return ok(await reinstateDriver(request.currentUser.id, id));
  });
}
