-- =====================================================================
-- WakalaLink — Mfumo wa Mawakala wa Kutuma na Kutoa Pesa
-- DUKALANGU SOLUTION GROUP
-- Endesha faili hili lote kwenye Supabase > SQL Editor (mara moja).
-- =====================================================================

-- gen_random_uuid() iko ndani ya Postgres 13+ (Supabase)

-- ---------------------------------------------------------------------
-- 1. JEDWALI (TABLES)
-- ---------------------------------------------------------------------

-- Mipango ya malipo (SaaS)
create table if not exists public.plans (
  code         text primary key,              -- mwanzo, kati, biashara
  name         text not null,
  price_tzs    integer not null,
  max_outlets  integer,                        -- null = bila kikomo
  sms_per_month integer not null default 60
);

insert into public.plans (code, name, price_tzs, max_outlets, sms_per_month) values
  ('mwanzo',   'Mwanzo (Kibanda 1)',      10000, 1,    60),
  ('kati',     'Kati (Hadi vibanda 5)',   25000, 5,    200),
  ('biashara', 'Biashara (Bila kikomo)',  50000, null, 600)
on conflict (code) do nothing;

-- Biashara (tenant) — mmiliki mmoja
create table if not exists public.businesses (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  owner_id                  uuid not null references auth.users(id) on delete cascade,
  owner_phone               text,
  plan                      text not null default 'kati' references public.plans(code),
  subscription_until        timestamptz not null default (now() + interval '14 days'), -- siku 14 za majaribio
  low_float_threshold       numeric not null default 200000,
  low_cash_threshold        numeric not null default 200000,
  large_tx_threshold        numeric not null default 1000000,
  variance_alert_threshold  numeric not null default 5000,
  sms_daily_report          boolean not null default false,  -- SMS zitawashwa baadaye (RodSMS)
  sms_alerts                boolean not null default false,
  created_at                timestamptz not null default now()
);

