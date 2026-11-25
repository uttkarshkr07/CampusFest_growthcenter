-- CampusFest Growth Center: Supabase schema.
-- Run this whole file once in the Supabase SQL editor (safe to re-run: it drops and recreates).
-- original_* tables are the pristine import (no anon access). Unprefixed tables are the
-- editable working copy. reset_demo() restores the working copy from original_*.

-- ---------------------------------------------------------------------------
-- 0. Clean slate
-- ---------------------------------------------------------------------------
drop function if exists public.reset_demo();
drop function if exists public.get_dataset();
do $$
declare t text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations'] loop
    execute format('drop table if exists public.%I cascade', t);
    execute format('drop table if exists public.%I cascade', 'original_' || t);
  end loop;
end $$;
drop table if exists public.campaign_plan, public.team, public.tasks, public.settings, public.change_log cascade;

-- ---------------------------------------------------------------------------
-- 1. Source tables (original_*). Raw rows INCLUDING duplicate IDs: the engine dedupes.
-- ---------------------------------------------------------------------------
create table public.original_event (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  event_name text, history_start date, history_end date, event_starts_at timestamptz, event_ends_at timestamptz,
  timezone text, currency text, fictional boolean
);
create table public.original_targets (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  effective_at timestamptz not null, identified_external_people_goal numeric, registration_goal numeric,
  unique_external_visitors_goal numeric, marketing_budget_inr numeric, target_version text
);
create table public.original_campaigns (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  campaign_id text not null, campaign_name text, channel text, target_audience text, objective text,
  owner_name text, owner_id text, created_at timestamptz, planned_start_at timestamptz, planned_end_at timestamptz
);
create table public.original_daily_marketing (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  activity_id text not null, campaign_id text, campaign_name text, owner_name text, owner_id text,
  activity_date date not null, impressions numeric, clicks numeric, reported_reach numeric,
  landing_page_sessions numeric, registration_starts numeric, marketing_spend_inr numeric, platform text
);
create table public.original_people (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  person_id text not null, person_name text, person_type text, first_seen_at timestamptz, first_touch_source text,
  first_campaign_name text, first_campaign_id text, owner_name text, owner_id text
);
create table public.original_interactions (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  interaction_id text not null, person_id text, person_name text, campaign_id text, campaign_name text,
  owner_name text, owner_id text, occurred_at timestamptz, event_type text, detail text
);
create table public.original_registrations (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  registration_id text not null, person_id text, person_name text, campaign_id text, campaign_name text,
  owner_name text, owner_id text, registered_at timestamptz
);
create table public.original_registration_history (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  history_id text not null, registration_id text, person_id text, person_name text, campaign_id text,
  campaign_name text, owner_name text, owner_id text, effective_at timestamptz, status text
);
create table public.original_checkins (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  event_id text not null, person_id text, person_name text, registration_id text, campaign_id text,
  campaign_name text, owner_name text, owner_id text, occurred_at timestamptz, result text,
  verification text, source text
);
create table public.original_sponsor_activations (
  _row_id bigserial primary key, _source text not null default 'original', _deleted boolean not null default false,
  activation_id text not null, brand_name text, opportunity_name text, attendee_campaign_name text,
  attendee_campaign_id text, activation_note text, linked_at timestamptz, brand_id text, opportunity_id text
);

-- Working copies share the exact structure (own sequences).
do $$
declare t text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations'] loop
    execute format('create table public.%I (like public.%I including defaults including constraints)', t, 'original_' || t);
    execute format('create sequence public.%I owned by public.%I._row_id', t || '_row_seq', t);
    execute format('alter table public.%I alter column _row_id set default nextval(%L)', t, 'public.' || t || '_row_seq');
    execute format('alter table public.%I add primary key (_row_id)', t);
  end loop;
end $$;

create index on public.checkins (person_id);
create index on public.registration_history (registration_id);
create index on public.interactions (person_id);

