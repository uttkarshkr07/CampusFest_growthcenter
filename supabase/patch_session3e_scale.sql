-- Session 3, large data. Three things:
--   1. Reset restores YOUR data: tickets (with their dated history), team, campaign budgets and settings
--      now come from original_* tables, filled by scripts/load_dataset, not from text written in the database.
--   2. The app loads the big tables in pages, and only downloads a table again after it has changed.
--   3. A safe data load: reset is blocked while a load is unfinished.
-- No existing data is changed or removed. Run after parts A, B and the tickets file.
-- How to run: Supabase > SQL editor > paste the WHOLE file > Run. Safe to run again.
-- If you ever run part A or the tickets file again, run this file again afterwards.
--
-- The sample ticket is a SIMULATED SCENARIO: RISA Labs has not agreed to this.

begin;

-- ---------------------------------------------------------------------------
-- 1. What reset restores. No app account can read or write these (no policies).
-- ---------------------------------------------------------------------------
create table if not exists public.original_team (
  owner_id text primary key,
  owner_name text not null,
  team text not null check (team in ('publicity', 'sponsorship', 'events'))
);
create table if not exists public.original_settings (key text primary key, value jsonb not null);
create table if not exists public.original_campaign_plan (
  campaign_id text primary key,
  app_status text not null default 'active' check (app_status in ('planned', 'active', 'paused', 'stopped')),
  budget_inr numeric,
  notes text
);
-- one row per ticket; its history is built from the dates
create table if not exists public.original_tickets (
  ticket_key text primary key,
  id uuid not null unique,
  title text not null check (char_length(title) between 1 and 140),
  details text not null default '' check (char_length(details) <= 4000),
  from_team text not null check (from_team in ('publicity', 'sponsorship', 'events')),
  to_team text not null check (to_team in ('publicity', 'sponsorship', 'events')),
  requester_id text,
  assignee_id text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  raised_on date not null,
  needed_by date,
  accepted_on date,
  declined_on date,
  decline_reason text,
  started_on date,
  done_on date,
  simulation_note text,
  check (from_team <> to_team),
  check (needed_by is null or needed_by >= raised_on),
  check (accepted_on is null or accepted_on >= raised_on),
  check (declined_on is null or (declined_on >= raised_on and accepted_on is null)),
  check (started_on is null or (accepted_on is not null and started_on >= accepted_on)),
  check (done_on is null or (started_on is not null and done_on >= started_on))
);
create table if not exists public.data_load_state (
  only_row boolean primary key default true check (only_row),
  loading boolean not null default false
);
insert into public.data_load_state (only_row, loading) values (true, false) on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['original_team', 'original_settings', 'original_campaign_plan', 'original_tickets', 'data_load_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- the loader writes the original tables with the service key
grant usage, select on all sequences in schema public to service_role;

-- start them with what the app has today
insert into public.original_team (owner_id, owner_name, team) values
  ('T01', 'Riya Kapoor', 'sponsorship'), ('T02', 'Kabir Shah', 'sponsorship'), ('T03', 'Meera Iyer', 'publicity'),
  ('T04', 'Arjun Verma', 'publicity'), ('T05', 'Nisha Rao', 'publicity'), ('T06', 'Dev Malhotra', 'events')
on conflict (owner_id) do nothing;
insert into public.original_settings (key, value) values
  ('showup_low', '0.65'), ('showup_mid', '0.75'), ('showup_high', '0.85'), ('walkin_assumption', '100'),
  ('scale_cost_ratio', '0.8'), ('stop_cost_ratio', '1.5'), ('scale_min_showup', '0.75'),
  ('stop_max_showup', '0.55'), ('min_sample', '30'), ('whatif_penalty_base', '2'), ('whatif_penalty_stretch', '1.5')
on conflict (key) do nothing;
insert into public.original_tickets (ticket_key, id, title, details, from_team, to_team, requester_id, assignee_id, priority, raised_on, needed_by, simulation_note)
select 'TK001', '00000000-0000-4000-8000-000000000001', 'RISA Labs on board for an AI x Health Hackathon: publicity needed',
  $text$Sponsor commitment (simulated, not cash received): INR 1,50,000 cash support, of which INR 1,00,000 is prizes.

Theme: AI for cancer-care paperwork, such as prior authorization. Synthetic data only, no patient data.
Format: 24 hours, 12 Apr 11:00 to 13 Apr 11:00. Demos and awards on the afternoon of 13 Apr. Teams of 3 to 4.
Target: 40 teams, about 150 participants.
Audience: Delhi NCR computing and AI students, plus medical, pharmacy and nursing students.
Registration: 24 Mar to 5 Apr.

What Sponsorship needs from Publicity:
1. Announcement and registration page by 22 Mar.
2. Outreach to computing and health colleges.
3. Campus ambassador kit.
4. Sponsor approval of creatives before anything is posted.
5. A separate campaign, so registrations can be traced.
6. A weekly registration update to Sponsorship.

Depends on Events: overnight room, power, Wi-Fi, security, food and hostel-curfew letters.
Depends on Sponsorship: logo, problem statement, judges and approvals.$text$,
  'sponsorship', 'publicity', 'T01', 'T03', 'high', date '2025-03-15', date '2025-03-22',
  'SIMULATED SCENARIO: RISA Labs has not agreed to this.'
where not exists (select 1 from public.original_tickets);

create or replace function public._apply_tickets() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tickets (id, title, details, from_team, to_team, requester_id, assignee_id, priority, status, raised_on, needed_by, simulation_note)
  select o.id, o.title, o.details, o.from_team, o.to_team, o.requester_id, o.assignee_id, o.priority,
         case when o.done_on is not null then 'done' when o.started_on is not null then 'in_progress'
              when o.declined_on is not null then 'declined' when o.accepted_on is not null then 'accepted' else 'open' end,
         o.raised_on, o.needed_by, o.simulation_note
  from public.original_tickets o order by o.raised_on, o.ticket_key;

  -- one statement per step, so each ticket's history is numbered in order
  insert into public.ticket_events (ticket_id, kind, actor_name, story_date)
  select o.id, 'raised', coalesce(r.owner_name, initcap(o.from_team) || ' team'), o.raised_on
  from public.original_tickets o left join public.original_team r on r.owner_id = o.requester_id order by o.raised_on, o.ticket_key;

  insert into public.ticket_events (ticket_id, kind, body, actor_name, story_date)
  select o.id, s.kind, s.body, coalesce(a.owner_name, initcap(o.to_team) || ' team'), s.on_date
  from public.original_tickets o
  left join public.original_team a on a.owner_id = o.assignee_id
  cross join lateral (values (1, 'accepted', null::text, o.accepted_on), (2, 'declined', o.decline_reason, o.declined_on),
                             (3, 'in_progress', null, o.started_on), (4, 'done', null, o.done_on)) as s(step, kind, body, on_date)
  where s.on_date is not null
  order by o.ticket_key, s.step;
end $$;

create or replace function public._seed_app_defaults() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.tasks where true;
  delete from public.ticket_events where true;
  delete from public.tickets where true;
  delete from public.change_log where true;
  delete from public.settings where true;
  delete from public.campaign_plan where true;
  delete from public.team where true;
  insert into public.team (owner_id, owner_name, team) select owner_id, owner_name, team from public.original_team;
  insert into public.campaign_plan (campaign_id, app_status, budget_inr, notes)
  select c.campaign_id, coalesce(p.app_status, 'active'), p.budget_inr, p.notes
  from (select distinct campaign_id from public.original_campaigns) c
  left join public.original_campaign_plan p on p.campaign_id = c.campaign_id;
  insert into public.settings (key, value) select key, value from public.original_settings;
  perform public._apply_tickets();
end $$;
drop function if exists public._seed_tickets();
revoke all on function public._apply_tickets(), public._seed_app_defaults() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reset, and the data load
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo() returns json
language plpgsql security definer set search_path = public as $$
declare t text; n bigint; counts json := '{}'::json;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_reviewer() then
    raise exception 'Only the Reviewer account can reset the demo data.' using errcode = '42501';
  end if;
  if (select loading from public.data_load_state) then
    raise exception 'A data load did not finish. Run the load command again before resetting.';
  end if;
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations'] loop
    execute format('truncate table public.%I restart identity', t);
    execute format('insert into public.%I select * from public.%I order by _row_id', t, 'original_' || t);
    execute format('select setval(%L, coalesce((select max(_row_id) from public.%I), 0) + 1, false)', 'public.' || t || '_row_seq', t);
    execute format('select count(*) from public.%I', t) into n;
    counts := (counts::jsonb || jsonb_build_object(t, n))::json;
  end loop;
  perform public._seed_app_defaults();
  return counts;
end $$;

-- empties only the original_* tables; what people see is unchanged until the load finishes
create or replace function public.prepare_data_load() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.data_load_state set loading = true where only_row;
  truncate table public.original_event, public.original_targets, public.original_campaigns, public.original_daily_marketing,
    public.original_people, public.original_interactions, public.original_registrations,
    public.original_registration_history, public.original_checkins, public.original_sponsor_activations,
    public.original_team, public.original_settings, public.original_campaign_plan, public.original_tickets restart identity;
end $$;

-- checks the row counts, then switches the app to the new data in one step
create or replace function public.finish_data_load(p_expected jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare t text; want bigint; got bigint;
begin
  for t, want in select key, value::bigint from jsonb_each_text(p_expected) loop
    if t !~ '^original_[a-z_]+$' then raise exception 'Unexpected table %.', t; end if;
    execute format('select count(*) from public.%I', t) into got;
    if got <> want then raise exception 'Table % has % rows but % were expected. Nothing was switched.', t, got, want; end if;
  end loop;
  update public.data_load_state set loading = false where only_row;
  return public.reset_demo();
end $$;

create or replace function public.db_size_bytes() returns bigint
language sql stable security definer set search_path = public as $$ select pg_database_size(current_database()) $$;

revoke all on function public.prepare_data_load(), public.finish_data_load(jsonb), public.db_size_bytes() from public, anon, authenticated;
grant execute on function public.prepare_data_load(), public.finish_data_load(jsonb), public.db_size_bytes() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Loading in pages. Each big table has a version that changes whenever its rows change.
-- ---------------------------------------------------------------------------
create table if not exists public.data_versions (
  table_name text primary key,
  epoch text not null default gen_random_uuid()::text,
  version bigint not null default 1
);
alter table public.data_versions enable row level security;
revoke all on public.data_versions from public, anon, authenticated;
grant all on public.data_versions to service_role;

create or replace function public._bump_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.data_versions (table_name) values (tg_table_name)
  on conflict (table_name) do update set version = public.data_versions.version + 1;
  return null;
end $$;
revoke all on function public._bump_version() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['daily_marketing','people','interactions','registrations','registration_history','checkins'] loop
    insert into public.data_versions (table_name) values (t) on conflict do nothing;
    execute format('drop trigger if exists bump_version on public.%I', t);
    execute format('create trigger bump_version after insert or update or delete or truncate on public.%I for each statement execute function public._bump_version()', t);
  end loop;
end $$;

-- everything small, plus what the app needs to fetch the big tables
create or replace function public.get_app_data() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'versions', (select json_object_agg(table_name, epoch || ':' || version) from public.data_versions),
    'ranges', json_build_object(
      'daily_marketing',      (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.daily_marketing),
      'people',               (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.people),
      'interactions',         (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.interactions),
      'registrations',        (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.registrations),
      'registration_history', (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.registration_history),
      'checkins',             (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.checkins)
    ),
    'tables', json_build_object(
      'event',               (select coalesce(json_agg(x order by _row_id), '[]') from public.event x),
      'targets',             (select coalesce(json_agg(x order by _row_id), '[]') from public.targets x),
      'campaigns',           (select coalesce(json_agg(x order by _row_id), '[]') from public.campaigns x),
      'sponsor_activations', (select coalesce(json_agg(x order by _row_id), '[]') from public.sponsor_activations x),
      'campaign_plan',       (select coalesce(json_agg(x), '[]') from public.campaign_plan x),
      'team',                (select coalesce(json_agg(x order by owner_id), '[]') from public.team x),
      'tasks',               (select coalesce(json_agg(x order by created_at), '[]') from public.tasks x),
      'settings',            (select coalesce(json_agg(x), '[]') from public.settings x),
      'change_log',          (select coalesce(json_agg(x order by id), '[]') from (select * from public.change_log order by id desc limit 200) x),
      'tickets',             (select coalesce(json_agg(x order by raised_on, created_at), '[]') from public.tickets x),
      'ticket_events',       (select coalesce(json_agg(x order by id), '[]') from public.ticket_events x)
    )
  )
  where coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.is_member();
$$;

-- One page of a big table, as column names plus rows. Repeated names (person, campaign, owner) are left
-- out: the app fills them in from the id.
create or replace function public.get_rows(p_table text, p_from bigint, p_to bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_member() then
    raise exception 'Sign in as an organiser.' using errcode = '42501';
  end if;
  if p_to - p_from > 50000 then raise exception 'Ask for at most 50,000 rows at a time.'; end if;

  if p_table = 'daily_marketing' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','activity_id','campaign_id','owner_id','activity_date','impressions','clicks','reported_reach','landing_page_sessions','registration_starts','marketing_spend_inr','platform'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.activity_id,x.campaign_id,x.owner_id,x.activity_date,x.impressions,x.clicks,x.reported_reach,x.landing_page_sessions,x.registration_starts,x.marketing_spend_inr,x.platform) order by x._row_id), '[]'::json))
    into v from public.daily_marketing x where x._row_id between p_from and p_to;
  elsif p_table = 'people' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','person_id','person_name','person_type','first_seen_at','first_touch_source','first_campaign_id','owner_id'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.person_id,x.person_name,x.person_type,x.first_seen_at,x.first_touch_source,x.first_campaign_id,x.owner_id) order by x._row_id), '[]'::json))
    into v from public.people x where x._row_id between p_from and p_to;
  elsif p_table = 'interactions' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','interaction_id','person_id','campaign_id','owner_id','occurred_at','event_type','detail'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.interaction_id,x.person_id,x.campaign_id,x.owner_id,x.occurred_at,x.event_type,x.detail) order by x._row_id), '[]'::json))
    into v from public.interactions x where x._row_id between p_from and p_to;
  elsif p_table = 'registrations' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','registration_id','person_id','campaign_id','owner_id','registered_at'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.registration_id,x.person_id,x.campaign_id,x.owner_id,x.registered_at) order by x._row_id), '[]'::json))
    into v from public.registrations x where x._row_id between p_from and p_to;
  elsif p_table = 'registration_history' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','history_id','registration_id','person_id','campaign_id','owner_id','effective_at','status'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.history_id,x.registration_id,x.person_id,x.campaign_id,x.owner_id,x.effective_at,x.status) order by x._row_id), '[]'::json))
    into v from public.registration_history x where x._row_id between p_from and p_to;
  elsif p_table = 'checkins' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','event_id','person_id','registration_id','campaign_id','owner_id','occurred_at','result','verification','source'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.event_id,x.person_id,x.registration_id,x.campaign_id,x.owner_id,x.occurred_at,x.result,x.verification,x.source) order by x._row_id), '[]'::json))
    into v from public.checkins x where x._row_id between p_from and p_to;
  else
    raise exception 'Unknown table %.', p_table;
  end if;
  return v;
end $$;

revoke all on function public.get_app_data(), public.get_rows(text, bigint, bigint) from public, anon;
grant execute on function public.get_app_data(), public.get_rows(text, bigint, bigint) to authenticated, service_role;

-- Copying a large dataset on reset needs more than a few seconds.
alter role authenticated set statement_timeout = '60s';
do $$
begin
  execute 'alter role service_role set statement_timeout = ''60s''';
exception when others then
  raise notice 'The service role time limit could not be changed: %', sqlerrm;
end $$;

commit;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
