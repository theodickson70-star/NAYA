// Nauli kwa simu (0.22.0)
//   Abiria: POST /api/rides/:id/pay { phone, network? }      — akifika: ombi la PIN linaenda kwenye simu hiyo
//           GET  /api/passenger/debt                          — deni (safari ambazo hakulipa)
//           POST /api/passenger/debt/pay { phone, network? }
//   Dereva: POST /api/driver/rides/:id/settle { how: CASH | DEBT }
//   Ofisi:  GET  /api/admin/ride-payments/summary · GET /api/admin/ride-debts?open=1
//           POST /api/admin/ride-debts/:id/clear { how: CASH | FORGIVEN, note }
//           GET/PUT /api/admin/settings/ride-payments
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { MOBILE_NETWORKS } from '../services/payments/provider.js';
import { clearDebt, driverSettle, getRidePaySettings, listDebts, myDebt, payDebt, payRideFare, ridePaySummary, saveRidePaySettings } from '../services/ride-payments.js';
import { ok } from '../utils/http.js';
import { normalizeTzPhone } from '../utils/phone.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const payBody = z.object({
  phone: z
    .string({ error: 'Weka namba ya simu ya kulipia' })
    .trim()
    .transform((v, ctx) => {
      const p = normalizeTzPhone(v);
      if (!p) {
        ctx.addIssue({ code: 'custom', message: 'Namba ya simu si sahihi (mfano: 0754 123 456)' });
        return z.NEVER;
      }
      return p;
    }),
  network: z.enum(MOBILE_NETWORKS as [string, ...string[]]).optional().nullable(),
});

export async function ridePaymentRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  app.post('/api/rides/:id/pay', { ...user, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) =>
    ok(await payRideFare(uid(request), idParam.parse(request.params).id, payBody.parse(request.body))),
  );
  app.get('/api/passenger/debt', user, async (request) => ok(await myDebt(uid(request))));
  app.post('/api/passenger/debt/pay', { ...user, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request) =>
    ok(await payDebt(uid(request), payBody.parse(request.body))),
  );
  app.post('/api/driver/rides/:id/settle', { ...user, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request) => {
    const { how } = z.object({ how: z.enum(['CASH', 'DEBT'], { error: 'Chagua: cash au deni' }) }).parse(request.body);
    return ok(await driverSettle(uid(request), idParam.parse(request.params).id, how));
  });

  app.get('/api/admin/ride-payments/summary', adminOnly, async () => ok(await ridePaySummary()));
  app.get('/api/admin/ride-debts', adminOnly, async (request) => {
    const { open } = z.object({ open: z.enum(['0', '1']).default('1') }).parse(request.query);
    return ok(await listDebts(open === '1'));
  });
  app.post('/api/admin/ride-debts/:id/clear', adminOnly, async (request) => {
    const input = z
      .object({ how: z.enum(['CASH', 'FORGIVEN'], { error: 'Chagua: amelipa cash au samehe' }), note: z.string({ error: 'Andika sababu' }).trim().min(3, 'Andika sababu').max(200) })
      .parse(request.body);
    return ok(await clearDebt(uid(request), idParam.parse(request.params).id, input.how, input.note));
  });
  app.get('/api/admin/settings/ride-payments', adminOnly, async () => ok(await getRidePaySettings()));
  app.put('/api/admin/settings/ride-payments', adminOnly, async (request) => {
    const input = z
      .object({
        enabled: z.boolean().optional(),
        feePercent: z.coerce.number().min(0, 'Ada isiwe hasi').max(10, 'Ada isizidi 10%').optional(),
        feeMin: z.coerce.number().int().min(0).max(5000, 'Ada ya chini isizidi TSh 5,000').optional(),
      })
      .parse(request.body);
    return ok(await saveRidePaySettings(uid(request), input));
  });
}
