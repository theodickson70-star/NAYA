// Nauli kwa simu (0.22.0)
//   Abiria: POST /api/rides/:id/pay { phone, network? }      — akifika: ombi la PIN linaenda kwenye simu hiyo
//           GET  /api/passenger/debt                          — deni (safari ambazo hakulipa)
//           POST /api/passenger/debt/pay { phone, network? }
//   Dereva: POST /api/driver/rides/:id/settle { how: CASH | DEBT }
//   Ofisi:  GET  /api/admin/ride-payments/summary · GET /api/admin/ride-debts?open=1
//           POST /api/admin/ride-debts/:id/clear { how: CASH | FORGIVEN, note }
//           GET  /api/admin/ride-refunds?open=1 · POST /api/admin/ride-refunds/:id/done { note }
//           GET/PUT /api/admin/settings/ride-payments
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { MOBILE_NETWORKS } from '../services/payments/provider.js';
import {
  adjustCustomerWallet,
  cancelCashout,
  customerWalletsSummary,
  getCustomerWalletSettings,
  markCashoutDone,
  myCustomerWallet,
  requestCashout,
  saveCustomerWalletSettings,
  topupQuote,
} from '../services/customer-wallet.js';
import { clearDebt, driverSettle, getRidePaySettings, listDebts, listRefunds, markRefunded, myDebt, payDebt, payDebtFromWallet, payRideFare, payRideFromWallet, ridePaySummary, saveRidePaySettings, startCustomerTopup, topupFee } from '../services/ride-payments.js';
import { conflict, ok } from '../utils/http.js';
import { normalizeTzPhone } from '../utils/phone.js';
import { db, one } from '../db/pool.js';

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

  // ---- 0.23.0 Salio la abiria (NAYA Wallet)
  app.get('/api/passenger/wallet', user, async (request) => {
    return ok(await myCustomerWallet(uid(request)));
  });
  app.get('/api/passenger/wallet/quote', { ...user, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (request) => {
    const { amount } = z.object({ amount: z.coerce.number({ error: 'Weka kiasi' }).int('Kiasi kiwe namba kamili').positive('Weka kiasi') }).parse(request.query);
    const s = await getCustomerWalletSettings();
    if (!s.enabled) throw conflict('Wallet ya NAYA haijawashwa kwa sasa.');
    const w = await one<{ balance: number }>(db, 'SELECT balance FROM naya.customer_wallets WHERE user_id = $1', [uid(request)]);
    const fee = await topupFee(amount);
    return ok(topupQuote(s, w?.balance ?? 0, amount, () => fee));
  });
  app.post('/api/passenger/wallet/topup', { ...user, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request) => {
    const input = payBody.extend({ amount: z.coerce.number({ error: 'Weka kiasi' }).int('Kiasi kiwe namba kamili').positive('Weka kiasi') }).parse(request.body);
    return ok(await startCustomerTopup(uid(request), input));
  });
  app.post('/api/passenger/wallet/cashout', { ...user, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => {
    const { phone } = payBody.pick({ phone: true }).parse(request.body);
    return ok(await requestCashout(uid(request), phone));
  });
  app.post('/api/passenger/wallet/cashout/cancel', user, async (request) => ok(await cancelCashout(uid(request))));
  app.post('/api/rides/:id/pay-wallet', { ...user, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) =>
    ok(await payRideFromWallet(uid(request), idParam.parse(request.params).id)),
  );
  app.post('/api/passenger/debt/pay-wallet', { ...user, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request) => ok(await payDebtFromWallet(uid(request))));

  app.get('/api/admin/customer-wallets/summary', adminOnly, async () => ok(await customerWalletsSummary()));
  app.post('/api/admin/customer-wallets/:id/cashout-done', adminOnly, async (request) => {
    const { amount, note } = z
      .object({
        amount: z.coerce.number({ error: 'Weka kiasi ulichotuma' }).int('Kiasi kiwe namba kamili').positive('Weka kiasi ulichotuma'),
        note: z.string({ error: 'Andika kumbukumbu ya kutuma' }).trim().min(3, 'Andika kumbukumbu ya kutuma').max(200),
      })
      .parse(request.body);
    return ok(await markCashoutDone(uid(request), idParam.parse(request.params).id, amount, note));
  });
  app.post('/api/admin/customer-wallets/:id/adjust', adminOnly, async (request) => {
    const input = z
      .object({ amount: z.coerce.number({ error: 'Weka kiasi' }).int('Kiasi kiwe namba kamili'), reason: z.string({ error: 'Andika sababu' }).trim().min(5, 'Andika sababu').max(250) })
      .parse(request.body);
    return ok(await adjustCustomerWallet(uid(request), idParam.parse(request.params).id, input));
  });
  app.get('/api/admin/settings/customer-wallet', adminOnly, async () => ok(await getCustomerWalletSettings()));
  app.put('/api/admin/settings/customer-wallet', adminOnly, async (request) => {
    const input = z
      .object({
        enabled: z.boolean().optional(),
        maxBalance: z.coerce.number().int().min(1000, 'Kikomo kisiwe chini ya TSh 1,000').max(1_000_000).optional(),
        minTopup: z.coerce.number().int().min(100).max(100_000).optional(),
      })
      .parse(request.body);
    return ok(await saveCustomerWalletSettings(uid(request), input));
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
  app.get('/api/admin/ride-refunds', adminOnly, async (request) => {
    const { open } = z.object({ open: z.enum(['0', '1']).default('1') }).parse(request.query);
    return ok(await listRefunds(open === '1'));
  });
  app.post('/api/admin/ride-refunds/:id/done', adminOnly, async (request) => {
    const { note } = z.object({ note: z.string({ error: 'Andika kumbukumbu ya kurudisha' }).trim().min(3, 'Andika kumbukumbu ya kurudisha').max(200) }).parse(request.body);
    return ok(await markRefunded(uid(request), idParam.parse(request.params).id, note));
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
