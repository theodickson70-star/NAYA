// Ada ya mwezi ya madereva.
//   Dereva: GET /api/driver/subscription
//   Ofisi:  /api/admin/settings/subscription, /api/admin/subscriptions, /api/admin/drivers/:id/subscription…
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  getSettings,
  listSubscriptions,
  PAYMENT_METHODS,
  recordPayment,
  saveSettings,
  subscriptionForAdmin,
  subscriptionForDriver,
  subscriptionStats,
  voidPayment,
} from '../services/subscriptions.js';
import { ok } from '../utils/http.js';

const driverParam = z.object({ id: z.uuid({ error: 'Dereva hajapatikana' }) });
const paymentParam = z.object({ id: z.uuid({ error: 'Dereva hajapatikana' }), paymentId: z.uuid({ error: 'Malipo hayajapatikana' }) });

const settingsSchema = z.object({
  monthlyFee: z.number({ error: 'Weka ada ya mwezi' }).int('Ada iwe namba kamili').min(0, 'Ada haiwezi kuwa hasi').max(1_000_000, 'Ada ni kubwa mno'),
  trialDays: z.number({ error: 'Weka siku za bure' }).int().min(0, 'Siku haziwezi kuwa hasi').max(90, 'Siku za bure zisizidi 90'),
  graceDays: z.number({ error: 'Weka siku za kuvumiliwa' }).int().min(0, 'Siku haziwezi kuwa hasi').max(14, 'Siku za kuvumiliwa zisizidi 14'),
  paymentInstructions: z
    .string({ error: 'Andika maelekezo ya kulipa' })
    .trim()
    .min(10, 'Andika maelekezo ya kulipa (mf. namba ya M-Pesa ya NAYA)')
    .max(500, 'Maelekezo ni marefu mno'),
});

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : null));

const paymentSchema = z.object({
  months: z.number({ error: 'Chagua idadi ya miezi' }).int().min(1, 'Angalau mwezi 1').max(12, 'Si zaidi ya miezi 12 kwa mara moja'),
  method: z.enum(PAYMENT_METHODS, { error: 'Chagua njia ya malipo' }),
  reference: z
    .string()
    .trim()
    .max(40, 'Namba ya muamala ni ndefu mno')
    .regex(/^[A-Za-z0-9.\-/ ]*$/, 'Namba ya muamala iwe herufi na tarakimu tu')
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  note: optionalText(300, 'Maelezo ni marefu mno'),
});

const voidSchema = z.object({
  reason: z.string({ error: 'Andika sababu' }).trim().min(3, 'Andika sababu fupi (angalau herufi 3)').max(300, 'Sababu ni ndefu mno'),
});

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  app.get('/api/driver/subscription', user, async (request) => ok(await subscriptionForDriver(request.currentUser.id)));

  app.get('/api/admin/settings/subscription', adminOnly, async () => ok(await getSettings()));
  app.put('/api/admin/settings/subscription', adminOnly, async (request) =>
    ok(await saveSettings(request.currentUser.id, settingsSchema.parse(request.body))),
  );

  app.get('/api/admin/subscriptions', adminOnly, async (request) => {
    const { filter } = z.object({ filter: z.enum(['all', 'expired', 'due']).default('all') }).parse(request.query);
    const [drivers, stats] = await Promise.all([listSubscriptions(filter), subscriptionStats()]);
    return ok({ drivers, stats });
  });

  app.get('/api/admin/drivers/:id/subscription', adminOnly, async (request) => {
    const { id } = driverParam.parse(request.params);
    return ok(await subscriptionForAdmin(id));
  });

  app.post('/api/admin/drivers/:id/subscription/payments', adminOnly, async (request, reply) => {
    const { id } = driverParam.parse(request.params);
    const result = await recordPayment(request.currentUser.id, id, paymentSchema.parse(request.body));
    request.log.info({ driverId: id, adminId: request.currentUser.id }, 'ada ya mwezi imerekodiwa');
    return reply.status(201).send(ok(result));
  });

  app.post('/api/admin/drivers/:id/subscription/payments/:paymentId/void', adminOnly, async (request) => {
    const { id, paymentId } = paymentParam.parse(request.params);
    const { reason } = voidSchema.parse(request.body);
    return ok(await voidPayment(request.currentUser.id, id, paymentId, reason));
  });
}
