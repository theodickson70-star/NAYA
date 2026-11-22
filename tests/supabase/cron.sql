-- =====================================================================
-- WakalaLink — Ratiba za SMS (endesha BAADA ya ku-deploy functions)
-- Badilisha: PROJECT_REF, ANON_KEY, CRON_SECRET (iwe sawa na secret uliyoweka)
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tuma SMS zinazosubiri kila dakika 1
select cron.schedule('wakalalink-send-sms', '* * * * *', $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/send-sms',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ANON_KEY","x-cron-secret":"CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- Ripoti ya siku: 18:00 UTC = saa 3:00 usiku (21:00) Tanzania
select cron.schedule('wakalalink-daily-report', '0 18 * * *', $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/daily-report',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ANON_KEY","x-cron-secret":"CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- Kuangalia ratiba:   select * from cron.job;
-- Kufuta ratiba:      select cron.unschedule('wakalalink-send-sms');
