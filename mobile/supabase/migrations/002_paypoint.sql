-- =====================================================================
-- PayPoint (002) — Kituo Chako cha Pesa
-- Endesha BAADA ya 001_wakalalink.sql (SQL Editor, mara moja).
-- Inaongeza tu: daftari la wateja, kumbukumbu (audit log), mfanyakazi anaona miamala yake tu,
-- mmiliki hawezi kufuta/kubatilisha muamala, na ripoti kwa kila mfanyakazi. Haifuti data yoyote.
-- =====================================================================

-- Namba ya simu katika muundo mmoja: 0754123456 / +255 754 123 456 -> 255754123456
create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select case
    when p is null or regexp_replace(p, '\D', '', 'g') = '' then null
    when regexp_replace(p, '\D', '', 'g') ~ '^0[0-9]{9}$' then '255' || substr(regexp_replace(p, '\D', '', 'g'), 2)
    when regexp_replace(p, '\D', '', 'g') ~ '^[67][0-9]{8}$' then '255' || regexp_replace(p, '\D', '', 'g')
    else regexp_replace(p, '\D', '', 'g')
  end
$$;

-- ---------------------------------------------------------------------
-- 1. WATEJA (daftari: jina na simu tu — salio la mteja liko kwa mtandao, si hapa)
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone       text not null,
  full_name   text,
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, phone)
);
alter table public.transactions add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists tx_customer on public.transactions(customer_id);
create index if not exists tx_created_by on public.transactions(created_by, created_at);

-- ---------------------------------------------------------------------
-- 2. KUMBUKUMBU (audit log) — haiwezi kubadilishwa wala kufutwa na mtumiaji
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,
  action      text not null,
  details     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_biz_time on public.audit_log(business_id, created_at desc);

