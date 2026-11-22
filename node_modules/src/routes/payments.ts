// Malipo ya simu (0.16.0):
//   App:    GET  /api/payments/config                      → yamewashwa? mitandao
//           POST /api/driver/subscription/pay              → { months, network, phone } — ombi la PIN linaenda kwenye simu
//           GET  /api/payments/:id                         → hali ya muamala wako (app inauliza mpaka ukamilike)
//   Kampuni: POST /api/payments/callback/:provider         → uthibitisho (adapter inakagua saini)
//   Ofisi:  GET  /api/admin/payments/overview | /queue | /api/admin/payments(.csv)
//           PUT  /api/admin/payments/auto-payout            → { enabled, dailyLimit }
//           POST /api/admin/payments/rides/:id/approve | /reject
//   Majaribio tu (PAYMENT_PROVIDER=simulator, si production): POST /api/payments/simulator/:reference { success }
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  approvePayout,
  getAutoPayout,
  handleCallback,
  listPayments,
  myPayment,
  paymentsConfig,
  paymentsCsv,
  paymentsOverview,
  payoutQueue,
  providerCheck,
  saveWalletSettings,
  walletOverview,
  rejectPayout,
  saveAutoPayout,
  startSubscriptionPayment,
  applyResult,
} from '../services/payments/index.js';
import { type CallbackResult, getProvider, MOBILE_NETWORKS } from '../services/payments/provider.js';
import { simulator } from '../services/payments/simulator.js';
import { notFound, ok } from '../utils/http.js';
import { normalizeTzPhone } from '../utils/phone.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const phoneField = z
  .string({ error: 'Weka namba ya simu ya kulipia' })
  .trim()
  .transform((v, ctx) => {
    const p = normalizeTzPhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Namba ya simu si sahihi (mfano: 0754 123 456)' });
      return z.NEVER;
    }
    return p;
  });
const paySchema = z.object({
  months: z.coerce.number({ error: 'Chagua miezi' }).int().min(1, 'Chagua miezi').max(12, 'Miezi isizidi 12'),
  network: z.enum(MOBILE_NETWORKS as [string, ...string[]], { error: 'Chagua mtandao' }),
  phone: phoneField,
});
const listQuery = z.object({
  kind: z.enum(['SUBSCRIPTION', 'PROMO_PAYOUT']).optional(),
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional(),
  q: z.string().trim().max(60).optional(),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  app.get('/api/payments/config', user, async () => ok(paymentsConfig()));
  app.post('/api/driver/subscription/pay', { ...user, config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async (request) => {
    const input = paySchema.parse(request.body);
    return ok(await startSubscriptionPayment(uid(request), { ...input, network: input.network as (typeof MOBILE_NETWORKS)[number] }));
  });
  app.get('/api/payments/:id', user, async (request) => ok(await myPayment(uid(request), idParam.parse(request.params).id)));

  // Kampuni ya malipo → NAYA. Haina token ya mtumiaji; usalama ni saini inayokaguliwa na adapter.
  // Saini ya Abliner inahesabiwa juu ya mwili GHAFI (raw body) — kwa hiyo route hii ina parser yake (ndani ya plugin hii tu).
  await app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (request, body, done) => {
      (request as typeof request & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(Object.assign(new Error('JSON si sahihi'), { statusCode: 400 }), undefined);
      }
    });
    hooks.post('/api/payments/callback/:provider', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request) => {
      const { provider } = z.object({ provider: z.string().min(2).max(30) }).parse(request.params);
      return ok(await handleCallback(provider.toLowerCase(), request));
    });
  });

  // Majaribio: "mteja ameingiza PIN" / "amekataa" — kampuni bandia tu, kamwe production.
  app.post('/api/payments/simulator/:reference', async (request) => {
    if (getProvider() !== simulator) throw notFound('Haipatikani');
    const { reference } = z.object({ reference: z.string().min(6).max(40) }).parse(request.params);
    const { success } = z.object({ success: z.boolean() }).parse(request.body);
    const result = (await simulator.parseCallback({ body: { reference, success } } as never)) as CallbackResult;
    await applyResult(reference, result);
    return ok({ done: true });
  });

  // ---- Ofisi
  app.get('/api/admin/payments/overview', adminOnly, async () => ok(await paymentsOverview()));
  app.get('/api/admin/payments/wallet', adminOnly, async (request) =>
    ok(await walletOverview({ refresh: z.object({ refresh: z.string().optional() }).parse(request.query).refresh === '1' })),
  );
  app.put('/api/admin/payments/wallet-settings', adminOnly, async (request) => {
    const input = z
      .object({ lowBalance: z.coerce.number({ error: 'Weka kiwango' }).int('Weka namba kamili').min(0, 'Kiwango hakiwezi kuwa hasi').max(100_000_000, 'Kiwango ni kikubwa mno') })
      .parse(request.body);
    return ok(await saveWalletSettings(uid(request), input));
  });
  app.get('/api/admin/payments/provider-check', { ...adminOnly, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => ok(await providerCheck()));
  app.get('/api/admin/payments/queue', adminOnly, async () => ok(await payoutQueue()));
  app.get('/api/admin/payments', adminOnly, async (request) => ok(await listPayments(listQuery.parse(request.query))));
  app.get('/api/admin/payments.csv', adminOnly, async (request, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="naya-malipo-ya-simu-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('cache-control', 'no-store')
      .send(paymentsCsv(await listPayments(listQuery.parse(request.query)))),
  );
  app.put('/api/admin/payments/auto-payout', adminOnly, async (request) => {
    const input = z
      .object({
        enabled: z.boolean().optional(),
        dailyLimit: z.coerce.number({ error: 'Weka kikomo' }).int().min(500, 'Kikomo angalau TSh 500').max(10_000_000).optional(),
        minPayout: z.coerce.number({ error: 'Weka kima cha chini' }).int().min(1, 'Kima cha chini angalau TSh 1').max(1_000_000).optional(),
        feeMode: z.enum(['deducted', 'on_top'], { error: 'Chagua jinsi ada inavyotozwa' }).optional(),
      })
      .parse(request.body);
    return ok(await saveAutoPayout(uid(request), input));
  });
  app.get('/api/admin/payments/auto-payout', adminOnly, async () => ok(await getAutoPayout()));
  app.post('/api/admin/payments/rides/:id/approve', adminOnly, async (request) => ok(await approvePayout(uid(request), idParam.parse(request.params).id)));
  app.post('/api/admin/payments/rides/:id/reject', adminOnly, async (request) => {
    const { reason } = z.object({ reason: z.string({ error: 'Andika sababu' }).trim().min(3, 'Andika sababu').max(200) }).parse(request.body);
    return ok(await rejectPayout(uid(request), idParam.parse(request.params).id, reason));
  });
}
