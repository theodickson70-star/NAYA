// /api/admin — admin na super admin tu.
import type { FastifyInstance } from 'fastify';
import { checkDatabase, db } from '../db/pool.js';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { countNewUsersSince, countUsersByRole } from '../services/users.js';
import { ok } from '../utils/http.js';
import { PHASE, VERSION } from '../version.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  /** Muhtasari wa dashboard — namba halisi kutoka database (safari, mapato n.k. zinakuja phases zijazo). */
  app.get('/api/admin/dashboard', adminOnly, async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [byRole, newToday, database] = await Promise.all([
      countUsersByRole(db),
      countNewUsersSince(db, startOfToday),
      checkDatabase(),
    ]);
    const count = (role: string) => byRole.find((r) => r.role === role)?.total ?? 0;
    return ok({
      users: {
        customers: count('CUSTOMER'),
        drivers: count('DRIVER'),
        admins: count('ADMIN') + count('SUPER_ADMIN'),
        newToday: newToday?.total ?? 0,
      },
      system: { database: database === 'ok' ? 'ok' : 'error', version: VERSION, phase: PHASE },
    });
  });
}
