// Kumbukumbu ya hatua za ofisi: nani alifanya nini, kwa nani, lini. Haifutwi wala kubadilishwa.
import { type Db, many } from '../db/pool.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details?: Record<string, unknown>;
}

export async function writeAudit(client: Db, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO naya.audit_logs (actor_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [entry.actorId, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.details ?? {})],
  );
}

export interface AuditView {
  action: string;
  details: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
}

export const auditFor = (client: Db, targetType: string, targetId: string, limit = 20) =>
  many<AuditView>(
    client,
    `SELECT a.action, a.details, u.full_name AS "actorName", a.created_at AS "createdAt"
       FROM naya.audit_logs a LEFT JOIN naya.users u ON u.id = a.actor_id
      WHERE a.target_type = $1 AND a.target_id = $2
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $3`,
    [targetType, targetId, limit],
  );
