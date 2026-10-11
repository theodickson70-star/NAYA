// Ofa za wateja na malipo ya NAYA kwa madereva.
//   Abiria:  GET  /api/offers                                → ofa anazoweza kutumia sasa (bango)
//   Dereva:  GET  /api/driver/promo-wallet                   → NAYA inamdai kiasi gani, namba zake, safari za ofa, malipo
//            POST /api/driver/payout-accounts                → weka / badilisha namba ya kupokea malipo
//            POST /api/driver/payout-accounts/:id/delete
//   Ofisi:   GET/POST /api/admin/promotions, GET/PUT /api/admin/promotions/:id, POST /api/admin/promotions/:id/status
//            GET  /api/admin/promo-payouts(.csv), GET/POST /api/admin/promo-payouts/:driverId, POST /api/admin/promo-payouts/void/:id
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  createPromotion,
  deletePayoutAccount,
  driverPayoutDetail,
  driverPayoutsReport,
  driverPromoWallet,
  listPromotions,
  NETWORKS,
  offersForPassenger,
  payoutsCsv,
  promotionDetail,
  recordPayout,
  savePayoutAccount,
  setPromotionStatus,
  updatePromotion,
  voidPayout,
} from '../services/promotions.js';
import { ok } from '../utils/http.js';
import { normalizeTzPhone } from '../utils/phone.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const driverParam = z.object({ driverId: z.uuid({ error: 'Haikupatikana' }) });
const money = (label: string) => z.coerce.number({ error: `${label}: weka namba` }).int(`${label}: namba kamili`).min(1, `${label}: angalau 1`).max(10_000_000);
const optMoney = (label: string) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), money(label).nullable());
const optCount = (label: string) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1, `${label}: angalau 1`).max(1000).nullable());
const optDate = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.date({ error: 'Tarehe si sahihi' }).nullable());

const promoSchema = z.object({
  name: z.string({ error: 'Weka jina la ofa' }).trim().min(3, 'Jina la ofa liwe na angalau herufi 3').max(80),
  title: z.string({ error: 'Weka kichwa anachoona mteja' }).trim().min(3, 'Kichwa kiwe na angalau herufi 3').max(80),
  description: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(300).nullable().default(null)),
  audience: z.enum(['ALL', 'NEW_CUSTOMERS'], { error: 'Chagua wateja wa ofa' }),
  discountPercent: z.coerce.number({ error: 'Weka asilimia ya punguzo' }).int().min(1, 'Punguzo angalau 1%').max(100, 'Punguzo lisizidi 100%'),
  maxDiscount: optMoney('Punguzo la juu'),
  minFare: optMoney('Nauli ya chini'),
  maxFare: optMoney('Nauli ya juu'),
  vehicleTypes: z.array(z.enum(['BODABODA', 'BAJAJI'])).nullable().default(null),
  perCustomerLimit: optCount('Safari kwa mteja'),
  perDriverLimit: optCount('Safari kwa dereva'),
  perDriverPeriod: z.enum(['DAY', 'WEEK', 'TOTAL']).default('WEEK'),
  budget: optMoney('Bajeti'),
  priority: z.coerce.number().int().min(-100).max(100).default(0),
  startsAt: optDate,
  endsAt: optDate,
});

const accountSchema = z
  .object({
    id: z.uuid().optional(),
    network: z.enum(NETWORKS, { error: 'Chagua mtandao' }),
    phone: z.string({ error: 'Weka namba' }).trim().min(4, 'Weka namba').max(30),
    accountName: z.string({ error: 'Weka jina la mwenye namba' }).trim().min(3, 'Weka jina la mwenye namba (kama lilivyosajiliwa)').max(80),
    primary: z.boolean().optional(),
  })
  .transform((v, ctx) => {
    if (v.network === 'BANK') {
      if (!/^[0-9A-Za-z -]{6,30}$/.test(v.phone)) ctx.addIssue({ code: 'custom', message: 'Namba ya akaunti ya benki si sahihi' });
      return v;
    }
    const phone = normalizeTzPhone(v.phone);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Namba ya simu si sahihi (mfano: 0712 345 678)' });
      return z.NEVER;
    }
    return { ...v, phone };
  });

const payoutSchema = z.object({
  amount: money('Kiasi'),
  accountId: z.uuid({ error: 'Chagua namba ya kutuma pesa' }),
  reference: z.string({ error: 'Weka namba ya muamala' }).trim().min(4, 'Weka namba ya muamala (mf. ya M-Pesa)').max(60),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(300).nullable().default(null)),
});

export async function ofaRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  // ---- Abiria
  app.get('/api/offers', user, async (request) => ok(await offersForPassenger(uid(request))));

  // ---- Dereva
  app.get('/api/driver/promo-wallet', user, async (request) => ok(await driverPromoWallet(uid(request))));
  app.post('/api/driver/payout-accounts', { ...user, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) =>
    ok(await savePayoutAccount(uid(request), accountSchema.parse(request.body))),
  );
  app.post('/api/driver/payout-accounts/:id/delete', user, async (request) => ok(await deletePayoutAccount(uid(request), idParam.parse(request.params).id)));

  // ---- Ofisi: ofa
  app.get('/api/admin/promotions', adminOnly, async () => ok(await listPromotions()));
  app.post('/api/admin/promotions', adminOnly, async (request, reply) =>
    reply.status(201).send(ok(await createPromotion(uid(request), promoSchema.parse(request.body)))),
  );
  app.get('/api/admin/promotions/:id', adminOnly, async (request) => ok(await promotionDetail(idParam.parse(request.params).id)));
  app.put('/api/admin/promotions/:id', adminOnly, async (request) =>
    ok(await updatePromotion(uid(request), idParam.parse(request.params).id, promoSchema.parse(request.body))),
  );
  app.post('/api/admin/promotions/:id/status', adminOnly, async (request) => {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']) }).parse(request.body);
    return ok(await setPromotionStatus(uid(request), idParam.parse(request.params).id, status));
  });

  // ---- Ofisi: malipo ya ofa kwa madereva
  const payoutsQuery = z.object({ q: z.string().trim().max(60).optional(), owed: z.enum(['1', '0']).optional() });
  app.get('/api/admin/promo-payouts', adminOnly, async (request) => {
    const { q, owed } = payoutsQuery.parse(request.query);
    return ok(await driverPayoutsReport({ q, onlyOwed: owed === '1' }));
  });
  app.get('/api/admin/promo-payouts.csv', adminOnly, async (request, reply) => {
    const { q, owed } = payoutsQuery.parse(request.query);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="naya-malipo-ya-ofa-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('cache-control', 'no-store')
      .send(payoutsCsv(await driverPayoutsReport({ q, onlyOwed: owed === '1' })));
  });
  app.get('/api/admin/promo-payouts/:driverId', adminOnly, async (request) => ok(await driverPayoutDetail(driverParam.parse(request.params).driverId)));
  app.post('/api/admin/promo-payouts/:driverId', adminOnly, async (request) =>
    ok(await recordPayout(uid(request), driverParam.parse(request.params).driverId, payoutSchema.parse(request.body))),
  );
  app.post('/api/admin/promo-payouts/void/:id', adminOnly, async (request) => {
    const { reason } = z.object({ reason: z.string({ error: 'Andika sababu' }).trim().min(3, 'Andika sababu').max(300) }).parse(request.body);
    return ok(await voidPayout(uid(request), idParam.parse(request.params).id, reason));
  });
}
