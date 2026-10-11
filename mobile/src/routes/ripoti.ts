// Ripoti kamili za ofisi (zimetengana): madereva, wateja, APK/link, maombi ya safari, madereva online sasa.
//   GET /api/admin/ripoti/<aina>        → JSON (ukurasa wa safu 100)
//   GET /api/admin/ripoti/<aina>.csv    → orodha nzima kama CSV (Excel)
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  appReport,
  driversCsv,
  driversReport,
  onlineCsv,
  onlineReport,
  passengersCsv,
  passengersReport,
  requestsCsv,
  requestsReport,
} from '../services/ripoti.js';
import { ok } from '../utils/http.js';

const q = z.string().trim().max(60).optional();
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const client = z.enum(['apk', 'web', 'unknown']).optional();
const driversQuery = z.object({ status: z.enum(['APPROVED', 'PENDING', 'SUSPENDED', 'REJECTED', 'INCOMPLETE', 'ALL']).default('APPROVED'), q, client, page });
const passengersQuery = z.object({ filter: z.enum(['ALL', 'ACTIVE', 'NEVER', 'NEW', 'SUSPENDED']).default('ALL'), q, client, page });
const requestsQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  filter: z.enum(['ALL', 'COMPLETED', 'ACTIVE', 'CANCELLED', 'NO_DRIVER']).default('ALL'),
  q,
  page,
});

const csv = (reply: FastifyReply, name: string, body: string) =>
  reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="naya-${name}-${new Date().toISOString().slice(0, 10)}.csv"`)
    .header('cache-control', 'no-store')
    .send(body);

export async function ripotiRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  app.get('/api/admin/ripoti/madereva', adminOnly, async (request) => ok(await driversReport(driversQuery.parse(request.query))));
  app.get('/api/admin/ripoti/madereva.csv', adminOnly, async (request, reply) =>
    csv(reply, 'madereva', driversCsv(await driversReport({ ...driversQuery.parse(request.query), csv: true }))),
  );

  app.get('/api/admin/ripoti/wateja', adminOnly, async (request) => ok(await passengersReport(passengersQuery.parse(request.query))));
  app.get('/api/admin/ripoti/wateja.csv', adminOnly, async (request, reply) =>
    csv(reply, 'wateja', passengersCsv(await passengersReport({ ...passengersQuery.parse(request.query), csv: true }))),
  );

  app.get('/api/admin/ripoti/app', adminOnly, async () => ok(await appReport()));

  app.get('/api/admin/ripoti/maombi', adminOnly, async (request) => ok(await requestsReport(requestsQuery.parse(request.query))));
  app.get('/api/admin/ripoti/maombi.csv', adminOnly, async (request, reply) => {
    const query = requestsQuery.parse(request.query);
    return csv(reply, `maombi-siku-${query.days}`, requestsCsv(await requestsReport({ ...query, csv: true })));
  });

  app.get('/api/admin/ripoti/online', adminOnly, async () => ok(await onlineReport()));
  app.get('/api/admin/ripoti/online.csv', adminOnly, async (_request, reply) => csv(reply, 'online', onlineCsv(await onlineReport())));
}
