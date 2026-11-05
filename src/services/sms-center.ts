// 0.26.0: Kituo cha SMS (ofisi) — templates za wateja na madereva, kutuma SMS kwa kundi au kwa namba, na historia.
//
// Kinga:
//  - Hakiki kwanza: ofisi inaona idadi ya watu, mfano wa SMS, sehemu (SMS 1 = herufi 160) na makadirio dhidi ya salio la SMS.
//  - Kutuma kunahitaji idadi ileile iliyoonekana kwenye hakiki (kundi likibadilika katikati, ofisi inaambiwa).
//  - Kikomo cha watu kwa mara moja; ujumbe usizidi SMS 3; maneno ya [kujaza] na {maneno yasiyojulikana} yanazuiwa.
//  - Ujumbe uleule kwa kundi lilelile ndani ya dakika 2 unazuiwa (kubonyeza mara mbili).
//  - Kutuma kunaweza kusimamishwa katikati.
import { createHash } from 'node:crypto';
import { db, many, one, transaction } from '../db/pool.js';
import { env } from '../config/env.js';
import { badRequest, conflict, notFound } from '../utils/http.js';
import { normalizeTzPhone } from '../utils/phone.js';
import { writeAudit } from './audit.js';
import { sendSms, smsBalance, smsEnabled, smsProvider, smsSenderLabel, smsSetupHint, toGsm } from './sms.js';

export const SMS_AUDIENCES = [
  'ALL',
  'CUSTOMERS',
  'CUSTOMERS_NEW',
  'CUSTOMERS_INACTIVE',
  'DRIVERS',
  'DRIVERS_ONLINE',
  'DRIVERS_FEE_DUE',
  'DRIVERS_PENDING',
  'NUMBERS',
] as const;
export type SmsAudience = (typeof SMS_AUDIENCES)[number];
export const TEMPLATE_AUDIENCES = ['CUSTOMERS', 'DRIVERS', 'ALL'] as const;
export type TemplateAudience = (typeof TEMPLATE_AUDIENCES)[number];

/** Watu wengi zaidi kwa kutuma mara moja (gharama + muda). */
export const MAX_RECIPIENTS = 2000;
/** SMS 3 (herufi 459) kwa ujumbe mmoja. */
export const MAX_PARTS = 3;
const MAX_NUMBERS_INPUT = 500;

interface Recipient {
  id: string | null;
  phone: string;
  full_name: string | null;
  plate_number: string | null;
  paid_until: Date | null;
  /** 0.29.0: amejiondoa kwenye SMS za matangazo */
  opt_out?: Date | null;
}

const USER_COLS = `u.id, u.phone, u.full_name, d.plate_number, d.paid_until, u.sms_opt_out_at AS opt_out`;
const ACTIVE_USER = `u.role = 'USER' AND u.status = 'ACTIVE'`;
const NOT_DRIVER = `(d.user_id IS NULL OR d.status <> 'APPROVED')`;

const AUDIENCE_SQL: Record<Exclude<SmsAudience, 'NUMBERS'>, string> = {
  ALL: `SELECT ${USER_COLS} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE ${ACTIVE_USER}`,
  CUSTOMERS: `SELECT ${USER_COLS} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE ${ACTIVE_USER} AND ${NOT_DRIVER}`,
  CUSTOMERS_NEW: `SELECT ${USER_COLS} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
                   WHERE ${ACTIVE_USER} AND ${NOT_DRIVER} AND u.created_at >= now() - interval '7 days'`,
  CUSTOMERS_INACTIVE: `SELECT ${USER_COLS} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
                        WHERE ${ACTIVE_USER} AND ${NOT_DRIVER} AND u.created_at < now() - interval '7 days'
                          AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.passenger_id = u.id AND r.requested_at >= now() - interval '30 days')`,
  DRIVERS: `SELECT ${USER_COLS} FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id WHERE ${ACTIVE_USER} AND d.status = 'APPROVED'`,
  DRIVERS_ONLINE: `SELECT ${USER_COLS} FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id WHERE ${ACTIVE_USER} AND d.status = 'APPROVED' AND d.is_online`,
  DRIVERS_FEE_DUE: `SELECT ${USER_COLS} FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id
                     WHERE ${ACTIVE_USER} AND d.status = 'APPROVED' AND (d.paid_until IS NULL OR d.paid_until < now() + interval '3 days')`,
  DRIVERS_PENDING: `SELECT ${USER_COLS} FROM naya.users u JOIN naya.drivers d ON d.user_id = u.id WHERE ${ACTIVE_USER} AND d.status = 'PENDING'`,
};