create or replace function public.write_audit(p_business uuid, p_actor uuid, p_action text, p_details text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid; v_name text;
begin
  if p_business is null then return; end if;
  select id, full_name into v_actor, v_name from profiles where id = p_actor;
  insert into audit_log(business_id, actor_id, actor_name, action, details, meta)
  values (p_business, v_actor, coalesce(v_name, 'Mfumo'), p_action, p_details, coalesce(p_meta, '{}'::jsonb));
end $$;
revoke execute on function public.write_audit(uuid,uuid,text,text,jsonb) from public, anon, authenticated;

-- Kuingia / kutoka (app inaita hii)
create or replace function public.log_event(p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_action not in ('login', 'logout') then raise exception 'Kitendo hakiruhusiwi'; end if;
  perform write_audit(my_business_id(), auth.uid(), p_action,
    case p_action when 'login' then 'Ameingia kwenye mfumo' else 'Ametoka kwenye mfumo' end);
end $$;

-- Miamala
create or replace function public.trg_audit_tx() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text;
begin
  select name into o from outlets where id = new.outlet_id;
  if tg_op = 'INSERT' then
    perform write_audit(new.business_id, new.created_by, case when new.tx_type = 'deposit' then 'kuweka' else 'kutoa' end,
      format('%s %s %s — %s%s', case when new.tx_type = 'deposit' then 'Kuweka' else 'Kutoa' end,
        network_label(new.network), fmt_tzs(new.amount), o,
        case when new.customer_phone is not null then ' • mteja ' || coalesce(new.customer_name || ' ', '') || new.customer_phone else '' end),
      jsonb_build_object('tx_id', new.id, 'amount', new.amount, 'commission', new.commission));
  elsif new.voided and not old.voided then
    perform write_audit(new.business_id, auth.uid(), 'batilisha',
      format('Amebatilisha muamala wa %s %s (%s). Sababu: %s', network_label(new.network), fmt_tzs(new.amount), o, new.void_reason),
      jsonb_build_object('tx_id', new.id));
  end if;
  return null;
end $$;
drop trigger if exists audit_tx on public.transactions;
create trigger audit_tx after insert or update of voided on public.transactions
  for each row execute function public.trg_audit_tx();

-- Float, mtaji na matumizi
create or replace function public.trg_audit_adj() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text; k text;
begin
  select name into o from outlets where id = new.outlet_id;
  k := case new.kind
    when 'cash_in' then 'Mtaji wa cash umeingia' when 'cash_out' then 'Cash imepelekwa kwa mmiliki/benki'
    when 'buy_float' then 'Amenunua float' when 'sell_float' then 'Ameuza float'
    when 'float_in' then 'Float imeingia' when 'float_out' then 'Float imetoka' else 'Matumizi' end;
  perform write_audit(new.business_id, new.created_by,
    case when new.kind in ('cash_in','cash_out') then 'mtaji' when new.kind = 'expense' then 'matumizi' else 'float' end,
    format('%s%s %s — %s%s', k, case when new.network is not null then ' ' || network_label(new.network) else '' end,
      fmt_tzs(new.amount), o, case when coalesce(new.note,'') <> '' then ' (' || new.note || ')' else '' end),
    jsonb_build_object('adjustment_id', new.id));
  return null;
end $$;
drop trigger if exists audit_adj on public.adjustments;
create trigger audit_adj after insert on public.adjustments for each row execute function public.trg_audit_adj();

-- Kufungua / kufunga siku
create or replace function public.trg_audit_session() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text; v numeric;
begin
  select name into o from outlets where id = new.outlet_id;
  if tg_op = 'INSERT' then
    perform write_audit(new.business_id, new.agent_id, 'fungua_siku',
      format('Amefungua siku — %s. Cash ya kuanzia %s', o, fmt_tzs(new.opening_cash)), jsonb_build_object('session_id', new.id));
  elsif new.status = 'closed' and old.status <> 'closed' then
    v := coalesce(new.cash_variance, 0) + coalesce((select sum(variance) from session_floats where session_id = new.id), 0);
    perform write_audit(new.business_id, coalesce(auth.uid(), new.agent_id), 'funga_siku',
      format('Amefunga siku — %s. %s', o,
        case when v = 0 then 'Hesabu iko sawa' when v < 0 then 'Upungufu ' || fmt_tzs(abs(v)) else 'Ziada ' || fmt_tzs(v) end),
      jsonb_build_object('session_id', new.id, 'variance', v));
  end if;
  return null;
end $$;
drop trigger if exists audit_session on public.sessions;
create trigger audit_session after insert or update of status on public.sessions
  for each row execute function public.trg_audit_session();

-- Wafanyakazi
create or replace function public.trg_audit_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid; o text;
begin
  if new.role <> 'agent' or new.business_id is null then return null; end if;
  actor := coalesce(auth.uid(), (select owner_id from businesses where id = new.business_id));
  if tg_op = 'INSERT' then
    select name into o from outlets where id = new.outlet_id;
    perform write_audit(new.business_id, actor, 'mfanyakazi',
      format('Ameongeza mfanyakazi %s%s', coalesce(new.full_name, new.email, ''), coalesce(' — kibanda ' || o, '')),
      jsonb_build_object('profile_id', new.id));
  else
    if new.active is distinct from old.active then
      perform write_audit(new.business_id, actor, 'mfanyakazi',
        format('%s mfanyakazi %s', case when new.active then 'Amewasha' else 'Amezima' end, coalesce(new.full_name, '')),
        jsonb_build_object('profile_id', new.id));
    end if;
    if new.outlet_id is distinct from old.outlet_id then
      select name into o from outlets where id = new.outlet_id;
      perform write_audit(new.business_id, actor, 'mfanyakazi',
        format('Amemhamisha %s kwenda %s', coalesce(new.full_name, ''), coalesce(o, 'bila kibanda')),
        jsonb_build_object('profile_id', new.id));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists audit_profile on public.profiles;
create trigger audit_profile after insert or update of active, outlet_id on public.profiles
  for each row execute function public.trg_audit_profile();

-- Vibanda
create or replace function public.trg_audit_outlet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform write_audit(new.business_id, auth.uid(), 'kibanda', format('Ameongeza kibanda %s', new.name), jsonb_build_object('outlet_id', new.id));
  elsif new.name is distinct from old.name or new.active is distinct from old.active or new.location is distinct from old.location then
    perform write_audit(new.business_id, auth.uid(), 'kibanda',
      format('Amebadilisha kibanda %s%s', new.name, case when new.active is distinct from old.active
        then case when new.active then ' (kimewashwa)' else ' (kimezimwa)' end else '' end),
      jsonb_build_object('outlet_id', new.id));
  end if;
  return null;
end $$;
drop trigger if exists audit_outlet on public.outlets;
create trigger audit_outlet after insert or update on public.outlets for each row execute function public.trg_audit_outlet();

-- Viwango vya kamisheni
create or replace function public.trg_audit_tier() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  perform write_audit(r.business_id, auth.uid(), 'kamisheni',
    format('%s kiwango: %s %s %s – %s = %s', case when tg_op = 'DELETE' then 'Ameondoa' else 'Ameongeza' end,
      network_label(r.network), case when r.tx_type = 'deposit' then 'Kuweka' else 'Kutoa' end,
      fmt_tzs(r.min_amount), fmt_tzs(r.max_amount), fmt_tzs(r.commission)));
  return null;
end $$;
drop trigger if exists audit_tier on public.commission_tiers;
create trigger audit_tier after insert or delete on public.commission_tiers for each row execute function public.trg_audit_tier();

-- Mipangilio ya biashara
create or replace function public.trg_audit_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.name, new.owner_phone, new.low_float_threshold, new.low_cash_threshold, new.large_tx_threshold, new.variance_alert_threshold)
     is distinct from
     (old.name, old.owner_phone, old.low_float_threshold, old.low_cash_threshold, old.large_tx_threshold, old.variance_alert_threshold) then
    perform write_audit(new.id, auth.uid(), 'mipangilio', 'Amebadilisha mipangilio ya biashara na viwango vya tahadhari');
  end if;
  if new.subscription_until is distinct from old.subscription_until then
    perform write_audit(new.id, null, 'usajili', format('Usajili umesasishwa hadi %s', to_char(new.subscription_until at time zone 'Africa/Dar_es_Salaam', 'DD/MM/YYYY')));
  end if;
  return null;
end $$;
drop trigger if exists audit_business on public.businesses;
create trigger audit_business after update on public.businesses for each row execute function public.trg_audit_business();

-- Wateja
create or replace function public.trg_audit_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform write_audit(new.business_id, coalesce(auth.uid(), new.created_by), 'mteja',
      format('Mteja mpya: %s %s', coalesce(new.full_name, ''), new.phone), jsonb_build_object('customer_id', new.id));
  elsif new.full_name is distinct from old.full_name or new.notes is distinct from old.notes then
    perform write_audit(new.business_id, auth.uid(), 'mteja',
      format('Taarifa za mteja zimebadilishwa: %s %s', coalesce(new.full_name, ''), new.phone), jsonb_build_object('customer_id', new.id));
  end if;
  return null;
end $$;
drop trigger if exists audit_customer on public.customers;
create trigger audit_customer after insert or update on public.customers for each row execute function public.trg_audit_customer();

-- Arifa zote zianze na jina jipya
create or replace function public.trg_notif_brand() returns trigger
language plpgsql as $$
begin
  new.message := regexp_replace(new.message, '^WakalaLink:', 'PayPoint:');
  return new;
end $$;
drop trigger if exists notif_brand on public.notifications;
create trigger notif_brand before insert on public.notifications for each row execute function public.trg_notif_brand();

-- Usajili wa biashara mpya unaonekana kwenye kumbukumbu
create or replace function public.trg_audit_new_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' and new.business_id is not null then
    perform write_audit(new.business_id, new.id, 'usajili', format('Biashara imesajiliwa na %s', coalesce(new.full_name, 'mmiliki')));
  end if;
  return null;
end $$;
drop trigger if exists audit_new_business on public.profiles;
create trigger audit_new_business after insert on public.profiles for each row execute function public.trg_audit_new_business();

-- ---------------------------------------------------------------------
-- 3. RPC ZA WATEJA
-- ---------------------------------------------------------------------
create or replace function public.save_customer(p_phone text, p_name text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_bid uuid := my_business_id(); v_phone text := norm_phone(p_phone); v_id uuid;
begin
  if v_bid is null or not coalesce((select active from profiles where id = auth.uid()), false) then
    raise exception 'Huna ruhusa';
  end if;
  if v_phone is null or length(v_phone) < 10 then raise exception 'Weka namba sahihi ya simu'; end if;
  insert into customers(business_id, phone, full_name, notes, created_by)
  values (v_bid, v_phone, nullif(trim(coalesce(p_name,'')),''), nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  on conflict (business_id, phone) do update
    set full_name = coalesce(nullif(trim(coalesce(excluded.full_name,'')),''), customers.full_name),
        notes = coalesce(excluded.notes, customers.notes),
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Tafuta mteja kwa simu (wakati wa kuandika muamala)
create or replace function public.customer_by_phone(p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'business_id' from customers c
  where c.business_id = my_business_id() and c.phone = norm_phone(p_phone)
$$;

-- Orodha ya wateja. Mfanyakazi anaona idadi ya miamala YAKE tu kwa kila mteja.
create or replace function public.customers_list(p_search text default null, p_limit int default 200)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'last_tx' desc nulls last, x->>'full_name'), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'notes', c.notes,
      'created_at', c.created_at,
      'tx_count', count(t.id),
      'volume', coalesce(sum(t.amount), 0),
      'last_tx', max(t.created_at)) x
    from customers c
    left join transactions t on t.customer_id = c.id and not t.voided
      and (is_owner() or t.created_by = auth.uid())
    where c.business_id = my_business_id()
      and (coalesce(p_search, '') = ''
           or c.full_name ilike '%' || p_search || '%'
           or c.phone like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
           or c.phone = norm_phone(p_search))
    group by c.id
    limit greatest(1, least(p_limit, 500))
  ) q
$$;

-- ---------------------------------------------------------------------
-- 4. MIAMALA: rekodi (na daftari la wateja) + kubatilisha
-- ---------------------------------------------------------------------
create or replace function public.record_transaction(
  p_network text, p_type text, p_amount numeric,
  p_customer_phone text default null, p_customer_name text default null,
  p_reference text default null, p_commission numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s record; v_id uuid; v_comm numeric; b record; o text; v_sum jsonb; v_avail numeric;
        v_phone text := norm_phone(p_customer_phone); v_cust uuid;
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

  -- Daftari la wateja: mteja anasajiliwa (au jina lake linasasishwa) kwa namba ya simu
  if v_phone is not null then
    insert into customers(business_id, phone, full_name, created_by)
    values (v_s.business_id, v_phone, nullif(trim(coalesce(p_customer_name,'')),''), auth.uid())
    on conflict (business_id, phone) do update
      set full_name = coalesce(nullif(trim(coalesce(excluded.full_name,'')),''), customers.full_name),
          updated_at = case when excluded.full_name is not null and excluded.full_name is distinct from customers.full_name
                            then now() else customers.updated_at end
    returning id, coalesce(full_name, p_customer_name) into v_cust, p_customer_name;
  end if;

  insert into transactions(business_id, outlet_id, session_id, network, tx_type, amount, commission,
                           customer_phone, customer_name, customer_id, reference, created_by)
  values (v_s.business_id, v_s.outlet_id, v_s.id, p_network, p_type, p_amount, v_comm,
          coalesce(v_phone, nullif(p_customer_phone,'')), nullif(trim(coalesce(p_customer_name,'')),''), v_cust,
          nullif(p_reference,''), auth.uid())
  returning id into v_id;

  select * into b from businesses where id = v_s.business_id;
  if p_amount >= b.large_tx_threshold then
    select name into o from outlets where id = v_s.outlet_id;
    perform queue_notification(b.id, 'large_tx',
      format('PayPoint: %s - Muamala mkubwa: %s %s %s. Mteja: %s',
        o, network_label(p_network), case when p_type='deposit' then 'KUWEKA' else 'KUTOA' end,
        fmt_tzs(p_amount), coalesce(p_customer_phone,'-')),
      jsonb_build_object('session_id', v_s.id, 'tx_id', v_id));
  end if;

  perform check_low_balances(v_s.id);
  return v_id;
end $$;

-- Muamala haufutwi kamwe. Wakala aliyeurekodi anaweza KUUBATILISHA (unabaki kwenye rekodi ukiwa na alama
-- na sababu) siku ikiwa bado wazi. Mmiliki hawezi kubatilisha (usalama).
create or replace function public.void_transaction(p_tx uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare t record; o text;
begin
  select tx.*, s.status as s_status into t from transactions tx join sessions s on s.id = tx.session_id where tx.id = p_tx;
  if t is null or t.business_id <> my_business_id() then raise exception 'Muamala haupo'; end if;
  if is_owner() then
    raise exception 'Mmiliki hawezi kubatilisha muamala. Muamala ni kumbukumbu ya kudumu.';
  end if;
  if t.created_by is distinct from auth.uid() or t.s_status <> 'open' then
    raise exception 'Unaweza kubatilisha muamala wako tu, siku ikiwa bado wazi.';
  end if;
  if t.voided then raise exception 'Muamala huu umeshabatilishwa'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Andika sababu ya kubatilisha'; end if;
  update transactions set voided = true, void_reason = p_reason where id = p_tx;
  select name into o from outlets where id = t.outlet_id;
  perform queue_notification(t.business_id, 'void',
    format('PayPoint: %s - Muamala wa %s %s umebatilishwa. Sababu: %s', o, network_label(t.network), fmt_tzs(t.amount), p_reason),
    jsonb_build_object('tx_id', p_tx));
end $$;

-- ---------------------------------------------------------------------
-- 5. RIPOTI (sasa inachuja kwa mfanyakazi na ina sehemu ya "kwa mfanyakazi")
-- ---------------------------------------------------------------------
drop function if exists public.report_range(date, date, uuid);
create or replace function public.report_range(p_from date, p_to date, p_outlet uuid default null, p_agent uuid default null)
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
        and (p_outlet is null or t.outlet_id = p_outlet)
                and (p_agent is null or t.created_by = p_agent)),
    'by_network', (select coalesce(jsonb_agg(x order by x->>'commission' desc), '[]'::jsonb) from (
        select jsonb_build_object('network', network, 'label', network_label(network), 'tx_count', count(*),
          'deposits', coalesce(sum(amount) filter (where tx_type='deposit'),0),
          'withdrawals', coalesce(sum(amount) filter (where tx_type='withdrawal'),0),
          'commission', coalesce(sum(commission),0)) x
        from transactions t where t.business_id = v_bid and not voided
          and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
          and (p_outlet is null or t.outlet_id = p_outlet)
                and (p_agent is null or t.created_by = p_agent)
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
          and (p_agent is null or t.created_by = p_agent)
        where o.business_id = v_bid and (p_outlet is null or o.id = p_outlet)
        group by o.id, o.name) q),
    'by_day', (select coalesce(jsonb_agg(x order by x->>'day'), '[]'::jsonb) from (
        select jsonb_build_object('day', d, 'tx_count', count(*), 'commission', coalesce(sum(commission),0),
          'volume', coalesce(sum(amount),0)) x
        from (select (created_at at time zone 'Africa/Dar_es_Salaam')::date d, commission, amount
              from transactions t where t.business_id = v_bid and not voided
                and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
                and (p_outlet is null or t.outlet_id = p_outlet)
                and (p_agent is null or t.created_by = p_agent)) z
        group by d) q),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
          'session_id', s.id, 'outlet_name', o.name, 'agent_name', p.full_name, 'work_date', s.work_date,
          'status', s.status, 'cash_variance', s.cash_variance,
          'float_variance', (select coalesce(sum(variance),0) from session_floats where session_id = s.id))
        order by s.work_date desc, o.name), '[]'::jsonb)
      from sessions s join outlets o on o.id = s.outlet_id join profiles p on p.id = s.agent_id
      where s.business_id = v_bid and s.work_date between p_from and p_to
        and (p_outlet is null or s.outlet_id = p_outlet)
        and (p_agent is null or s.agent_id = p_agent)),
    -- Kwa kila mfanyakazi: nani kafanya nini
    'by_agent', (select coalesce(jsonb_agg(x order by (x->>'commission')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('agent_id', p.id, 'agent_name', p.full_name, 'active', p.active,
          'tx_count', count(t.id),
          'deposits', coalesce(sum(t.amount) filter (where t.tx_type='deposit'),0),
          'withdrawals', coalesce(sum(t.amount) filter (where t.tx_type='withdrawal'),0),
          'commission', coalesce(sum(t.commission),0),
          'voided', (select count(*) from transactions v where v.created_by = p.id and v.voided
                       and (v.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
                       and (p_outlet is null or v.outlet_id = p_outlet)),
          'variance', (select coalesce(sum(s.cash_variance),0) from sessions s
                       where s.agent_id = p.id and s.status='closed' and s.work_date between p_from and p_to
                         and (p_outlet is null or s.outlet_id = p_outlet))
                    + (select coalesce(sum(sf.variance),0) from session_floats sf join sessions s on s.id = sf.session_id
                       where s.agent_id = p.id and s.status='closed' and s.work_date between p_from and p_to
                         and (p_outlet is null or s.outlet_id = p_outlet))) x
        from profiles p
        left join transactions t on t.created_by = p.id and not t.voided
          and (t.created_at at time zone 'Africa/Dar_es_Salaam')::date between p_from and p_to
          and (p_outlet is null or t.outlet_id = p_outlet)
        where p.business_id = v_bid and p.role = 'agent' and (p_agent is null or p.id = p_agent)
        group by p.id, p.full_name, p.active) q)
  );
end $$;

-- Kumbukumbu kwa mmiliki (inachuja kwa kitendo / mfanyakazi / tarehe)
create or replace function public.audit_list(p_from date default null, p_to date default null,
  p_action text default null, p_actor uuid default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Mmiliki pekee'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(a) - 'business_id' order by a.created_at desc, a.id desc), '[]'::jsonb) from (
    select * from audit_log a
    where a.business_id = my_business_id()
      and (p_from is null or (a.created_at at time zone 'Africa/Dar_es_Salaam')::date >= p_from)
      and (p_to is null or (a.created_at at time zone 'Africa/Dar_es_Salaam')::date <= p_to)
      and (p_action is null or a.action = p_action)
      and (p_actor is null or a.actor_id = p_actor)
    order by a.created_at desc, a.id desc
    limit greatest(1, least(p_limit, 1000))) a);
end $$;

-- ---------------------------------------------------------------------
-- 6. RUHUSA (RLS)
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select using (business_id = my_business_id());

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select using (business_id = my_business_id() and is_owner());

-- Mfanyakazi anaona miamala na marekebisho YAKE tu; mmiliki anaona yote
drop policy if exists tx_read on public.transactions;
create policy tx_read on public.transactions for select
  using (business_id = my_business_id() and (is_owner() or created_by = auth.uid()));
drop policy if exists adj_read on public.adjustments;
create policy adj_read on public.adjustments for select
  using (business_id = my_business_id() and (is_owner() or created_by = auth.uid()));

-- Kuandika ni kupitia RPC pekee; kumbukumbu haziguswi kabisa
revoke insert, update, delete on public.customers, public.audit_log from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;
revoke execute on function public.trg_audit_tx() from public, anon, authenticated;
