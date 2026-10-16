// Wallet ya dereva (0.21.0)
//   Dereva: GET  /api/driver/wallet
//           POST /api/driver/wallet/pin { pin, password }       — tengeneza PIN (au PIN mpya baada ya ofisi kuruhusu)
//           POST /api/driver/wallet/pin/change { oldPin, newPin }
//           POST /api/driver/wallet/pin/forgot                  — ombi kwa ofisi
//           GET  /api/driver/wallet/withdraw/preview?amount=    — ada na kiasi atakachopokea
//           POST /api/driver/wallet/withdraw { amount, pin }
//           POST /api/driver/wallet/subscription { months, pin } — ada ya mwezi kwa salio
//   Ofisi:  GET  /api/admin/wallets/summary · GET /api/admin/wallets?q= · GET /api/admin/wallets/:id
//           POST /api/admin/wallets/:id/suspend|activate|unlock-pin|allow-pin-reset|adjust
//           POST /api/admin/wallets/withdrawals/:id/resolve { outcome, note } · /late-reviewed
//           GET/PUT /api/admin/settings/driver-wallet
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { resolveStuckWithdrawal } from '../services/payments/index.js';
import { getDriverWalletSettings } from '../services/wallet-ledger.js';
import {
  adjustWallet,
  allowPinReset,
  changePin,
  driverWallet,
  listWallets,
  markLateReviewed,
  paySubscriptionFromWallet,
  requestPinReset,
  saveDriverWalletSettings,
  setPin,
  setWalletActive,
  unlockPin,
  walletForAdmin,
  walletsSummary,
  withdraw,
  withdrawPreview,
} from '../services/wallet.js';
import { ok } from '../utils/http.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const pin = z.string({ error: 'Weka PIN (tarakimu 4)' }).regex(/^\d{4}$/, 'PIN iwe tarakimu 4');
const amount = z.coerce.number({ error: 'Weka kiasi' }).int('Kiasi kiwe namba kamili').positive('Weka kiasi');

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  // ---- dereva
  app.get('/api/driver/wallet', user, async (request) => ok(await driverWallet(uid(request))));
  app.post('/api/driver/wallet/pin', { ...user, config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request) => {
    const input = z.object({ pin, password: z.string({ error: 'Weka password ya akaunti' }).min(1, 'Weka password ya akaunti').max(128) }).parse(request.body);
    return ok(await setPin(uid(request), input));
  });
  app.post('/api/driver/wallet/pin/change', { ...user, config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request) =>
    ok(await changePin(uid(request), z.object({ oldPin: pin, newPin: pin }).parse(request.body))),
  );
  app.post('/api/driver/wallet/pin/forgot', { ...user, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => ok(await requestPinReset(uid(request))));
  app.get('/api/driver/wallet/withdraw/preview', { ...user, config: { rateLimit: { max: 40, timeWindow: '10 minutes' } } }, async (request) => {
    const q = z.object({ amount }).parse(request.query);
    return ok(await withdrawPreview(uid(request), q.amount));
  });
  app.post('/api/driver/wallet/withdraw', { ...user, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) =>
    ok(await withdraw(uid(request), z.object({ amount, pin: z.string({ error: 'Weka PIN' }) }).parse(request.body))),
  );
  app.post('/api/driver/wallet/subscription', { ...user, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request) => {
    const input = z.object({ months: z.coerce.number().int().min(1, 'Chagua miezi').max(12, 'Miezi isizidi 12'), pin: z.string({ error: 'Weka PIN' }) }).parse(request.body);
    return ok(await paySubscriptionFromWallet(uid(request), input));
  });

  // ---- ofisi
  app.get('/api/admin/wallets/summary', adminOnly, async () => ok(await walletsSummary()));
  app.get('/api/admin/wallets', adminOnly, async (request) => {
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(request.query);
    return ok(await listWallets(q || null));
  });
  app.get('/api/admin/wallets/:id', adminOnly, async (request) => ok(await walletForAdmin(idParam.parse(request.params).id)));
  app.post('/api/admin/wallets/:id/suspend', adminOnly, async (request) => {
    const { reason } = z.object({ reason: z.string({ error: 'Andika sababu' }).trim().min(3, 'Andika sababu').max(200) }).parse(request.body);
    return ok(await setWalletActive(uid(request), idParam.parse(request.params).id, false, reason));
  });
  app.post('/api/admin/wallets/:id/activate', adminOnly, async (request) => ok(await setWalletActive(uid(request), idParam.parse(request.params).id, true, null)));
  app.post('/api/admin/wallets/:id/unlock-pin', adminOnly, async (request) => ok(await unlockPin(uid(request), idParam.parse(request.params).id)));
  app.post('/api/admin/wallets/:id/allow-pin-reset', adminOnly, async (request) => ok(await allowPinReset(uid(request), idParam.parse(request.params).id)));
  app.post('/api/admin/wallets/:id/adjust', adminOnly, async (request) => {
    const input = z
      .object({ amount: z.coerce.number({ error: 'Weka kiasi' }).int('Kiasi kiwe namba kamili'), reason: z.string({ error: 'Andika sababu' }).trim().min(5, 'Andika sababu ya marekebisho').max(250) })
      .parse(request.body);
    return ok(await adjustWallet(uid(request), idParam.parse(request.params).id, input));
  });
  app.post('/api/admin/wallets/withdrawals/:id/resolve', adminOnly, async (request) => {
    const input = z
      .object({ outcome: z.enum(['SUCCESS', 'FAILED'], { error: 'Chagua matokeo' }), note: z.string({ error: 'Andika ulichokiona' }).trim().min(5, 'Andika ulichokiona kwenye Abliner').max(200) })
      .parse(request.body);
    const driverId = await resolveStuckWithdrawal(uid(request), idParam.parse(request.params).id, input.outcome, input.note);
    return ok(await walletForAdmin(driverId));
  });
  app.post('/api/admin/wallets/withdrawals/:id/late-reviewed', adminOnly, async (request) => ok(await markLateReviewed(uid(request), idParam.parse(request.params).id)));
  app.get('/api/admin/settings/driver-wallet', adminOnly, async () => ok(await getDriverWalletSettings()));
  app.put('/api/admin/settings/driver-wallet', adminOnly, async (request) => {
    const input = z
      .object({
        promoToWallet: z.boolean().optional(),
        minWithdraw: z.coerce.number().int().min(500).max(100000).optional(),
        dailyWithdrawLimit: z.coerce.number().int().min(1000).max(3000000).optional(),
      })
      .parse(request.body);
    return ok(await saveDriverWalletSettings(uid(request), input));
  });
}
