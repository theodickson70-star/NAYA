// 0.29.0: SMS za moja kwa moja — mfumo unatuma wenyewe kwa kanuni ambazo ofisi inawasha:
//   WELCOME            karibu mteja mpya (saa 1 baada ya kujisajili; waliojisajili ndani ya siku 3 tu — wa zamani hawatumiwi)
//   INACTIVE_CUSTOMER  mteja hajasafiri siku N (chaguo-msingi 30) — mara moja kila siku N
//   IDLE_DRIVER        dereva hajaenda online siku N (chaguo-msingi 7) — mara moja kila siku N
// (Ukumbusho wa ada ya dereva upo tayari — Ada ya mwezi — haurudiwi hapa.)
//
// Kinga: saa za kazi tu (08:00–19:59 saa za Tanzania), kikomo cha SMS kwa siku kwa kila kanuni, waliojiondoa
// hawatumiwi, mtu hapati SMS ileile kabla ya muda wake, na kumbukumbu ya kila SMS (sms_auto_log).
// Server mbili haziwezi kutuma kwa mtu yule yule: advisory lock + kumbukumbu inaandikwa KABLA ya kutuma.
import { db, many, one, transaction } from '../db/pool.js';
import { badRequest } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { render, smsParts, PLACEHOLDERS, MAX_PARTS } from './sms-center.js';
import { sendSms, smsEnabled } from './sms.js';

export const AUTO_RULES = ['WELCOME', 'INACTIVE_CUSTOMER', 'IDLE_DRIVER'] as const;
export type AutoRule = (typeof AUTO_RULES)[number];

export interface RuleSettings {
  enabled: boolean;
  message: string;
  /** Siku (INACTIVE_CUSTOMER, IDLE_DRIVER) — mtu anahesabiwa "hajatumia" baada ya siku hizi, na anapata SMS tena baada ya siku hizi. */
  days: number;
  /** SMS zisizidi hizi kwa siku kwa kanuni hii (gharama). */
  dailyCap: number;
}

export const AUTO_DEFAULTS: Record<AutoRule, RuleSettings> = {
  WELCOME: { enabled: false, days: 1, dailyCap: 100, message: 'Habari {jina}, karibu NAYA! Agiza bodaboda au bajaji Urambo: {link} TWENDE PAMOJA.' },
  INACTIVE_CUSTOMER: { enabled: false, days: 30, dailyCap: 100, message: 'Habari {jina}, tumekukumbuka! Madereva wa NAYA wako tayari. Agiza sasa: {link}' },
  IDLE_DRIVER: { enabled: false, days: 7, dailyCap: 50, message: 'Habari {jina}, wateja wanakusubiri NAYA. Fungua app uende online upate safari. TWENDE PAMOJA.' },
};

export const RULE_LABEL: Record<AutoRule, string> = {
  WELCOME: 'Karibu mteja mpya',
  INACTIVE_CUSTOMER: 'Mteja hajasafiri muda mrefu',
  IDLE_DRIVER: 'Dereva hajaenda online muda mrefu',
};

const START_HOUR = 8;
const END_HOUR = 20; // hadi 19:59

export async function getAutoSettings(): Promise<Record<AutoRule, RuleSettings>> {
  const row = await one<{ value: Partial<Record<AutoRule, Partial<RuleSettings>>> }>(db, `SELECT value FROM naya.settings WHERE key = 'sms_auto'`);
  const out = {} as Record<AutoRule, RuleSettings>;
  for (const r of AUTO_RULES) out[r] = { ...AUTO_DEFAULTS[r], ...(row?.value?.[r] ?? {}) };
  return out;
}

