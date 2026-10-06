// /api/admin — admin na super admin tu.
import type { FastifyInstance } from 'fastify';
import { checkDatabase, db } from '../db/pool.js';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { countDriversByStatus } from '../services/drivers.js';
import { setupStatus } from '../services/places.js';
import { rideStats } from '../services/rides.js';
import { openSosCount } from '../services/safety.js';
import { smsEnabled, smsOverview } from '../services/sms.js';
import { subscriptionStats } from '../services/subscriptions.js';
import { countNewUsersSince, countUsersByRole } from '../services/users.js';
import { ok } from '../utils/http.js';
import { PHASE, VERSION } from '../version.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  /** Muhtasari wa dashboard — namba halisi kutoka database (safari, mapato n.k. zinakuja phases zijazo). */
  app.get('/api/admin/dashboard', adminOnly, async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [byRole, newToday, drivers, setup, rides, subscriptions, sosOpen, database] = await Promise.all([
      countUsersByRole(db),
      countNewUsersSince(db, startOfToday),
      countDriversByStatus(db),
      setupStatus(),
      rideStats(),
      subscriptionStats(),
      openSosCount(),
      checkDatabase(),
    ]);
    const count = (role: string) => byRole.find((r) => r.role === role)?.total ?? 0;
    return ok({
      users: {
        members: count('USER'),
        admins: count('ADMIN') + count('SUPER_ADMIN'),
        newToday: newToday?.total ?? 0,
      },
      drivers,
      setup,
      rides,
      subscriptions,
      sosOpen,
      sms: { enabled: smsEnabled() },
      system: { database: database === 'ok' ? 'ok' : 'error', version: VERSION, phase: PHASE },
    });
  });

  /** SMS (Beem): imewashwa?, salio, na SMS za karibuni (aina na matokeo tu — si maandishi). */
  app.get('/api/admin/sms', adminOnly, async () => ok(await smsOverview()));
}