// ------------------------------------------------------------------ maandishi

export const PLACEHOLDERS = ['jina', 'jina_kamili', 'plate', 'ada_hadi', 'link', 'link_pakua'] as const;

const dateTz = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** Jaza {maneno} kwa mtu mmoja. */
export function render(message: string, r: Pick<Recipient, 'full_name' | 'plate_number' | 'paid_until'>): string {
  const full = (r.full_name ?? '').trim();
  const values: Record<string, string> = {
    jina: full.split(/\s+/)[0] || 'ndugu',
    jina_kamili: full || 'ndugu',
    plate: r.plate_number ?? '',
    ada_hadi: r.paid_until ? dateTz(r.paid_until) : 'karibuni',
    link: `${env.publicUrl}/app/`,
    link_pakua: `${env.publicUrl}/pakua/`,
  };
  return message.replace(/\{([a-z_]+)\}/g, (all, key: string) => values[key] ?? all).replace(/[ \t]+/g, ' ').trim();
}

/** SMS ngapi (sehemu) kwa maandishi haya: 160 kwa SMS moja, 153 kila sehemu ikiwa ndefu zaidi. */
export function smsParts(text: string): number {
  const n = toGsm(text).length;
  if (n === 0) return 0;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

/** Matatizo ya ujumbe kabla ya kutuma: {neno} lisilojulikana, [maneno ya kujaza] yaliyobaki. */
function messageProblems(message: string): string[] {
  const problems: string[] = [];
  const unknown = [...message.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
  if (unknown.length) problems.push(`Neno {${unknown[0]}} halijulikani. Tumia: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`);
  if (/\[[^\]]*\]/.test(message)) problems.push('Badilisha maneno yaliyo ndani ya [ ] kabla ya kutuma.');
  return problems;
}

function cleanMessage(raw: string): string {
  const message = raw.replace(/\r\n/g, '\n').trim();
  if (message.length < 5) throw badRequest('Andika ujumbe (angalau herufi 5).');
  if (message.length > 480) throw badRequest('Ujumbe ni mrefu mno.');
  return message;
}

// ------------------------------------------------------------------ wapokeaji

export function parseNumbers(raw: string) {
  const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > MAX_NUMBERS_INPUT) throw badRequest(`Namba zisizidi ${MAX_NUMBERS_INPUT} kwa mara moja.`);
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const p of parts) {
    const phone = normalizeTzPhone(p);
    if (phone) valid.add(phone);
    else invalid.push(p);
  }
  return { valid: [...valid], invalid };
}

/**
 * Wapokeaji. Waliojiondoa kwenye SMS za matangazo wanaondolewa (skipped), isipokuwa ujumbe ni "muhimu" (wa huduma).
 */
async function recipients(
  audience: SmsAudience,
  numbers?: string,
  opts: { important?: boolean } = {},
): Promise<{ list: Recipient[]; invalid: string[]; skipped: number }> {
  const all = await allRecipients(audience, numbers);
  if (opts.important) return { ...all, skipped: 0 };
  const list = all.list.filter((r) => !r.opt_out);
  return { list, invalid: all.invalid, skipped: all.list.length - list.length };
}