export async function saveAutoRule(adminId: string, rule: AutoRule, input: RuleSettings) {
  const message = input.message.replace(/\r\n/g, '\n').trim();
  if (message.length < 5) throw badRequest('Andika ujumbe (angalau herufi 5).');
  if (message.length > 480) throw badRequest('Ujumbe ni mrefu mno.');
  const unknown = [...message.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
  if (unknown.length) throw badRequest(`Neno {${unknown[0]}} halijulikani. Tumia: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`);
  if (/\[[^\]]*\]/.test(message)) throw badRequest('Badilisha maneno yaliyo ndani ya [ ] kwanza.');
  if (smsParts(render(message, { full_name: 'Mwanaidi Abdallah Mwakyusa', plate_number: 'MC 123 ABC', paid_until: new Date() })) > MAX_PARTS) {
    throw badRequest(`Ujumbe ni mrefu mno — usizidi SMS ${MAX_PARTS}.`);
  }
  const days = Math.round(input.days);
  const dailyCap = Math.round(input.dailyCap);
  if (rule !== 'WELCOME' && (days < 3 || days > 365)) throw badRequest('Siku ziwe kati ya 3 na 365.');
  if (dailyCap < 1 || dailyCap > 1000) throw badRequest('Kikomo cha SMS kwa siku kiwe kati ya 1 na 1,000.');
  const all = await getAutoSettings();
  all[rule] = { enabled: !!input.enabled, message, days: rule === 'WELCOME' ? 1 : days, dailyCap };
  await db.query(
    `INSERT INTO naya.settings (key, value, updated_by) VALUES ('sms_auto', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(all), adminId],
  );
  await writeAudit(db, { actorId: adminId, action: 'sms.auto_rule', targetType: 'settings', targetId: null, details: { rule, enabled: !!input.enabled, days, dailyCap } });
  return autoOverview();
}

interface Candidate {
  id: string;
  phone: string;
  full_name: string;
  plate_number: string | null;
  paid_until: Date | null;
}

/** Wanaostahili SMS ya kanuni hii sasa (bila waliojiondoa, bila waliopata SMS hii ndani ya siku zake). */
function candidatesSql(rule: AutoRule): string {
  const notSent = (days: string) =>
    `NOT EXISTS (SELECT 1 FROM naya.sms_auto_log l WHERE l.rule = '${rule}' AND l.user_id = u.id AND l.sent_at > now() - make_interval(days => ${days}))`;
  const base = `u.role = 'USER' AND u.status = 'ACTIVE' AND u.sms_opt_out_at IS NULL`;
  const cols = `u.id, u.phone, u.full_name, d.plate_number, d.paid_until`;
  if (rule === 'WELCOME') {
    return `SELECT ${cols} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
             WHERE ${base} AND (d.user_id IS NULL OR d.status <> 'APPROVED')
               AND u.created_at <= now() - interval '1 hour' AND u.created_at > now() - interval '3 days'
               AND NOT EXISTS (SELECT 1 FROM naya.sms_auto_log l WHERE l.rule = 'WELCOME' AND l.user_id = u.id)
             ORDER BY u.created_at LIMIT $1`;
  }
  if (rule === 'INACTIVE_CUSTOMER') {
    return `SELECT ${cols} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
             WHERE ${base} AND (d.user_id IS NULL OR d.status <> 'APPROVED')
               AND u.created_at < now() - make_interval(days => $2)
               AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.passenger_id = u.id AND r.requested_at > now() - make_interval(days => $2))
               AND ${notSent('$2')}
             ORDER BY u.created_at LIMIT $1`;
  }
  return `SELECT ${cols} FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id
           WHERE ${base} AND d.status = 'APPROVED' AND NOT d.is_online
             AND coalesce(d.last_seen_at, d.reviewed_at, d.created_at) < now() - make_interval(days => $2)
             AND ${notSent('$2')}
           ORDER BY coalesce(d.last_seen_at, d.reviewed_at, d.created_at) LIMIT $1`;
}

const eatHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Dar_es_Salaam', hour: '2-digit', hour12: false }).format(d)) % 24;

/**
 * Inaitwa na server kila dakika 10. Inarudisha idadi ya SMS zilizotumwa.
 * `force` (tests tu) inapuuza saa za kazi.
 */
export async function runAutoSms(opts: { force?: boolean } = {}): Promise<number> {
  if (!smsEnabled()) return 0;
  if (!opts.force) {
    const h = eatHour();
    if (h < START_HOUR || h >= END_HOUR) return 0;
  }
  const settings = await getAutoSettings();
  let total = 0;
  for (const rule of AUTO_RULES) {
    const s = settings[rule];
    if (!s.enabled) continue;
    // Chagua na "dai" wapokeaji ndani ya transaction moja yenye lock (server mbili hazigongani)
    const picked = await transaction(async (client) => {
      const got = await one<{ ok: boolean }>(client, `SELECT pg_try_advisory_xact_lock(hashtext('naya.sms_auto.' || $1)) AS ok`, [rule]);
      if (!got?.ok) return [] as Candidate[];
      const today = await one<{ n: number }>(
        client,
        `SELECT count(*)::int AS n FROM naya.sms_auto_log WHERE rule = $1
            AND sent_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam')`,
        [rule],
      );
      const room = Math.max(0, s.dailyCap - (today?.n ?? 0));
      if (!room) return [] as Candidate[];
      const batch = Math.min(room, 30); // kidogo kila mzunguko — kikomo cha kasi ya SMS
      const rows = await many<Candidate>(client, candidatesSql(rule), rule === 'WELCOME' ? [batch] : [batch, s.days]);
      for (const r of rows) {
        await client.query('INSERT INTO naya.sms_auto_log (rule, user_id, phone) VALUES ($1, $2, $3)', [rule, r.id, r.phone]);
      }
      return rows;
    });
    for (const r of picked) {
      const ok = await sendSms(r.phone, render(s.message, r), `auto_${rule.toLowerCase()}`, { raw: true });
      await db.query(
        `UPDATE naya.sms_auto_log SET ok = $3 WHERE id = (SELECT id FROM naya.sms_auto_log WHERE rule = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1)`,
        [rule, r.id, ok],
      );
      if (ok) total += 1;
    }
  }
  return total;
}

export async function autoOverview() {
  const settings = await getAutoSettings();
  const stats = await many<{ rule: AutoRule; today: number; week: number; failed: number; last: Date | null }>(
    db,
    `SELECT rule,
            count(*) FILTER (WHERE sent_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam'))::int AS today,
            count(*) FILTER (WHERE sent_at > now() - interval '7 days')::int AS week,
            count(*) FILTER (WHERE ok = false AND sent_at > now() - interval '7 days')::int AS failed,
            max(sent_at) AS last
       FROM naya.sms_auto_log WHERE sent_at > now() - interval '7 days' GROUP BY rule`,
  );
  const byRule = new Map(stats.map((x) => [x.rule, x]));
  // Watakaopata SMS mzunguko ujao (makadirio — bila kikomo cha siku)
  const waiting: Record<string, number> = {};
  for (const rule of AUTO_RULES) {
    const sql = candidatesSql(rule).replace(/ORDER BY [^]*? LIMIT \$1$/, '').replace(/\$2/g, '$1');
    const r = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM (${sql}) x`, rule === 'WELCOME' ? [] : [settings[rule].days]);
    waiting[rule] = r?.n ?? 0;
  }
  return {
    hours: { start: START_HOUR, end: END_HOUR },
    rules: AUTO_RULES.map((rule) => ({
      rule,
      label: RULE_LABEL[rule],
      ...settings[rule],
      waiting: waiting[rule],
      today: byRule.get(rule)?.today ?? 0,
      week: byRule.get(rule)?.week ?? 0,
      failedWeek: byRule.get(rule)?.failed ?? 0,
      lastSentAt: byRule.get(rule)?.last ?? null,
    })),
  };
}