-- Vibanda / maduka ya uwakala
create table if not exists public.outlets (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  location    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Watumiaji (mmiliki na mawakala)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  full_name   text,
  phone       text,
  email       text,
  role        text not null check (role in ('owner','agent')),
  outlet_id   uuid references public.outlets(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Mitandao inayotumika kwenye kila kibanda (namba ya wakala/till)
create table if not exists public.outlet_lines (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  outlet_id    uuid not null references public.outlets(id) on delete cascade,
  network      text not null check (network in ('mpesa','mixx','airtel','halopesa','tpesa')),
  agent_number text,
  unique (outlet_id, network)
);

-- Viwango vya kamisheni (tiers) kwa kila mtandao
create table if not exists public.commission_tiers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  network     text not null check (network in ('mpesa','mixx','airtel','halopesa','tpesa')),
  tx_type     text not null check (tx_type in ('deposit','withdrawal')),
  min_amount  numeric not null,
  max_amount  numeric not null,
  commission  numeric not null,
  check (max_amount >= min_amount)
);

-- Siku ya kazi (zamu) ya kibanda
create table if not exists public.sessions (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  outlet_id            uuid not null references public.outlets(id) on delete cascade,
  agent_id             uuid not null references public.profiles(id),
  work_date            date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  status               text not null default 'open' check (status in ('open','closed')),
  opening_cash         numeric not null default 0,
  closing_cash_counted numeric,
  expected_cash        numeric,
  cash_variance        numeric,
  notes                text,
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz
);
create unique index if not exists one_open_session_per_outlet
  on public.sessions(outlet_id) where status = 'open';

-- Float ya kila mtandao ndani ya zamu
create table if not exists public.session_floats (
  session_id            uuid not null references public.sessions(id) on delete cascade,
  network               text not null,
  opening_float         numeric not null default 0,
  closing_float_counted numeric,
  expected_float        numeric,
  variance              numeric,
  primary key (session_id, network)
);

-- Miamala ya wateja
--   deposit    = Kuweka pesa (mteja analeta cash -> cash +, float -)
--   withdrawal = Kutoa pesa  (mteja anachukua cash -> cash -, float +)
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  outlet_id      uuid not null references public.outlets(id) on delete cascade,
  session_id     uuid not null references public.sessions(id) on delete cascade,
  network        text not null,
  tx_type        text not null check (tx_type in ('deposit','withdrawal')),
  amount         numeric not null check (amount > 0),
  commission     numeric not null default 0,
  customer_phone text,
  customer_name  text,
  reference      text,
  voided         boolean not null default false,
  void_reason    text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists tx_business_date on public.transactions(business_id, created_at);
create index if not exists tx_session on public.transactions(session_id);

-- Marekebisho ya cash/float (mtaji, kununua float, matumizi n.k.)
--   cash_in    : mmiliki ameleta cash        (cash +)
--   cash_out   : cash imepelekwa kwa mmiliki/benki (cash -)
--   float_in   : float imeingia (imetumwa na mmiliki/super agent) (float +)
--   float_out  : float imetoka (imetumwa kwa mmiliki/kibanda kingine) (float -)
--   buy_float  : cash -> float  (cash -, float +)
--   sell_float : float -> cash  (float -, cash +)
--   expense    : matumizi        (cash -)
create table if not exists public.adjustments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  outlet_id   uuid not null references public.outlets(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  kind        text not null check (kind in ('cash_in','cash_out','float_in','float_out','buy_float','sell_float','expense')),
  network     text,
  amount      numeric not null check (amount > 0),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- Arifa (SMS / ndani ya app)
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null,
  message     text not null,
  phone       text,
  meta        jsonb default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  read        boolean not null default false,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists notif_pending on public.notifications(status) where status = 'pending';

-- Malipo ya usajili (Snippe)
create table if not exists public.subscription_payments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan        text not null references public.plans(code),
  months      integer not null default 1,
  amount      integer not null,
  phone       text,
  reference   text unique,
  status      text not null default 'pending' check (status in ('pending','completed','failed')),
  raw         jsonb,
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------
-- 2. FUNCTIONS ZA MSAADA
-- ---------------------------------------------------------------------

create or replace function public.my_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_outlet_id() returns uuid
language sql stable security definer set search_path = public as $$
  select outlet_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' and active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.business_active(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select subscription_until > now() from public.businesses where id = p_business), false)
$$;

create or replace function public.network_label(p text) returns text
language sql immutable as $$
  select case p when 'mpesa' then 'M-Pesa' when 'mixx' then 'Mixx by Yas'
    when 'airtel' then 'Airtel Money' when 'halopesa' then 'HaloPesa'
    when 'tpesa' then 'T-Pesa' else p end
$$;

create or replace function public.fmt_tzs(n numeric) returns text
language sql immutable as $$
  select 'TSh ' || to_char(coalesce(n,0), 'FM999,999,999,990')
$$;

-- Ongeza arifa (hutumwa kwa SMS na function ya send-sms)
create or replace function public.queue_notification(p_business uuid, p_kind text, p_message text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text; v_alerts boolean;
begin
  select owner_phone, sms_alerts into v_phone, v_alerts from businesses where id = p_business;
  insert into notifications(business_id, kind, message, phone, meta, status)
  values (p_business, p_kind, p_message, v_phone, p_meta,
          case when v_alerts and v_phone is not null then 'pending' else 'skipped' end);
end $$;

-- Kikomo cha vibanda kulingana na mpango
create or replace function public.check_outlet_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max integer; v_count integer;
begin
  select p.max_outlets into v_max from businesses b join plans p on p.code = b.plan where b.id = new.business_id;
  if v_max is not null then
    select count(*) into v_count from outlets where business_id = new.business_id and active;
    if v_count >= v_max then
      raise exception 'Mpango wako unaruhusu vibanda % tu. Panda mpango ili kuongeza.', v_max;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_outlet_limit on public.outlets;
create trigger trg_outlet_limit before insert on public.outlets
  for each row execute function public.check_outlet_limit();

-- ---------------------------------------------------------------------
-- 3. USAJILI WA MMILIKI
-- ---------------------------------------------------------------------
create or replace function public.register_business(p_business_name text, p_full_name text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bid uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'Hujaingia'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'Akaunti hii tayari imesajiliwa';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into businesses(name, owner_id, owner_phone) values (p_business_name, auth.uid(), p_phone)
    returning id into v_bid;
  insert into profiles(id, business_id, full_name, phone, email, role)
    values (auth.uid(), v_bid, p_full_name, p_phone, v_email, 'owner');
  return v_bid;
end $$;

-- ---------------------------------------------------------------------
-- 4. KAMISHENI
-- ---------------------------------------------------------------------
create or replace function public.calc_commission(p_business uuid, p_network text, p_type text, p_amount numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((
    select commission from commission_tiers
    where business_id = p_business and network = p_network and tx_type = p_type
      and p_amount between min_amount and max_amount
    order by min_amount desc limit 1), 0)
$$;

-- ---------------------------------------------------------------------
-- 5. HESABU YA ZAMU (expected cash/float)
-- ---------------------------------------------------------------------
create or replace function public.session_summary(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  v_cash numeric;
  v_floats jsonb;
  v_tot record;
begin
  select * into s from sessions where id = p_session;
  if s is null then raise exception 'Zamu haipo'; end if;
  if s.business_id <> my_business_id() then raise exception 'Huna ruhusa'; end if;

  -- CASH inayotarajiwa
  select s.opening_cash
    + coalesce((select sum(case when tx_type='deposit' then amount else -amount end)
                from transactions where session_id = p_session and not voided), 0)
    + coalesce((select sum(case kind
                  when 'cash_in' then amount when 'sell_float' then amount
                  when 'cash_out' then -amount when 'buy_float' then -amount
                  when 'expense' then -amount else 0 end)
                from adjustments where session_id = p_session), 0)
  into v_cash;

  -- FLOAT inayotarajiwa kwa kila mtandao
  select coalesce(jsonb_agg(jsonb_build_object(
      'network', f.network,
      'label', network_label(f.network),
      'opening', f.opening_float,
      'expected', f.opening_float
        + coalesce((select sum(case when tx_type='withdrawal' then amount else -amount end)
                    from transactions t where t.session_id = p_session and t.network = f.network and not t.voided), 0)
        + coalesce((select sum(case kind
                      when 'float_in' then amount when 'buy_float' then amount
                      when 'float_out' then -amount when 'sell_float' then -amount else 0 end)
                    from adjustments a where a.session_id = p_session and a.network = f.network), 0),
      'counted', f.closing_float_counted,
      'variance', f.variance
    ) order by f.network), '[]'::jsonb)
  into v_floats
  from session_floats f where f.session_id = p_session;

  select
    count(*) filter (where not voided)                                       as tx_count,
    coalesce(sum(amount) filter (where tx_type='deposit' and not voided),0)  as deposits,
    coalesce(sum(amount) filter (where tx_type='withdrawal' and not voided),0) as withdrawals,
    coalesce(sum(commission) filter (where not voided),0)                    as commission
  into v_tot from transactions where session_id = p_session;

  return jsonb_build_object(
    'session_id', s.id, 'outlet_id', s.outlet_id, 'status', s.status, 'work_date', s.work_date,
    'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opening_cash', s.opening_cash, 'expected_cash', v_cash,
    'closing_cash_counted', s.closing_cash_counted, 'cash_variance', s.cash_variance,
    'floats', v_floats,
    'tx_count', v_tot.tx_count, 'deposits', v_tot.deposits,
    'withdrawals', v_tot.withdrawals, 'commission', v_tot.commission,
    'expenses', coalesce((select sum(amount) from adjustments where session_id = p_session and kind='expense'),0)
  );
end $$;

-- Ukaguzi wa float/cash ndogo baada ya kila muamala
create or replace function public.check_low_balances(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v jsonb; f jsonb; b record; o text;
begin
  select * into b from businesses where id = (select business_id from sessions where id = p_session);
  select name into o from outlets where id = (select outlet_id from sessions where id = p_session);
  v := session_summary(p_session);

  if (v->>'expected_cash')::numeric < b.low_cash_threshold and not exists (
      select 1 from notifications where meta->>'session_id' = p_session::text and kind = 'low_cash'
        and created_at > now() - interval '3 hours') then
    perform queue_notification(b.id, 'low_cash',
      format('WakalaLink: %s - CASH imepungua: %s. Tafadhali ongeza mtaji.', o, fmt_tzs((v->>'expected_cash')::numeric)),
      jsonb_build_object('session_id', p_session));
  end if;

  for f in select * from jsonb_array_elements(v->'floats') loop
    if (f->>'expected')::numeric < b.low_float_threshold and not exists (
        select 1 from notifications where meta->>'session_id' = p_session::text and kind = 'low_float'
          and meta->>'network' = f->>'network' and created_at > now() - interval '3 hours') then
      perform queue_notification(b.id, 'low_float',
        format('WakalaLink: %s - FLOAT ya %s imepungua: %s.', o, f->>'label', fmt_tzs((f->>'expected')::numeric)),
        jsonb_build_object('session_id', p_session, 'network', f->>'network'));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. KAZI ZA WAKALA (RPC)
-- ---------------------------------------------------------------------

-- Fungua siku. p_floats: [{"network":"mpesa","amount":500000}, ...]
create or replace function public.open_session(p_opening_cash numeric, p_floats jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_prof record; v_sid uuid; f jsonb;
begin
  select * into v_prof from profiles where id = auth.uid() and active;
  if v_prof is null then raise exception 'Akaunti haipo au imezimwa'; end if;
  if v_prof.outlet_id is null then raise exception 'Hujapangiwa kibanda. Wasiliana na mmiliki.'; end if;
  if not business_active(v_prof.business_id) then raise exception 'Usajili wa biashara umeisha. Mmiliki alipie ili kuendelea.'; end if;
  if exists (select 1 from sessions where outlet_id = v_prof.outlet_id and status = 'open') then
    raise exception 'Kibanda hiki tayari kina siku iliyo wazi. Ifunge kwanza.';
  end if;

  insert into sessions(business_id, outlet_id, agent_id, opening_cash)
    values (v_prof.business_id, v_prof.outlet_id, auth.uid(), coalesce(p_opening_cash,0))
    returning id into v_sid;

  for f in select * from jsonb_array_elements(coalesce(p_floats,'[]'::jsonb)) loop
    insert into session_floats(session_id, network, opening_float)
      values (v_sid, f->>'network', coalesce((f->>'amount')::numeric, 0));
  end loop;

  return v_sid;
end $$;

-- Zamu iliyo wazi ya kibanda changu
create or replace function public.my_open_session()
returns uuid language sql stable security definer set search_path = public as $$
  select id from sessions where outlet_id = my_outlet_id() and status = 'open' limit 1
$$;

-- Rekodi muamala
create or replace function public.record_transaction(
  p_network text, p_type text, p_amount numeric,
  p_customer_phone text default null, p_customer_name text default null,
  p_reference text default null, p_commission numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s record; v_id uuid; v_comm numeric; b record; o text; v_sum jsonb; v_avail numeric;
begin
  select * into v_s from sessions where outlet_id = my_outlet_id() and status = 'open';
  if v_s is null then raise exception 'Fungua siku kwanza kabla ya kurekodi miamala.'; end if;
  if not business_active(v_s.business_id) then raise exception 'Usajili wa biashara umeisha.'; end if;
  if not exists (select 1 from session_floats where session_id = v_s.id and network = p_network) then
    insert into session_floats(session_id, network, opening_float) values (v_s.id, p_network, 0);
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'Kiasi si sahihi'; end if;

  -- Zuia muamala usiowezekana kihesabu
  v_sum := session_summary(v_s.id);
  if p_type = 'deposit' then
    select (f->>'expected')::numeric into v_avail from jsonb_array_elements(v_sum->'floats') f where f->>'network' = p_network;
    if coalesce(v_avail,0) < p_amount then
      raise exception 'Float ya % haitoshi (iliyopo: %). Nunua/ongeza float kwanza.', network_label(p_network), fmt_tzs(v_avail);
    end if;
  else
    v_avail := (v_sum->>'expected_cash')::numeric;
    if v_avail < p_amount then
      raise exception 'Cash haitoshi (iliyopo: %). Ongeza mtaji kwanza.', fmt_tzs(v_avail);
    end if;
  end if;

  v_comm := coalesce(p_commission, calc_commission(v_s.business_id, p_network, p_type, p_amount));

  insert into transactions(business_id, outlet_id, session_id, network, tx_type, amount, commission,
                           customer_phone, customer_name, reference, created_by)
  values (v_s.business_id, v_s.outlet_id, v_s.id, p_network, p_type, p_amount, v_comm,
          nullif(p_customer_phone,''), nullif(p_customer_name,''), nullif(p_reference,''), auth.uid())
  returning id into v_id;

  select * into b from businesses where id = v_s.business_id;
  if p_amount >= b.large_tx_threshold then
    select name into o from outlets where id = v_s.outlet_id;
    perform queue_notification(b.id, 'large_tx',
      format('WakalaLink: %s - Muamala mkubwa: %s %s %s. Mteja: %s',
        o, network_label(p_network), case when p_type='deposit' then 'KUWEKA' else 'KUTOA' end,
        fmt_tzs(p_amount), coalesce(p_customer_phone,'-')),
      jsonb_build_object('session_id', v_s.id, 'tx_id', v_id));
  end if;

  perform check_low_balances(v_s.id);
  return v_id;
end $$;

-- Rekodi marekebisho (mtaji, float, matumizi)
create or replace function public.record_adjustment(p_kind text, p_network text, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s record; v_id uuid;
begin
  select * into v_s from sessions where outlet_id = my_outlet_id() and status = 'open';
  if v_s is null then raise exception 'Fungua siku kwanza.'; end if;
  if p_kind in ('float_in','float_out','buy_float','sell_float') and p_network is null then
    raise exception 'Chagua mtandao';
  end if;
  if p_network is not null and not exists (select 1 from session_floats where session_id = v_s.id and network = p_network) then
    insert into session_floats(session_id, network, opening_float) values (v_s.id, p_network, 0);
  end if;
  insert into adjustments(business_id, outlet_id, session_id, kind, network, amount, note, created_by)
  values (v_s.business_id, v_s.outlet_id, v_s.id, p_kind,
          case when p_kind in ('cash_in','cash_out','expense') then null else p_network end,
          p_amount, p_note, auth.uid())
  returning id into v_id;
  perform check_low_balances(v_s.id);
  return v_id;
end $$;

-- Futa (void) muamala — wakala ndani ya siku iliyo wazi, au mmiliki wakati wowote
create or replace function public.void_transaction(p_tx uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t record; o text;
begin
  select tx.*, s.status as s_status into t from transactions tx join sessions s on s.id = tx.session_id where tx.id = p_tx;
  if t is null or t.business_id <> my_business_id() then raise exception 'Muamala haupo'; end if;
  if not is_owner() and (t.outlet_id <> my_outlet_id() or t.s_status <> 'open') then
    raise exception 'Huna ruhusa ya kufuta muamala huu';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Andika sababu ya kufuta'; end if;
  update transactions set voided = true, void_reason = p_reason where id = p_tx;
  if not is_owner() then
    select name into o from outlets where id = t.outlet_id;
    perform queue_notification(t.business_id, 'void',
      format('WakalaLink: %s - Muamala wa %s %s umefutwa. Sababu: %s', o, network_label(t.network), fmt_tzs(t.amount), p_reason),
      jsonb_build_object('tx_id', p_tx));
  end if;
end $$;

-- Funga siku. p_floats: [{"network":"mpesa","amount":430000}, ...]
create or replace function public.close_session(p_cash_counted numeric, p_floats jsonb, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s record; v jsonb; f jsonb; v_counted numeric; v_exp numeric;
        v_total_var numeric := 0; b record; o text; v_agent text;
begin
  select * into v_s from sessions where outlet_id = my_outlet_id() and status = 'open';
  if v_s is null then raise exception 'Hakuna siku iliyo wazi.'; end if;

  v := session_summary(v_s.id);

  for f in select * from jsonb_array_elements(v->'floats') loop
    select (x->>'amount')::numeric into v_counted
      from jsonb_array_elements(coalesce(p_floats,'[]'::jsonb)) x where x->>'network' = f->>'network';
    v_exp := (f->>'expected')::numeric;
    update session_floats set closing_float_counted = coalesce(v_counted, 0), expected_float = v_exp,
      variance = coalesce(v_counted,0) - v_exp
    where session_id = v_s.id and network = f->>'network';
    v_total_var := v_total_var + (coalesce(v_counted,0) - v_exp);
  end loop;

  v_exp := (v->>'expected_cash')::numeric;
  update sessions set status = 'closed', closed_at = now(), closing_cash_counted = p_cash_counted,
    expected_cash = v_exp, cash_variance = p_cash_counted - v_exp, notes = p_notes
  where id = v_s.id;
  v_total_var := v_total_var + (p_cash_counted - v_exp);

  select * into b from businesses where id = v_s.business_id;
  select name into o from outlets where id = v_s.outlet_id;
  select full_name into v_agent from profiles where id = v_s.agent_id;

  if abs(v_total_var) >= b.variance_alert_threshold then
    perform queue_notification(b.id, 'variance',
      format('WakalaLink: %s (%s) amefunga siku na %s ya %s. Cash: %s, Float: %s. Kagua kwenye app.',
        o, coalesce(v_agent,'-'), case when v_total_var < 0 then 'UPUNGUFU' else 'ZIADA' end,
        fmt_tzs(abs(v_total_var)), fmt_tzs(p_cash_counted - v_exp), fmt_tzs(v_total_var - (p_cash_counted - v_exp))),
      jsonb_build_object('session_id', v_s.id));
  end if;

  return session_summary(v_s.id) || jsonb_build_object('total_variance', v_total_var);
end $$;

-- ---------------------------------------------------------------------
-- 7. DASHIBODI NA RIPOTI ZA MMILIKI
-- ---------------------------------------------------------------------

-- Hali ya sasa ya vibanda vyote (live)
create or replace function public.owner_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_bid uuid := my_business_id(); v_res jsonb := '[]'::jsonb; o record; v_sid uuid;
        v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
begin
  if not is_owner() then raise exception 'Mmiliki pekee'; end if;
  for o in select * from outlets where business_id = v_bid and active order by name loop
    select id into v_sid from sessions where outlet_id = o.id and status = 'open' limit 1;
    if v_sid is null then
      select id into v_sid from sessions where outlet_id = o.id and work_date = v_today order by opened_at desc limit 1;
    end if;
    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'outlet_id', o.id, 'outlet_name', o.name, 'location', o.location,
      'agent_name', (select p.full_name from sessions s join profiles p on p.id = s.agent_id where s.id = v_sid),
      'summary', case when v_sid is null then null else session_summary(v_sid) end
    ));
  end loop;

  return jsonb_build_object(
    'outlets', v_res,
    'today', (select jsonb_build_object(
        'tx_count', count(*),
        'deposits', coalesce(sum(amount) filter (where tx_type='deposit'),0),
        'withdrawals', coalesce(sum(amount) filter (where tx_type='withdrawal'),0),
        'commission', coalesce(sum(commission),0))
      from transactions where business_id = v_bid and not voided
        and (created_at at time zone 'Africa/Dar_es_Salaam')::date = v_today),
    'unread_alerts', (select count(*) from notifications where business_id = v_bid and not read),
    'subscription_until', (select subscription_until from businesses where id = v_bid),
    'plan', (select plan from businesses where id = v_bid)
  );
end $$;

-- Ripoti ya kipindi (tarehe hadi tarehe), hiari kibanda kimoja
create or replace function public.report_range(p_from date, p_to date, p_outlet uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_bid uuid := my_business_id();
begin
  if not is_owner() then raise exception 'Mmiliki pekee'; end if;
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'tx_count', count(*),
        'deposits', coalesce(sum(amount) filter (where tx_type='deposit'),0),
        'withdrawals', coalesce(sum(amount) filter (where tx_type='withdrawal'),0),
        'commission', coalesce(sum(commission),0))
      from transactions t where t.business_id = v_bid and not voided
        and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
        and (p_outlet is null or t.outlet_id = p_outlet)),
    'by_network', (select coalesce(jsonb_agg(x order by x->>'commission' desc), '[]'::jsonb) from (
        select jsonb_build_object('network', network, 'label', network_label(network), 'tx_count', count(*),
          'deposits', coalesce(sum(amount) filter (where tx_type='deposit'),0),
          'withdrawals', coalesce(sum(amount) filter (where tx_type='withdrawal'),0),
          'commission', coalesce(sum(commission),0)) x
        from transactions t where t.business_id = v_bid and not voided
          and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
          and (p_outlet is null or t.outlet_id = p_outlet)
        group by network) q),
    'by_outlet', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('outlet_id', o.id, 'outlet_name', o.name,
          'tx_count', count(t.id),
          'commission', coalesce(sum(t.commission),0),
          'volume', coalesce(sum(t.amount),0),
          'variance', (select coalesce(sum(s.cash_variance),0)
                       from sessions s where s.outlet_id = o.id and s.status='closed' and s.work_date between p_from and p_to)
                    + (select coalesce(sum(sf.variance),0) from session_floats sf join sessions s on s.id = sf.session_id
                       where s.outlet_id = o.id and s.status='closed' and s.work_date between p_from and p_to),
          'expenses', (select coalesce(sum(a.amount),0) from adjustments a where a.outlet_id = o.id and a.kind = 'expense'
                       and (a.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to)) x
        from outlets o
        left join transactions t on t.outlet_id = o.id and not t.voided
          and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
        where o.business_id = v_bid and (p_outlet is null or o.id = p_outlet)
        group by o.id, o.name) q),
    'by_day', (select coalesce(jsonb_agg(x order by x->>'day'), '[]'::jsonb) from (
        select jsonb_build_object('day', d, 'tx_count', count(*), 'commission', coalesce(sum(commission),0),
          'volume', coalesce(sum(amount),0)) x
        from (select (created_at at time zone 'Africa/Dar_es_Salaam')::date d, commission, amount
              from transactions t where t.business_id = v_bid and not voided
                and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
                and (p_outlet is null or t.outlet_id = p_outlet)) z
        group by d) q),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
          'session_id', s.id, 'outlet_name', o.name, 'agent_name', p.full_name, 'work_date', s.work_date,
          'status', s.status, 'cash_variance', s.cash_variance,
          'float_variance', (select coalesce(sum(variance),0) from session_floats where session_id = s.id))
        order by s.work_date desc, o.name), '[]'::jsonb)
      from sessions s join outlets o on o.id = s.outlet_id join profiles p on p.id = s.agent_id
      where s.business_id = v_bid and s.work_date between p_from and p_to
        and (p_outlet is null or s.outlet_id = p_outlet))
  );
end $$;

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.plans              enable row level security;
alter table public.businesses         enable row level security;
alter table public.outlets            enable row level security;
alter table public.profiles           enable row level security;
alter table public.outlet_lines       enable row level security;
alter table public.commission_tiers   enable row level security;
alter table public.sessions           enable row level security;
alter table public.session_floats     enable row level security;
alter table public.transactions       enable row level security;
alter table public.adjustments        enable row level security;
alter table public.notifications      enable row level security;
alter table public.subscription_payments enable row level security;

create policy plans_read on public.plans for select using (true);

create policy biz_read on public.businesses for select using (id = my_business_id());
create policy biz_update on public.businesses for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy outlets_read on public.outlets for select using (business_id = my_business_id());
create policy outlets_write on public.outlets for all using (business_id = my_business_id() and is_owner())
  with check (business_id = my_business_id() and is_owner());

create policy profiles_read on public.profiles for select using (id = auth.uid() or business_id = my_business_id());
create policy profiles_owner_update on public.profiles for update
  using (business_id = my_business_id() and is_owner())
  with check (business_id = my_business_id());

create policy lines_read on public.outlet_lines for select using (business_id = my_business_id());
create policy lines_write on public.outlet_lines for all using (business_id = my_business_id() and is_owner())
  with check (business_id = my_business_id() and is_owner());

create policy tiers_read on public.commission_tiers for select using (business_id = my_business_id());
create policy tiers_write on public.commission_tiers for all using (business_id = my_business_id() and is_owner())
  with check (business_id = my_business_id() and is_owner());

-- Mmiliki anaona vyote; wakala anaona kibanda chake tu. Kuandika ni kupitia RPC pekee.
create policy sessions_read on public.sessions for select
  using (business_id = my_business_id() and (is_owner() or outlet_id = my_outlet_id()));
create policy sfloats_read on public.session_floats for select
  using (exists (select 1 from sessions s where s.id = session_id and s.business_id = my_business_id()
                 and (is_owner() or s.outlet_id = my_outlet_id())));
create policy tx_read on public.transactions for select
  using (business_id = my_business_id() and (is_owner() or outlet_id = my_outlet_id()));
create policy adj_read on public.adjustments for select
  using (business_id = my_business_id() and (is_owner() or outlet_id = my_outlet_id()));

create policy notif_read on public.notifications for select using (business_id = my_business_id() and is_owner());
create policy notif_update on public.notifications for update using (business_id = my_business_id() and is_owner());

create policy subpay_read on public.subscription_payments for select using (business_id = my_business_id() and is_owner());

-- Kinga: mtumiaji hawezi kubadilisha usajili, role, wala business_id mwenyewe
revoke update on public.businesses from anon, authenticated;
grant update (name, owner_phone, low_float_threshold, low_cash_threshold, large_tx_threshold,
              variance_alert_threshold, sms_daily_report, sms_alerts)
  on public.businesses to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, outlet_id, active) on public.profiles to authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read) on public.notifications to authenticated;
revoke insert, update, delete on public.sessions, public.session_floats, public.transactions,
  public.adjustments, public.subscription_payments, public.plans from anon, authenticated;

-- Ruhusa za RPC
revoke execute on function public.queue_notification(uuid,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.check_low_balances(uuid) from public, anon, authenticated;

-- Realtime ili mmiliki aone miamala papo hapo
do $$ begin
  begin alter publication supabase_realtime add table public.transactions; exception when others then null; end;
  begin alter publication supabase_realtime add table public.sessions; exception when others then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
end $$;
