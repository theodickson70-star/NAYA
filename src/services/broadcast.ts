// Matangazo ya ofisi: ujumbe mmoja kwa kundi (madereva wote, wateja wote, wote, au madereva walio online).
// Kila mpokeaji anapata arifa ndani ya app + simu (Web Push / app ya Android). SMS ni hiari na zinalipiwa.
import { db, many, one } from '../db/pool.js';
import { badRequest } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify } from './notify.js';
import { sendSms, smsEnabled } from './sms.js';

export const AUDIENCES = ['ALL', 'PASSENGERS', 'DRIVERS', 'ONLINE_DRIVERS'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** SMS kwa tangazo moja zisizidi hizi (gharama). */
export const MAX_BROADCAST_SMS = 500;

const AUDIENCE_SQL: Record<Audience, string> = {
  ALL: `SELECT u.id, u.phone FROM naya.users u WHERE u.role = 'USER' AND u.status = 'ACTIVE'`,
  PASSENGERS: `SELECT u.id, u.phone FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
                WHERE u.role = 'USER' AND u.status = 'ACTIVE' AND (d.user_id IS NULL OR d.status <> 'APPROVED')`,
  DRIVERS: `SELECT u.id, u.phone FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id
             WHERE u.role = 'USER' AND u.status = 'ACTIVE' AND d.status = 'APPROVED'`,
  ONLINE_DRIVERS: `SELECT u.id, u.phone FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id
                    WHERE u.role = 'USER' AND u.status = 'ACTIVE' AND d.status = 'APPROVED' AND d.is_online`,
};

export async function audienceSizes() {
  const sizes: Record<string, number> = {};
  for (const a of AUDIENCES) {
    const row = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM (${AUDIENCE_SQL[a]}) x`);
    sizes[a] = row?.n ?? 0;
  }
  return { sizes, smsEnabled: smsEnabled(), maxSms: MAX_BROADCAST_SMS };
}

export async function sendBroadcast(adminId: string, input: { audience: Audience; title: string; body: string; sms: boolean }) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 2 || body.length < 2) throw badRequest('Andika kichwa na ujumbe');
  const recipients = await many<{ id: string; phone: string }>(db, AUDIENCE_SQL[input.audience]);
  const withSms = input.sms && smsEnabled();
  if (withSms && recipients.length > MAX_BROADCAST_SMS) {
    throw badRequest(`SMS zinaruhusiwa kwa watu ${MAX_BROADCAST_SMS} tu kwa tangazo moja (kundi hili lina ${recipients.length}). Tuma bila SMS.`);
  }
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO naya.broadcasts (audience, title, body, with_sms, recipients, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.audience, title.slice(0, 80), body.slice(0, 300), withSms, recipients.length, adminId],
  );
  await writeAudit(db, {
    actorId: adminId,
    action: 'broadcast.sent',
    targetType: 'broadcast',
    targetId: row!.id,
    details: { audience: input.audience, recipients: recipients.length, sms: withSms },
  });
  // Kutuma kunaendelea nyuma ya pazia (watu wengi huchukua muda); ofisi inapata jibu papo hapo.
  void (async () => {
    let smsSent = 0;
    for (const r of recipients) {
      await notify({ userId: r.id, event: 'support', kind: 'broadcast', title: title.slice(0, 80), body: body.slice(0, 300) });
      if (withSms && (await sendSms(r.phone, `NAYA: ${title}. ${body}`.slice(0, 320), 'broadcast'))) smsSent += 1;
    }
    if (withSms) await db.query('UPDATE naya.broadcasts SET sms_sent = $2 WHERE id = $1', [row!.id, smsSent]).catch(() => {});
  })().catch((error) => console.error(`[broadcast] ${(error as Error).message}`));
  return { id: row!.id, recipients: recipients.length, sms: withSms };
}

export function listBroadcasts() {
  return many(
    db,
    `SELECT b.id, b.audience, b.title, b.body, b.with_sms AS "withSms", b.recipients, b.sms_sent AS "smsSent",
            b.created_at AS "createdAt", u.full_name AS "createdBy"
       FROM naya.broadcasts b LEFT JOIN naya.users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 30`,
  );
}