-- ---------------------------------------------------------------------------
-- 2. App tables
-- ---------------------------------------------------------------------------
create table public.team (
  owner_id text primary key, owner_name text not null, team text not null
);
create table public.campaign_plan (
  campaign_id text primary key,
  app_status text not null default 'active' check (app_status in ('planned','active','paused','stopped')),
  budget_inr numeric, notes text, updated_at timestamptz not null default now()
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text, campaign_id text, owner_id text, due_at timestamptz,
  status text not null default 'todo' check (status in ('todo','doing','blocked','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  origin text not null default 'manual' check (origin in ('manual','rule','copilot')),
  origin_ref jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.settings (key text primary key, value jsonb not null);
create table public.change_log (
  id bigserial primary key, table_name text not null, row_ref text not null, field text not null,
  old_value jsonb, new_value jsonb, changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Seed app defaults (also restored by reset_demo)
-- ---------------------------------------------------------------------------
create or replace function public._seed_app_defaults() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.tasks;
  delete from public.change_log;
  delete from public.settings;
  delete from public.campaign_plan;
  delete from public.team;
  -- ASSUMPTION: team per owner (the source has owners, not teams). T03 to T06 own attendee
  -- campaigns; T01/T02 come from the Sponsor dataset's shared team dictionary.
  insert into public.team (owner_id, owner_name, team) values
    ('T01', 'Riya Kapoor', 'sponsorship'),
    ('T02', 'Kabir Shah', 'sponsorship'),
    ('T03', 'Meera Iyer', 'publicity'),
    ('T04', 'Arjun Verma', 'publicity'),
    ('T05', 'Nisha Rao', 'publicity'),
    ('T06', 'Dev Malhotra', 'events');
  -- per-campaign plan: status active, budget = null (the source has only a total budget)
  insert into public.campaign_plan (campaign_id, app_status, budget_inr)
  select distinct campaign_id, 'active', null from public.original_campaigns;
  insert into public.settings (key, value) values
    ('showup_low', '0.65'), ('showup_mid', '0.75'), ('showup_high', '0.85'), ('walkin_assumption', '100'),
    ('scale_cost_ratio', '0.8'), ('stop_cost_ratio', '1.5'), ('scale_min_showup', '0.75'),
    ('stop_max_showup', '0.55'), ('min_sample', '30');
end $$;

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo() returns json
language plpgsql security definer set search_path = public as $$
declare t text; n bigint; counts json := '{}'::json;
begin
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

-- One round trip: every table as a JSON array (timestamps come back as ISO strings).
create or replace function public.get_dataset() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'event',                (select coalesce(json_agg(x order by _row_id), '[]') from public.event x),
    'targets',              (select coalesce(json_agg(x order by _row_id), '[]') from public.targets x),
    'campaigns',            (select coalesce(json_agg(x order by _row_id), '[]') from public.campaigns x),
    'daily_marketing',      (select coalesce(json_agg(x order by _row_id), '[]') from public.daily_marketing x),
    'people',               (select coalesce(json_agg(x order by _row_id), '[]') from public.people x),
    'interactions',         (select coalesce(json_agg(x order by _row_id), '[]') from public.interactions x),
    'registrations',        (select coalesce(json_agg(x order by _row_id), '[]') from public.registrations x),
    'registration_history', (select coalesce(json_agg(x order by _row_id), '[]') from public.registration_history x),
    'checkins',             (select coalesce(json_agg(x order by _row_id), '[]') from public.checkins x),
    'sponsor_activations',  (select coalesce(json_agg(x order by _row_id), '[]') from public.sponsor_activations x),
    'campaign_plan',        (select coalesce(json_agg(x), '[]') from public.campaign_plan x),
    'team',                 (select coalesce(json_agg(x order by owner_id), '[]') from public.team x),
    'tasks',                (select coalesce(json_agg(x order by created_at), '[]') from public.tasks x),
    'settings',             (select coalesce(json_agg(x), '[]') from public.settings x),
    'change_log',           (select coalesce(json_agg(x order by id), '[]') from (select * from public.change_log order by id desc limit 200) x)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Row level security. DEMO TRADE-OFF: anon may read/write the working + app tables
-- (no login, so graders can edit data). original_* have no policies => no anon access.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations'] loop
    execute format('alter table public.%I enable row level security', 'original_' || t);
  end loop;
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations',
    'campaign_plan','team','tasks','settings','change_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', 'demo_rw_' || t, t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.event, public.targets, public.campaigns, public.daily_marketing, public.people, public.interactions,
  public.registrations, public.registration_history, public.checkins, public.sponsor_activations,
  public.campaign_plan, public.team, public.tasks, public.settings, public.change_log
  to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
revoke all on function public._seed_app_defaults() from public, anon, authenticated;
grant execute on function public.reset_demo() to anon, authenticated;
grant execute on function public.get_dataset() to anon, authenticated;

-- Allow the larger get_dataset() payload to finish for anon.
alter role anon set statement_timeout = '15s';
notify pgrst, 'reload config';
