// 0.26.0 Kituo cha SMS (ofisi tu):
//   GET  /api/admin/sms-center                     → hali ya SMS, salio, idadi ya kila kundi, templates, historia
//   POST /api/admin/sms-center/preview             → hakiki: idadi, mfano wa SMS, sehemu, makadirio vs salio
//   POST /api/admin/sms-center/send                → tuma (expectedCount lazima ilingane na hakiki)
//   GET  /api/admin/sms-center/campaigns/:id       → maendeleo + namba zilizoshindwa
//   POST /api/admin/sms-center/campaigns/:id/stop  → simamisha kutuma
//   POST /api/admin/sms-center/schedules           → panga SMS (mara moja / kila siku / kila wiki)   (0.29.0)
//   POST /api/admin/sms-center/schedules/:id/(pause|resume|cancel)
//   PUT  /api/admin/sms-center/auto/:rule          → SMS za moja kwa moja (karibu, wateja waliopotea, madereva)
//   PUT  /api/admin/sms-center/settings            → bei ya SMS moja (TSh) kwa makadirio ya gharama
//   POST /api/admin/sms-templates · PUT /api/admin/sms-templates/:id · POST /api/admin/sms-templates/:id/archive → templates
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  archiveTemplate,
  campaignDetail,
  createSchedule,
  createTemplate,
  SCHEDULE_REPEATS,
  saveCenterSettings,
  setScheduleStatus,
  previewCampaign,
  sendCampaign,
  SMS_AUDIENCES,
  smsCenterOverview,
  stopCampaign,
  TEMPLATE_AUDIENCES,
  updateTemplate,
} from '../services/sms-center.js';
import { AUTO_RULES, autoOverview, saveAutoRule } from '../services/sms-auto.js';
import { ok } from '../utils/http.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const campaignSchema = z.object({
  audience: z.enum(SMS_AUDIENCES, { error: 'Chagua wapokeaji' }),
  message: z.string({ error: 'Andika ujumbe' }).max(2000, 'Ujumbe ni mrefu mno'),
  numbers: z.string().max(10000, 'Namba ni nyingi mno').optional(),
  templateId: z.uuid().nullish(),
  important: z.boolean().optional(),
});
const scheduleSchema = campaignSchema.extend({
  runAt: z.string({ error: 'Chagua tarehe na saa' }).max(40),
  repeat: z.enum(SCHEDULE_REPEATS, { error: 'Chagua: mara moja, kila siku au kila wiki' }).default('NONE'),
});
const autoSchema = z.object({
  enabled: z.boolean(),
  message: z.string({ error: 'Andika ujumbe' }).max(480, 'Ujumbe ni mrefu mno'),
  days: z.number({ error: 'Weka siku' }).int().min(1, 'Siku angalau 1').max(365, 'Siku zisizidi 365'),
  dailyCap: z.number({ error: 'Weka kikomo' }).int().min(1, 'Kikomo angalau 1').max(1000, 'Kikomo kisizidi 1,000'),
});
const templateSchema = z.object({
  audience: z.enum(TEMPLATE_AUDIENCES, { error: 'Chagua: wateja, madereva au wote' }),
  title: z.string({ error: 'Andika jina la template' }).max(60, 'Jina ni refu mno'),
  body: z.string({ error: 'Andika ujumbe' }).max(480, 'Ujumbe ni mrefu mno'),
});

export async function smsCenterRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;

  app.get('/api/admin/sms-center', adminOnly, async () => {
    const [overview, auto] = await Promise.all([smsCenterOverview(), autoOverview()]);
    return ok({ ...overview, auto });
  });

  app.post('/api/admin/sms-center/schedules', { ...adminOnly, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply) =>
    reply.status(201).send(ok(await createSchedule(uid(request), scheduleSchema.parse(request.body ?? {})))),
  );
  app.post('/api/admin/sms-center/schedules/:id/:action', adminOnly, async (request) => {
    const { id, action } = idParam.extend({ action: z.enum(['pause', 'resume', 'cancel'], { error: 'Kitendo hakijulikani' }) }).parse(request.params);
    return ok(await setScheduleStatus(uid(request), id, action));
  });

  app.put('/api/admin/sms-center/auto/:rule', adminOnly, async (request) => {
    const { rule } = z.object({ rule: z.enum(AUTO_RULES, { error: 'Kanuni haijulikani' }) }).parse(request.params);
    await saveAutoRule(uid(request), rule, autoSchema.parse(request.body ?? {}));
    return ok(await autoOverview());
  });

  app.put('/api/admin/sms-center/settings', adminOnly, async (request) => {
    const input = z.object({ pricePerSms: z.number({ error: 'Weka bei' }).min(0, 'Bei isiwe chini ya 0').max(1000, 'Bei isizidi TSh 1,000') }).parse(request.body ?? {});
    return ok(await saveCenterSettings(uid(request), input));
  });

  app.post('/api/admin/sms-center/preview', { ...adminOnly, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) =>
    ok(await previewCampaign(campaignSchema.parse(request.body ?? {}))),
  );

  app.post('/api/admin/sms-center/send', { ...adminOnly, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = campaignSchema.extend({ expectedCount: z.number({ error: 'Hakiki kwanza' }).int().min(1) }).parse(request.body ?? {});
    return reply.status(201).send(ok(await sendCampaign(uid(request), input)));
  });

  app.get('/api/admin/sms-center/campaigns/:id', adminOnly, async (request) => ok(await campaignDetail(idParam.parse(request.params).id)));

  app.post('/api/admin/sms-center/campaigns/:id/stop', adminOnly, async (request) =>
    ok(await stopCampaign(uid(request), idParam.parse(request.params).id)),
  );

  app.post('/api/admin/sms-templates', adminOnly, async (request, reply) =>
    reply.status(201).send(ok(await createTemplate(uid(request), templateSchema.parse(request.body ?? {})))),
  );
  app.put('/api/admin/sms-templates/:id', adminOnly, async (request) =>
    ok(await updateTemplate(uid(request), idParam.parse(request.params).id, templateSchema.parse(request.body ?? {}))),
  );
  app.post('/api/admin/sms-templates/:id/archive', adminOnly, async (request) => ok(await archiveTemplate(uid(request), idParam.parse(request.params).id)));
}