async function allRecipients(audience: SmsAudience, numbers?: string): Promise<{ list: Recipient[]; invalid: string[] }> {
  if (audience === 'NUMBERS') {
    const { valid, invalid } = parseNumbers(numbers ?? '');
    if (!valid.length) throw badRequest(invalid.length ? `Namba hizi si sahihi: ${invalid.slice(0, 5).join(', ')}` : 'Andika namba za simu (moja kila mstari au kwa koma).');
    const known = await many<Recipient>(
      db,
      `SELECT ${USER_COLS} FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE u.phone = ANY($1)`,
      [valid],
    );
    const byPhone = new Map(known.map((k) => [k.phone, k]));
    return { list: valid.map((phone) => byPhone.get(phone) ?? { id: null, phone, full_name: null, plate_number: null, paid_until: null }), invalid };
  }
  const rows = await many<Recipient>(db, `SELECT DISTINCT ON (x.phone) x.* FROM (${AUDIENCE_SQL[audience]}) x ORDER BY x.phone`);
  return { list: rows, invalid: [] };
}

export async function audienceSizes(): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const a of SMS_AUDIENCES) {
    if (a === 'NUMBERS') continue;
    const row = await one<{ n: number }>(db, `SELECT count(DISTINCT x.phone)::int AS n FROM (${AUDIENCE_SQL[a]}) x`);
    sizes[a] = row?.n ?? 0;
  }
  return sizes;
}

// ------------------------------------------------------------------ mipangilio: bei ya SMS

/** Bei ya SMS moja kwa TSh (kwa makadirio ya gharama tu — malipo halisi yako kwa kampuni ya SMS). 0 = haionyeshwi. */
export async function getCenterSettings(): Promise<{ pricePerSms: number }> {
  const row = await one<{ value: { pricePerSms?: number } }>(db, `SELECT value FROM naya.settings WHERE key = 'sms_center'`);
  const n = Number(row?.value?.pricePerSms ?? 0);
  return { pricePerSms: Number.isFinite(n) && n >= 0 ? Math.round(n) : 0 };
}

