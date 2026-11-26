-- Session 3, PART A: sign-in, per-account permissions, and chat history tables.
-- ADDITIVE: no data is changed or removed, and the current site (no sign-in) keeps working.
-- How to run: Supabase > SQL editor > paste the WHOLE file > Run. Safe to run again.
-- Never run schema.sql again: it drops every table. (If you ever must, run this file and part B afterwards.)

begin;

-- ---------------------------------------------------------------------------
-- 1. Who is signed in. Filled by scripts/setup_logins.mjs. A sign-up that has no
--    profile row can see and change NOTHING, even if public sign-up is left on.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  person_id text,
  display_name text not null,
  is_reviewer boolean not null default false
);
create table if not exists public.memberships (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  team text not null check (team in ('publicity', 'sponsorship', 'events')),
  primary key (user_id, team)
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where user_id = auth.uid()) $$;

create or replace function public.is_reviewer() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where user_id = auth.uid() and is_reviewer) $$;

create or replace function public.in_team(wanted text) returns boolean
language sql stable security definer set search_path = public as
$$ select public.is_reviewer() or exists (select 1 from public.memberships where user_id = auth.uid() and team = wanted) $$;

-- A task belongs to its owner's team. Unassigned tasks are open to every organiser.
create or replace function public.can_edit_task(task_owner text) returns boolean
language sql stable security definer set search_path = public as
$$
  select public.is_member() and (
    task_owner is null
    or public.is_reviewer()
    or exists (
      select 1 from public.team t join public.memberships m on m.team = t.team
      where t.owner_id = task_owner and m.user_id = auth.uid()
    )
  )
$$;

revoke all on function public.is_member(), public.is_reviewer(), public.in_team(text), public.can_edit_task(text) from public, anon;
grant execute on function public.is_member(), public.is_reviewer(), public.in_team(text), public.can_edit_task(text) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
revoke all on public.profiles, public.memberships from anon, authenticated;
grant select on public.profiles, public.memberships to authenticated;
grant all on public.profiles, public.memberships to service_role;
drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists own_memberships on public.memberships;
create policy own_memberships on public.memberships for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Permissions on the data. The old open policy now applies only to visitors who
--    have not signed in (part B removes it). Signed-in users get the rules below.
--    "(select fn())" makes Postgres evaluate the check once per query, not once per row.
-- ---------------------------------------------------------------------------
do $$
declare t text; rule text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations',
    'campaign_plan','team','tasks','settings','change_log'] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'demo_rw_' || t) then
      execute format('alter policy %I on public.%I to anon', 'demo_rw_' || t, t);
    end if;
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('drop policy if exists team_write on public.%I', t);

    rule := case
      when t in ('campaigns','campaign_plan','daily_marketing','targets','settings') then '(select public.in_team(''publicity''))'
      when t = 'checkins' then '(select public.in_team(''events''))'
      when t in ('event','people','interactions','registrations','registration_history','sponsor_activations','team') then '(select public.is_reviewer())'
      else null
    end;
    if rule is not null then
      execute format('create policy team_write on public.%I for all to authenticated using (%s) with check (%s)', t, rule, rule);
    end if;
  end loop;
end $$;

-- tasks: both the old and the new owner must be in your team, so work cannot be pushed onto another team
create policy team_write on public.tasks for all to authenticated
  using (public.can_edit_task(owner_id)) with check (public.can_edit_task(owner_id));

-- change log: members add entries; nobody edits or deletes them (reset clears it)
drop policy if exists member_log on public.change_log;
create policy member_log on public.change_log for insert to authenticated with check ((select public.is_member()));

-- ---------------------------------------------------------------------------
-- 3. The two functions that bypass row rules check the caller themselves.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo() returns json
language plpgsql security definer set search_path = public as $$
declare t text; n bigint; counts json := '{}'::json;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_reviewer() then
    raise exception 'Only the Reviewer account can reset the demo data.' using errcode = '42501';
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
  )
  where coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.is_member();
$$;

-- ---------------------------------------------------------------------------
-- 4. Copilot chat history, private to each account. Reset keeps it.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.chat_messages (
  id uuid primary key,
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  as_of date not null,
  body jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session on public.chat_messages (session_id, created_at);
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_sessions, public.chat_messages from anon;
grant select, insert, update, delete on public.chat_sessions, public.chat_messages to authenticated;
grant all on public.chat_sessions, public.chat_messages to service_role;
drop policy if exists own_sessions on public.chat_sessions;
create policy own_sessions on public.chat_sessions for all to authenticated
  using (user_id = auth.uid() and (select public.is_member()))
  with check (user_id = auth.uid() and (select public.is_member()));
drop policy if exists own_messages on public.chat_messages;
create policy own_messages on public.chat_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid()));

-- Signed-in users need the same longer time limit for loading the full dataset.
alter role authenticated set statement_timeout = '15s';

commit;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