export async function saveCenterSettings(adminId: string, input: { pricePerSms: number }) {
  const price = Math.round(input.pricePerSms);
  if (!Number.isFinite(price) || price < 0 || price > 1000) throw badRequest('Bei ya SMS moja iwe kati ya TSh 0 na 1,000.');
  await db.query(
    `INSERT INTO naya.settings (key, value, updated_by) VALUES ('sms_center', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify({ pricePerSms: price }), adminId],
  );
  await writeAudit(db, { actorId: adminId, action: 'settings.sms_center', targetType: 'settings', targetId: null, details: { pricePerSms: price } });
  return { pricePerSms: price };
}

// ------------------------------------------------------------------ hakiki + kutuma

export interface CampaignInput {
  audience: SmsAudience;
  message: string;
  numbers?: string;
  templateId?: string | null;
  /** Ujumbe wa huduma (mf. hitilafu ya malipo): unawafikia hata waliojiondoa kwenye matangazo. */
  important?: boolean;
}

export async function previewCampaign(input: CampaignInput) {
  const message = cleanMessage(input.message);
  const { list, invalid, skipped } = await recipients(input.audience, input.numbers, { important: input.important });
  const { pricePerSms } = await getCenterSettings();
  let units = 0;
  let maxParts = 0;
  for (const r of list) {
    const p = smsParts(render(message, r));
    units += p;
    maxParts = Math.max(maxParts, p);
  }
  const balance = smsEnabled() ? await smsBalance() : null;
  const problems = messageProblems(message);
  if (maxParts > MAX_PARTS) problems.push(`Ujumbe ni mrefu: SMS ${maxParts} kwa kila mtu. Ufupishe usizidi SMS ${MAX_PARTS} (herufi ~${MAX_PARTS * 153}).`);
  if (list.length > MAX_RECIPIENTS) problems.push(`Kundi lina watu ${list.length}; unaweza kutuma kwa watu ${MAX_RECIPIENTS} kwa mara moja.`);
  if (balance !== null && units > balance) problems.push(`Salio la SMS (${balance}) halitoshi kwa SMS ${units}. Jaza salio kwanza.`);
  if (!smsEnabled()) problems.push(`SMS hazijawashwa. ${smsSetupHint() ?? ''}`.trim());
  return {
    audience: input.audience,
    count: list.length,
    invalid: invalid.slice(0, 20),
    invalidCount: invalid.length,
    units,
    maxParts,
    balance,
    problems,
    skippedOptOut: skipped,
    pricePerSms,
    cost: pricePerSms ? units * pricePerSms : null,
    samples: list.slice(0, 3).map((r) => {
      const text = render(message, r);
      return { name: r.full_name, phone: r.phone, text, parts: smsParts(text), chars: toGsm(text).length };
    }),
  };
}

export async function sendCampaign(adminId: string, input: CampaignInput & { expectedCount: number }) {
  if (!smsEnabled()) throw conflict(`SMS hazijawashwa. ${smsSetupHint() ?? ''}`.trim());
  const message = cleanMessage(input.message);
  const problems = messageProblems(message);
  if (problems.length) throw badRequest(problems[0]);
  const { list, skipped } = await recipients(input.audience, input.numbers, { important: input.important });
  if (!list.length) throw badRequest('Hakuna mtu kwenye kundi hili.');
  if (list.length !== input.expectedCount) {
    throw conflict(`Idadi ya watu imebadilika (sasa ${list.length}, uliona ${input.expectedCount}). Bonyeza "Hakiki" tena.`);
  }
  if (list.length > MAX_RECIPIENTS) throw badRequest(`Unaweza kutuma kwa watu ${MAX_RECIPIENTS} kwa mara moja (kundi hili lina ${list.length}).`);
  const rendered = list.map((r) => ({ r, text: render(message, r) }));
  const units = rendered.reduce((sum, x) => sum + smsParts(x.text), 0);
  if (rendered.some((x) => smsParts(x.text) > MAX_PARTS)) throw badRequest(`Ujumbe ni mrefu mno — usizidi SMS ${MAX_PARTS}.`);
  const balance = await smsBalance();
  if (balance !== null && units > balance) throw conflict(`Salio la SMS (${balance}) halitoshi kwa SMS ${units}. Jaza salio kwanza.`);
  // Watu walewale + ujumbe uleule ndani ya dakika 2 = kubonyeza mara mbili
  const targetKey =
    input.audience === 'NUMBERS'
      ? createHash('sha256').update(list.map((r) => r.phone).sort().join(',')).digest('hex')
      : input.audience;
  const dup = await one(
    db,
    `SELECT 1 FROM naya.sms_campaigns WHERE target_key = $1 AND message = $2 AND created_at > now() - interval '2 minutes'`,
    [targetKey, message],
  );
  if (dup) throw conflict('Ujumbe huu umeshatumwa kwa kundi hili sasa hivi. Subiri dakika 2 kama unataka kuutuma tena.');
  const id = await createCampaignRow({ ...input, message, targetKey, total: list.length, skipped, createdBy: adminId, scheduleId: null });
  await writeAudit(db, {
    actorId: adminId,
    action: 'sms.campaign',
    targetType: 'sms_campaign',
    targetId: id,
    details: { audience: input.audience, recipients: list.length, units, skippedOptOut: skipped, important: !!input.important },
  });
  // Kutuma kunaendelea nyuma ya pazia; ofisi inaona maendeleo kwenye historia.
  void runCampaign(id, rendered).catch((error) => console.error(`[sms-center] ${(error as Error).message}`));
  return { id, total: list.length, units, skippedOptOut: skipped };
}

async function createCampaignRow(x: {
  audience: SmsAudience;
  message: string;
  templateId?: string | null;
  important?: boolean;
  targetKey: string;
  total: number;
  skipped: number;
  createdBy: string | null;
  scheduleId: string | null;
}): Promise<string> {
  const template = x.templateId ? await one<{ id: string }>(db, 'SELECT id FROM naya.sms_templates WHERE id = $1', [x.templateId]) : null;
  const { pricePerSms } = await getCenterSettings();
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO naya.sms_campaigns (audience, target_key, template_id, message, total, created_by, schedule_id, important, skipped_opt_out, price_tzs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [x.audience, x.targetKey, template?.id ?? null, x.message, x.total, x.createdBy, x.scheduleId, !!x.important, x.skipped, pricePerSms],
  );
  return row!.id;
}

async function runCampaign(id: string, items: Array<{ r: Recipient; text: string }>) {
  let sent = 0;
  let failed = 0;
  let units = 0;
  const flush = (status?: 'DONE' | 'STOPPED') =>
    db.query(
      `UPDATE naya.sms_campaigns SET sent = $2, failed = $3, units = $4
              ${status ? `, status = CASE WHEN status = 'SENDING' THEN '${status}' ELSE status END, finished_at = coalesce(finished_at, now())` : ''}
        WHERE id = $1`,
      [id, sent, failed, units],
    );
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % 10 === 0) {
      await flush();
      const st = await one<{ status: string }>(db, 'SELECT status FROM naya.sms_campaigns WHERE id = $1', [id]);
      if (st?.status !== 'SENDING') return flush('STOPPED'); // ofisi imesimamisha
    }
    const { r, text } = items[i];
    if (await sendSms(r.phone, text, 'campaign', { campaignId: id, raw: true })) {
      sent += 1;
      units += smsParts(text);
    } else failed += 1;
  }
  await flush('DONE');
}

export async function stopCampaign(adminId: string, id: string) {
  const row = await one<{ id: string }>(
    db,
    `UPDATE naya.sms_campaigns SET status = 'STOPPED', finished_at = now() WHERE id = $1 AND status = 'SENDING' RETURNING id`,
    [id],
  );
  if (!row) {
    if (!(await one(db, 'SELECT 1 FROM naya.sms_campaigns WHERE id = $1', [id]))) throw notFound('Haikupatikana');
    throw conflict('Kutuma kumeshaisha.');
  }
  await writeAudit(db, { actorId: adminId, action: 'sms.campaign_stopped', targetType: 'sms_campaign', targetId: id, details: {} });
  return { stopped: true };
}

/** Server ikianza upya katikati ya kutuma: zilizokuwa zinatumwa zinaandikwa "zimesimama" (hazitumwi tena mara mbili). */
export async function markInterruptedCampaigns(): Promise<number> {
  const res = await db.query(`UPDATE naya.sms_campaigns SET status = 'STOPPED', finished_at = now() WHERE status = 'SENDING'`);
  return res.rowCount ?? 0;
}

export function listCampaigns() {
  return many(
    db,
    `SELECT c.id, c.audience, c.message, c.total, c.sent, c.failed, c.units, c.status, c.created_at AS "createdAt",
            c.finished_at AS "finishedAt", coalesce(u.full_name, CASE WHEN c.schedule_id IS NOT NULL THEN 'Ratiba' END) AS "createdBy",
            t.title AS "templateTitle", c.important, c.skipped_opt_out AS "skippedOptOut", c.schedule_id AS "scheduleId",
            CASE WHEN c.price_tzs > 0 THEN c.units * c.price_tzs END AS cost
       FROM naya.sms_campaigns c
       LEFT JOIN naya.users u ON u.id = c.created_by
       LEFT JOIN naya.sms_templates t ON t.id = c.template_id
      ORDER BY c.created_at DESC LIMIT 30`,
  );
}

export async function campaignDetail(id: string) {
  const c = await one(
    db,
    `SELECT c.id, c.audience, c.message, c.total, c.sent, c.failed, c.units, c.status, c.created_at AS "createdAt", c.finished_at AS "finishedAt"
       FROM naya.sms_campaigns c WHERE c.id = $1`,
    [id],
  );
  if (!c) throw notFound('Haikupatikana');
  const failures = await many(
    db,
    `SELECT l.phone, l.error, u.full_name AS "name" FROM naya.sms_log l LEFT JOIN naya.users u ON u.phone = l.phone
      WHERE l.campaign_id = $1 AND l.status = 'FAILED' ORDER BY l.id LIMIT 100`,
    [id],
  );
  return { ...c, failures };
}

// ------------------------------------------------------------------ templates

export function listTemplates() {
  return many(
    db,
    `SELECT id, audience, title, body, updated_at AS "updatedAt" FROM naya.sms_templates WHERE NOT archived
      ORDER BY CASE audience WHEN 'CUSTOMERS' THEN 1 WHEN 'DRIVERS' THEN 2 ELSE 3 END, title`,
  );
}

function checkTemplate(input: { audience: TemplateAudience; title: string; body: string }) {
  const title = input.title.trim();
  const body = input.body.replace(/\r\n/g, '\n').trim();
  if (title.length < 2) throw badRequest('Andika jina la template.');
  if (body.length < 5) throw badRequest('Andika ujumbe wa template.');
  const unknown = [...body.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k));
  if (unknown.length) throw badRequest(`Neno {${unknown[0]}} halijulikani. Tumia: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`);
  const longest = smsParts(render(body, { full_name: 'Mwanaidi Abdallah Mwakyusa', plate_number: 'MC 123 ABC', paid_until: new Date() }));
  if (longest > MAX_PARTS) throw badRequest(`Template ni ndefu mno — usizidi SMS ${MAX_PARTS}.`);
  return { audience: input.audience, title: title.slice(0, 60), body: body.slice(0, 480) };
}

export async function createTemplate(adminId: string, input: { audience: TemplateAudience; title: string; body: string }) {
  const t = checkTemplate(input);
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO naya.sms_templates (audience, title, body, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [t.audience, t.title, t.body, adminId],
  );
  await writeAudit(db, { actorId: adminId, action: 'sms.template_saved', targetType: 'sms_template', targetId: row!.id, details: { title: t.title } });
  return listTemplates();
}

export async function updateTemplate(adminId: string, id: string, input: { audience: TemplateAudience; title: string; body: string }) {
  const t = checkTemplate(input);
  const row = await one(
    db,
    `UPDATE naya.sms_templates SET audience = $2, title = $3, body = $4, updated_by = $5, updated_at = now() WHERE id = $1 AND NOT archived RETURNING id`,
    [id, t.audience, t.title, t.body, adminId],
  );
  if (!row) throw notFound('Template haikupatikana');
  await writeAudit(db, { actorId: adminId, action: 'sms.template_saved', targetType: 'sms_template', targetId: id, details: { title: t.title } });
  return listTemplates();
}

export async function archiveTemplate(adminId: string, id: string) {
  const row = await one(db, `UPDATE naya.sms_templates SET archived = true, updated_by = $2, updated_at = now() WHERE id = $1 AND NOT archived RETURNING id`, [id, adminId]);
  if (!row) throw notFound('Template haikupatikana');
  await writeAudit(db, { actorId: adminId, action: 'sms.template_removed', targetType: 'sms_template', targetId: id, details: {} });
  return listTemplates();
}

export async function smsCenterOverview() {
  const [templates, campaigns, sizes, balance, schedules, settings, optedOut] = await Promise.all([
    listTemplates(),
    listCampaigns(),
    audienceSizes(),
    smsEnabled() ? smsBalance() : Promise.resolve(null),
    listSchedules(),
    getCenterSettings(),
    one<{ n: number }>(db, `SELECT count(*)::int AS n FROM naya.users WHERE sms_opt_out_at IS NOT NULL AND role = 'USER'`),
  ]);
  return {
    enabled: smsEnabled(),
    senderId: smsSenderLabel(),
    providerLabel: smsProvider()?.label ?? null,
    setupHint: smsSetupHint(),
    balance,
    sizes,
    templates,
    campaigns,
    schedules,
    settings,
    optedOut: optedOut?.n ?? 0,
    placeholders: PLACEHOLDERS,
    limits: { maxRecipients: MAX_RECIPIENTS, maxParts: MAX_PARTS },
  };
}

// ------------------------------------------------------------------ 0.29.0: ratiba (kutuma baadaye / kujirudia)

export const SCHEDULE_REPEATS = ['NONE', 'DAILY', 'WEEKLY'] as const;
export type ScheduleRepeat = (typeof SCHEDULE_REPEATS)[number];
const MAX_SCHEDULE_DAYS = 90;

export async function createSchedule(adminId: string, input: CampaignInput & { runAt: string; repeat: ScheduleRepeat }) {
  const message = cleanMessage(input.message);
  const problems = messageProblems(message);
  if (problems.length) throw badRequest(problems[0]);
  const runAt = new Date(input.runAt);
  if (Number.isNaN(runAt.getTime())) throw badRequest('Chagua tarehe na saa ya kutuma.');
  if (runAt.getTime() < Date.now() + 60_000) throw badRequest('Chagua muda ujao (angalau dakika 1 kuanzia sasa).');
  if (runAt.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000) throw badRequest(`Unaweza kupanga hadi siku ${MAX_SCHEDULE_DAYS} mbele.`);
  // Kagua kundi sasa (namba sahihi, si tupu) — idadi halisi inahesabiwa wakati wa kutuma
  const { list } = await recipients(input.audience, input.numbers, { important: input.important });
  if (!list.length) throw badRequest('Hakuna mtu kwenye kundi hili kwa sasa.');
  if (list.some((r) => smsParts(render(message, r)) > MAX_PARTS)) throw badRequest(`Ujumbe ni mrefu mno — usizidi SMS ${MAX_PARTS}.`);
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO naya.sms_schedules (audience, numbers, message, template_id, important, repeat, run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.audience, input.audience === 'NUMBERS' ? input.numbers ?? '' : null, message, input.templateId ?? null, !!input.important, input.repeat, runAt, adminId],
  );
  await writeAudit(db, { actorId: adminId, action: 'sms.scheduled', targetType: 'sms_schedule', targetId: row!.id, details: { audience: input.audience, runAt, repeat: input.repeat } });
  return listSchedules();
}

export function listSchedules() {
  return many(
    db,
    `SELECT s.id, s.audience, s.message, s.important, s.repeat, s.run_at AS "runAt", s.status, s.runs, s.last_run_at AS "lastRunAt",
            s.last_note AS "lastNote", s.created_at AS "createdAt", u.full_name AS "createdBy",
            (SELECT count(*)::int FROM regexp_split_to_table(coalesce(s.numbers, ''), '[\\s,;]+') x WHERE x <> '') AS "numberCount"
       FROM naya.sms_schedules s LEFT JOIN naya.users u ON u.id = s.created_by
      WHERE s.status IN ('ACTIVE', 'PAUSED') OR s.updated_at > now() - interval '7 days'
      ORDER BY (s.status = 'ACTIVE') DESC, s.run_at
      LIMIT 50`,
  );
}

export async function setScheduleStatus(adminId: string, id: string, action: 'pause' | 'resume' | 'cancel') {
  const s = await one<{ status: string; run_at: Date; repeat: ScheduleRepeat }>(db, 'SELECT status, run_at, repeat FROM naya.sms_schedules WHERE id = $1', [id]);
  if (!s) throw notFound('Ratiba haikupatikana');
  if (s.status === 'DONE' || s.status === 'CANCELLED') throw conflict('Ratiba hii imeshaisha.');
  let next = s.run_at;
  if (action === 'resume') {
    // Muda wake ukiwa umepita wakati imesimamishwa: inayojirudia inaruka hadi muda ujao; ya mara moja inatumwa sasa hivi.
    if (s.repeat !== 'NONE') while (next.getTime() <= Date.now()) next = nextRun(next, s.repeat)!;
  }
  const status = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'CANCELLED';
  await db.query('UPDATE naya.sms_schedules SET status = $2, run_at = $3, updated_at = now() WHERE id = $1', [id, status, next]);
  await writeAudit(db, { actorId: adminId, action: `sms.schedule_${action}`, targetType: 'sms_schedule', targetId: id, details: {} });
  return listSchedules();
}

/** Muda unaofuata wa ratiba inayojirudia (saa ileile). null = haijirudii. */
export function nextRun(from: Date, repeat: ScheduleRepeat): Date | null {
  if (repeat === 'DAILY') return new Date(from.getTime() + 86_400_000);
  if (repeat === 'WEEKLY') return new Date(from.getTime() + 7 * 86_400_000);
  return null;
}

/**
 * Kila dakika: ratiba zilizofika muda wake zinatumwa. Row lock (SKIP LOCKED) — server mbili hazitumi ratiba ileile.
 * Wapokeaji wanahesabiwa upya wakati wa kutuma (mf. "Wateja wapya" wa wiki hiyo).
 */
export async function runDueSchedules(): Promise<number> {
  const due = await transaction(async (client) => {
    const rows = await many<{ id: string; audience: SmsAudience; numbers: string | null; message: string; template_id: string | null; important: boolean; repeat: ScheduleRepeat; run_at: Date; created_by: string | null }>(
      client,
      `SELECT id, audience, numbers, message, template_id, important, repeat, run_at, created_by FROM naya.sms_schedules
        WHERE status = 'ACTIVE' AND run_at <= now() ORDER BY run_at LIMIT 5 FOR UPDATE SKIP LOCKED`,
    );
    for (const r of rows) {
      let next = nextRun(r.run_at, r.repeat);
      while (next && next.getTime() <= Date.now()) next = nextRun(next, r.repeat); // server ilizima muda mrefu: usitume mara nyingi
      await client.query(
        `UPDATE naya.sms_schedules SET run_at = coalesce($2, run_at), status = CASE WHEN $2::timestamptz IS NULL THEN 'DONE' ELSE status END,
                runs = runs + 1, last_run_at = now(), updated_at = now() WHERE id = $1`,
        [r.id, next],
      );
    }
    return rows;
  });
  for (const r of due) {
    let note: string | null = null;
    let campaignId: string | null = null;
    try {
      if (!smsEnabled()) throw new Error(`SMS hazijawashwa. ${smsSetupHint() ?? ''}`.trim());
      const { list, skipped } = await recipients(r.audience, r.numbers ?? undefined, { important: r.important });
      const items = list.slice(0, MAX_RECIPIENTS).map((x) => ({ r: x, text: render(r.message, x) }));
      if (!items.length) throw new Error('Hakuna mtu kwenye kundi hili wakati wa kutuma.');
      const units = items.reduce((t, x) => t + smsParts(x.text), 0);
      const balance = await smsBalance();
      if (balance !== null && units > balance) throw new Error(`Salio la SMS (${balance}) halitoshi kwa SMS ${units}.`);
      campaignId = await createCampaignRow({
        audience: r.audience,
        message: r.message,
        templateId: r.template_id,
        important: r.important,
        targetKey: `schedule:${r.id}:${Date.now()}`,
        total: items.length,
        skipped,
        createdBy: r.created_by,
        scheduleId: r.id,
      });
      note = `Imetumwa kwa watu ${items.length}${list.length > MAX_RECIPIENTS ? ` (kati ya ${list.length} — kikomo ${MAX_RECIPIENTS})` : ''}`;
      void runCampaign(campaignId, items).catch((error) => console.error(`[sms-ratiba] ${(error as Error).message}`));
    } catch (error) {
      note = `Haikutumwa: ${(error as Error).message}`.slice(0, 200);
    }
    await db.query('UPDATE naya.sms_schedules SET last_note = $2, last_campaign_id = coalesce($3, last_campaign_id) WHERE id = $1', [r.id, note, campaignId]);
  }
  return due.length;
}
