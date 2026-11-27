-- Session 4 (P4): a second dataset beside the original one, and the tables for the bets.
--
--   original   today's tables. This file changes none of them and none of their functions.
--   simulated  the same tables with the prefix sim_, plus the bet and program tables.
--
-- A load or a reset of one dataset cannot touch the other: each has its own tables and functions.
-- The only changes to what already exists:
--   chat_sessions gets a "dataset" column (existing chats count as original).
--   Two new read-only tables, venues and program_events, hold the program for the original dataset.
--
-- ADDITIVE: no data is changed or removed. Run after parts A, B, the sponsor, tickets and 3e files.
-- How to run: Supabase > SQL editor > paste the WHOLE file > Run. Safe to run again.
-- If this file ever changes an existing sim_ table's columns, add them with "add column if not exists".
-- The simulated dataset stays empty until:  npm run data:load -- --dataset simulated
--
-- The sim_ functions are copies of the original ones with the sim_ tables. tests/sql_drift.test.ts
-- fails if a copy and its original drift apart.

begin;

do $$
begin
  if to_regclass('public.data_load_state') is null or to_regclass('public.tickets') is null
     or to_regclass('public.sponsor_data') is null or to_regclass('public.chat_sessions') is null then
    raise exception 'Run the earlier patches first (part A, sponsor, tickets and session 3e).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Copies of the existing tables.
--    "like" would copy the original's sequence as the new default, so every numbered column
--    gets a sequence of its own.
-- ---------------------------------------------------------------------------
do $$
declare t text; prefix text; name text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations'] loop
    foreach prefix in array array['original_', ''] loop
      name := 'sim_' || prefix || t;
      execute format('create table if not exists public.%I (like public.%I including defaults including constraints including indexes)', name, prefix || t);
      execute format('create sequence if not exists public.%I owned by public.%I._row_id', name || '_row_seq', name);
      execute format('alter table public.%I alter column _row_id set default nextval(%L)', name, 'public.' || name || '_row_seq');
    end loop;
  end loop;

  foreach t in array array['original_team','original_settings','original_campaign_plan','original_tickets',
    'team','campaign_plan','settings','tasks','change_log','tickets','ticket_events','data_load_state','sponsor_data'] loop
    execute format('create table if not exists public.%I (like public.%I including defaults including constraints including indexes)', 'sim_' || t, t);
  end loop;

  foreach t in array array['change_log','ticket_events'] loop
    execute format('create sequence if not exists public.%I owned by public.%I.id', 'sim_' || t || '_id_seq', 'sim_' || t);
    execute format('alter table public.%I alter column id set default nextval(%L)', 'sim_' || t, 'public.sim_' || t || '_id_seq');
  end loop;
end $$;

-- "like" copies no foreign keys
alter table public.sim_tasks drop constraint if exists sim_tasks_ticket_id_fkey;
alter table public.sim_tasks add constraint sim_tasks_ticket_id_fkey foreign key (ticket_id) references public.sim_tickets (id) on delete set null;
alter table public.sim_ticket_events drop constraint if exists sim_ticket_events_ticket_id_fkey;
alter table public.sim_ticket_events add constraint sim_ticket_events_ticket_id_fkey foreign key (ticket_id) references public.sim_tickets (id) on delete cascade;

insert into public.sim_data_load_state (only_row, loading) values (true, false) on conflict do nothing;

-- new columns, added in the same order to both copies (reset copies one into the other)
do $$
declare name text; c text;
begin
  foreach name in array array['sim_original_people', 'sim_people'] loop
    execute format('alter table public.%I add column if not exists college_id text', name);
  end loop;
  foreach name in array array['sim_original_registrations', 'sim_registrations'] loop
    foreach c in array array['route', 'squad_id', 'contingent_id', 'test_name', 'test_arm'] loop
      execute format('alter table public.%I add column if not exists %I text', name, c);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bet and program tables (strategy/tracking_spec.md; the column list is also in lib/data/bet-spec.ts).
--    No unique business IDs and no value rules: histories are versions, repeated rows are handled by the
--    app, and planned problem records must be loadable. The load command reports them.
-- ---------------------------------------------------------------------------
do $$
declare spec record; prefix text; name text;
begin
  for spec in select * from (values
    ('colleges', 'college_id text, college_name text, college_type text, cluster text, visited_on date, signed_on date, od_letter_on date, outreach_wave text, owner_id text'),
    ('contingents', 'contingent_id text, college_id text, head_person_id text, registered_at timestamptz'),
    ('contingent_tier_events', 'tier_event_id text, contingent_id text, milestone numeric, reached_at timestamptz, discounted_slots numeric'),
    ('squads', 'squad_id text, created_at timestamptz, leader_person_id text'),
    ('passes', 'pass_id text, registration_id text, person_id text, pass_type text, price_plan text, price_inr numeric, discount_type text, discount_inr numeric, booked_at timestamptz, booking_amount_inr numeric, locked_in_at timestamptz, lock_amount_inr numeric, id_verified_at timestamptz, hostel_name text, cancelled_at timestamptz, cancel_reason text, qr_voided_at timestamptz'),
    ('payments', 'payment_id text, pass_id text, kind text, amount_inr numeric, paid_at timestamptz'),
    ('perk_grants', 'grant_id text, pass_id text, perk text, granted_at timestamptz, collected_at timestamptz, cost_inr numeric'),
    ('insurance_claims', 'claim_id text, pass_id text, filed_at timestamptz, proof_type text, decision text, decided_at timestamptz, refund_inr numeric'),
    ('venues', 'venue_id text, venue_name text, venue_type text, capacity numeric, seated boolean, map_x numeric, map_y numeric, notes text'),
    ('program_events', 'event_id text, event_name text, brand_name text, cup text, scored boolean, points numeric, kind text, starts_at timestamptz, ends_at timestamptz, venue_id text, booking_required boolean, seats_offered numeric, audience text, sponsor text, notes text'),
    ('seat_booking_history', 'history_id text, booking_id text, event_id text, person_id text, pass_id text, effective_at timestamptz, status text'),
    ('seat_scans', 'scan_id text, event_id text, person_id text, occurred_at timestamptz, result text, deny_reason text'),
    ('waitlist_entries', 'entry_id text, kind text, event_id text, person_id text, joined_at timestamptz, left_at timestamptz'),
    ('exchange_offers', 'offer_id text, kind text, event_id text, entry_id text, source_booking_id text, source_pass_id text, offered_at timestamptz, expires_at timestamptz, claimed_at timestamptz, expired_at timestamptz, new_booking_id text, new_pass_id text'),
    ('competition_results', 'result_id text, event_id text, college_id text, team_name text, position numeric, points numeric, recorded_at timestamptz'),
    ('hackathon_teams', 'team_id text, team_name text, college_id text, registered_at timestamptz, status text'),
    ('hackathon_members', 'team_id text, person_id text'),
    ('bets', 'bet_id text, rank numeric, bet_name text, owner_team text, budget_inr numeric, planned_increment_base numeric, planned_increment_stretch numeric, simulation_note text'),
    ('bet_thresholds', 'threshold_id text, kpi_id text, bet_id text, check_on date, direction text, scale_at numeric, stop_at numeric, min_sample numeric, action_scale text, action_change text, action_stop text'),
    ('bet_milestones', 'milestone_id text, bet_id text, milestone text, due_on date, done_on date'),
    ('bet_spend', 'spend_id text, bet_id text, spent_on date, amount_inr numeric, item text')
  ) as s(tbl, columns) loop
    foreach prefix in array array['original_', ''] loop
      name := 'sim_' || prefix || spec.tbl;
      execute format('create table if not exists public.%I (_row_id bigint primary key, _source text not null default ''original'', _deleted boolean not null default false, %s)', name, spec.columns);
      execute format('create sequence if not exists public.%I owned by public.%I._row_id', name || '_row_seq', name);
      execute format('alter table public.%I alter column _row_id set default nextval(%L)', name, 'public.' || name || '_row_seq');
    end loop;
  end loop;

  -- the program for the original dataset: read only, filled by scripts/import_program.mjs
  foreach name in array array['venues', 'program_events'] loop
    execute format('create table if not exists public.%I (like public.%I including defaults including constraints including indexes)', name, 'sim_original_' || name);
    execute format('create sequence if not exists public.%I owned by public.%I._row_id', name || '_row_seq', name);
    execute format('alter table public.%I alter column _row_id set default nextval(%L)', name, 'public.' || name || '_row_seq');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Permissions. The same role rules as the original, on the sim_ tables.
--    Visitors who are not signed in get nothing. No app account reads the sim_original_ tables.
-- ---------------------------------------------------------------------------
create or replace function public.sim_can_edit_task(task_owner text) returns boolean
language sql stable security definer set search_path = public as
$$
  select public.is_member() and (
    task_owner is null
    or public.is_reviewer()
    or exists (
      select 1 from public.sim_team t join public.memberships m on m.team = t.team
      where t.owner_id = task_owner and m.user_id = auth.uid()
    )
  )
$$;
revoke all on function public.sim_can_edit_task(text) from public, anon;
grant execute on function public.sim_can_edit_task(text) to authenticated, service_role;

-- every sim_ table and sequence starts closed
do $$
declare r record;
begin
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'S')
             and (c.relname like 'sim\_%' or c.relname in ('venues', 'program_events', 'venues_row_seq', 'program_events_row_seq')) loop
    if r.relkind = 'r' then
      execute format('alter table public.%I enable row level security', r.relname);
      execute format('revoke all on public.%I from public, anon, authenticated', r.relname);
      execute format('grant all on public.%I to service_role', r.relname);
    else
      execute format('revoke all on sequence public.%I from public, anon, authenticated', r.relname);
      execute format('grant usage, select, update on sequence public.%I to service_role', r.relname);
    end if;
  end loop;
end $$;

do $$
declare t text; rule text;
begin
  -- editable tables, with the rule for who may write
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations',
    'campaign_plan','team','tasks','settings','change_log','bet_thresholds'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', 'sim_' || t);
    execute format('drop policy if exists member_read on public.%I', 'sim_' || t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', 'sim_' || t);
    execute format('drop policy if exists team_write on public.%I', 'sim_' || t);

    rule := case
      when t in ('campaigns','campaign_plan','daily_marketing','targets','settings','bet_thresholds') then '(select public.in_team(''publicity''))'
      when t = 'checkins' then '(select public.in_team(''events''))'
      when t in ('event','people','interactions','registrations','registration_history','sponsor_activations','team') then '(select public.is_reviewer())'
      else null
    end;
    if rule is not null then
      execute format('create policy team_write on public.%I for all to authenticated using (%s) with check (%s)', 'sim_' || t, rule, rule);
    end if;
  end loop;

  -- numbering for rows added in the app
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations','bet_thresholds'] loop
    execute format('grant usage, select on sequence public.%I to authenticated', 'sim_' || t || '_row_seq');
  end loop;
  grant usage, select on sequence public.sim_change_log_id_seq to authenticated;

  -- view only
  foreach t in array array['sim_tickets','sim_ticket_events','sim_sponsor_data',
    'sim_colleges','sim_contingents','sim_contingent_tier_events','sim_squads','sim_passes','sim_payments','sim_perk_grants',
    'sim_insurance_claims','sim_venues','sim_program_events','sim_seat_booking_history','sim_seat_scans','sim_waitlist_entries',
    'sim_exchange_offers','sim_competition_results','sim_hackathon_teams','sim_hackathon_members','sim_bets',
    'sim_bet_milestones','sim_bet_spend','venues','program_events'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

drop policy if exists team_write on public.sim_tasks;
create policy team_write on public.sim_tasks for all to authenticated
  using (public.sim_can_edit_task(owner_id)) with check (public.sim_can_edit_task(owner_id));

drop policy if exists member_log on public.sim_change_log;
create policy member_log on public.sim_change_log for insert to authenticated with check ((select public.is_member()));

-- ---------------------------------------------------------------------------
-- 4. Tickets (copies of the tickets and 3e files)
-- ---------------------------------------------------------------------------
create or replace function public._sim_ticket_owner_in_team(p_owner text, p_team text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sim_team t where t.owner_id = p_owner and t.team = p_team)
      or exists (select 1 from public.profiles p join public.memberships m on m.user_id = p.user_id where p.person_id = p_owner and m.team = p_team)
$$;

create or replace function public.sim_raise_ticket(p_title text, p_details text, p_from text, p_to text, p_priority text, p_needed_by date, p_assignee text, p_on date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_id uuid;
begin
  v_actor := public._ticket_actor();
  if not public.in_team(p_from) then
    raise exception 'Only the % team or the Reviewer can raise a ticket from it.', p_from using errcode = '42501';
  end if;
  if p_on is null then raise exception 'A date is needed.'; end if;
  if p_needed_by is not null and p_needed_by < p_on then raise exception 'The needed-by date is before the date the ticket is raised.'; end if;
  if p_from = p_to then raise exception 'Choose a different team to send the ticket to.'; end if;
  if p_assignee is not null and not public._sim_ticket_owner_in_team(p_assignee, p_to) then
    raise exception 'The person chosen is not in the % team.', p_to;
  end if;
  insert into public.sim_tickets (title, details, from_team, to_team, requester_id, assignee_id, priority, raised_on, needed_by)
  values (trim(p_title), coalesce(trim(p_details), ''), p_from, p_to,
          (select person_id from public.profiles where user_id = auth.uid()), p_assignee, coalesce(p_priority, 'medium'), p_on, p_needed_by)
  returning id into v_id;
  insert into public.sim_ticket_events (ticket_id, kind, actor_name, story_date) values (v_id, 'raised', v_actor, p_on);
  return v_id;
end $$;

create or replace function public.sim_move_ticket(p_id uuid, p_status text, p_note text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_ticket public.sim_tickets%rowtype; v_last date;
begin
  v_actor := public._ticket_actor();
  select * into v_ticket from public.sim_tickets where id = p_id for update;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if not public.in_team(v_ticket.to_team) then
    raise exception 'Only the % team or the Reviewer can do this.', v_ticket.to_team using errcode = '42501';
  end if;
  if not ((v_ticket.status = 'open' and p_status in ('accepted', 'declined'))
       or (v_ticket.status = 'accepted' and p_status = 'in_progress')
       or (v_ticket.status = 'in_progress' and p_status = 'done')) then
    raise exception 'A ticket that is % cannot become %.', v_ticket.status, p_status;
  end if;
  select max(story_date) into v_last from public.sim_ticket_events where ticket_id = p_id and kind <> 'comment';
  if p_on is null or p_on < v_last then
    raise exception 'This ticket already has activity on %. Choose that date or a later one.', v_last;
  end if;
  update public.sim_tickets set status = p_status where id = p_id;
  insert into public.sim_ticket_events (ticket_id, kind, body, actor_name, story_date)
  values (p_id, p_status, nullif(trim(coalesce(p_note, '')), ''), v_actor, p_on);
end $$;

create or replace function public.sim_comment_ticket(p_id uuid, p_body text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_raised date;
begin
  v_actor := public._ticket_actor();
  select raised_on into v_raised from public.sim_tickets where id = p_id;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'Write a comment first.'; end if;
  if p_on is null or p_on < v_raised then
    raise exception 'The ticket was raised on %. Choose that date or a later one.', v_raised;
  end if;
  insert into public.sim_ticket_events (ticket_id, kind, body, actor_name, story_date) values (p_id, 'comment', trim(p_body), v_actor, p_on);
end $$;

create or replace function public.sim_edit_ticket(p_id uuid, p_title text, p_details text, p_priority text, p_needed_by date, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_ticket public.sim_tickets%rowtype; v_last date;
begin
  v_actor := public._ticket_actor();
  select * into v_ticket from public.sim_tickets where id = p_id for update;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if not public.in_team(v_ticket.from_team) then
    raise exception 'Only the % team or the Reviewer can change this request.', v_ticket.from_team using errcode = '42501';
  end if;
  if v_ticket.status in ('declined', 'done') then raise exception 'A % ticket cannot be changed.', v_ticket.status; end if;
  select max(story_date) into v_last from public.sim_ticket_events where ticket_id = p_id and kind <> 'comment';
  if p_on is null or p_on < v_last then
    raise exception 'This ticket already has activity on %. Choose that date or a later one.', v_last;
  end if;
  if p_needed_by is not null and p_needed_by < v_ticket.raised_on then raise exception 'The needed-by date is before the date the ticket was raised.'; end if;
  update public.sim_tickets set title = trim(p_title), details = coalesce(trim(p_details), ''), priority = p_priority, needed_by = p_needed_by where id = p_id;
  insert into public.sim_ticket_events (ticket_id, kind, before, actor_name, story_date)
  values (p_id, 'edited', jsonb_build_object('title', v_ticket.title, 'details', v_ticket.details, 'priority', v_ticket.priority, 'needed_by', v_ticket.needed_by), v_actor, p_on);
end $$;

revoke all on function public._sim_ticket_owner_in_team(text, text) from public, anon, authenticated;
revoke all on function public.sim_raise_ticket(text, text, text, text, text, date, text, date), public.sim_move_ticket(uuid, text, text, date),
  public.sim_comment_ticket(uuid, text, date), public.sim_edit_ticket(uuid, text, text, text, date, date) from public, anon;
grant execute on function public.sim_raise_ticket(text, text, text, text, text, date, text, date), public.sim_move_ticket(uuid, text, text, date),
  public.sim_comment_ticket(uuid, text, date), public.sim_edit_ticket(uuid, text, text, text, date, date) to authenticated, service_role;

create or replace function public._sim_apply_tickets() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sim_tickets (id, title, details, from_team, to_team, requester_id, assignee_id, priority, status, raised_on, needed_by, simulation_note)
  select o.id, o.title, o.details, o.from_team, o.to_team, o.requester_id, o.assignee_id, o.priority,
         case when o.done_on is not null then 'done' when o.started_on is not null then 'in_progress'
              when o.declined_on is not null then 'declined' when o.accepted_on is not null then 'accepted' else 'open' end,
         o.raised_on, o.needed_by, o.simulation_note
  from public.sim_original_tickets o order by o.raised_on, o.ticket_key;

  -- one statement per step, so each ticket's history is numbered in order
  insert into public.sim_ticket_events (ticket_id, kind, actor_name, story_date)
  select o.id, 'raised', coalesce(r.owner_name, initcap(o.from_team) || ' team'), o.raised_on
  from public.sim_original_tickets o left join public.sim_original_team r on r.owner_id = o.requester_id order by o.raised_on, o.ticket_key;

  insert into public.sim_ticket_events (ticket_id, kind, body, actor_name, story_date)
  select o.id, s.kind, s.body, coalesce(a.owner_name, initcap(o.to_team) || ' team'), s.on_date
  from public.sim_original_tickets o
  left join public.sim_original_team a on a.owner_id = o.assignee_id
  cross join lateral (values (1, 'accepted', null::text, o.accepted_on), (2, 'declined', o.decline_reason, o.declined_on),
                             (3, 'in_progress', null, o.started_on), (4, 'done', null, o.done_on)) as s(step, kind, body, on_date)
  where s.on_date is not null
  order by o.ticket_key, s.step;
end $$;

create or replace function public._sim_seed_app_defaults() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.sim_tasks where true;
  delete from public.sim_ticket_events where true;
  delete from public.sim_tickets where true;
  delete from public.sim_change_log where true;
  delete from public.sim_settings where true;
  delete from public.sim_campaign_plan where true;
  delete from public.sim_team where true;
  insert into public.sim_team (owner_id, owner_name, team) select owner_id, owner_name, team from public.sim_original_team;
  insert into public.sim_campaign_plan (campaign_id, app_status, budget_inr, notes)
  select c.campaign_id, coalesce(p.app_status, 'active'), p.budget_inr, p.notes
  from (select distinct campaign_id from public.sim_original_campaigns) c
  left join public.sim_original_campaign_plan p on p.campaign_id = c.campaign_id;
  insert into public.sim_settings (key, value) select key, value from public.sim_original_settings;
  perform public._sim_apply_tickets();
end $$;
revoke all on function public._sim_apply_tickets(), public._sim_seed_app_defaults() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reset and load for the simulated dataset
-- ---------------------------------------------------------------------------
create or replace function public.sim_reset_demo() returns json
language plpgsql security definer set search_path = public as $$
declare t text; n bigint; counts json := '{}'::json;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_reviewer() then
    raise exception 'Only the Reviewer account can reset the demo data.' using errcode = '42501';
  end if;
  if (select loading from public.sim_data_load_state) then
    raise exception 'A data load did not finish. Run the load command again before resetting.';
  end if;
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations',
    'colleges','contingents','contingent_tier_events','squads','passes','payments','perk_grants','insurance_claims','venues',
    'program_events','seat_booking_history','seat_scans','waitlist_entries','exchange_offers','competition_results',
    'hackathon_teams','hackathon_members','bets','bet_thresholds','bet_milestones','bet_spend'] loop
    execute format('truncate table public.%I restart identity', 'sim_' || t);
    execute format('insert into public.%I select * from public.%I order by _row_id', 'sim_' || t, 'sim_original_' || t);
    execute format('select setval(%L, coalesce((select max(_row_id) from public.%I), 0) + 1, false)', 'public.sim_' || t || '_row_seq', 'sim_' || t);
    execute format('select count(*) from public.%I', 'sim_' || t) into n;
    counts := (counts::jsonb || jsonb_build_object(t, n))::json;
  end loop;
  perform public._sim_seed_app_defaults();
  return counts;
end $$;

create or replace function public.sim_prepare_data_load() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.sim_data_load_state set loading = true where only_row;
  truncate table public.sim_original_event, public.sim_original_targets, public.sim_original_campaigns, public.sim_original_daily_marketing,
    public.sim_original_people, public.sim_original_interactions, public.sim_original_registrations,
    public.sim_original_registration_history, public.sim_original_checkins, public.sim_original_sponsor_activations,
    public.sim_original_team, public.sim_original_settings, public.sim_original_campaign_plan, public.sim_original_tickets,
    public.sim_original_colleges, public.sim_original_contingents, public.sim_original_contingent_tier_events,
    public.sim_original_squads, public.sim_original_passes, public.sim_original_payments, public.sim_original_perk_grants,
    public.sim_original_insurance_claims, public.sim_original_venues, public.sim_original_program_events,
    public.sim_original_seat_booking_history, public.sim_original_seat_scans, public.sim_original_waitlist_entries,
    public.sim_original_exchange_offers, public.sim_original_competition_results, public.sim_original_hackathon_teams,
    public.sim_original_hackathon_members, public.sim_original_bets, public.sim_original_bet_thresholds,
    public.sim_original_bet_milestones, public.sim_original_bet_spend restart identity;
end $$;

create or replace function public.sim_finish_data_load(p_expected jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare t text; want bigint; got bigint;
begin
  for t, want in select key, value::bigint from jsonb_each_text(p_expected) loop
    if t !~ '^sim_original_[a-z_]+$' then raise exception 'Unexpected table %.', t; end if;
    execute format('select count(*) from public.%I', t) into got;
    if got <> want then raise exception 'Table % has % rows but % were expected. Nothing was switched.', t, got, want; end if;
  end loop;
  update public.sim_data_load_state set loading = false where only_row;
  return public.sim_reset_demo();
end $$;

revoke all on function public.sim_prepare_data_load(), public.sim_finish_data_load(jsonb) from public, anon, authenticated;
grant execute on function public.sim_prepare_data_load(), public.sim_finish_data_load(jsonb) to service_role;
revoke all on function public.sim_reset_demo() from public, anon;
grant execute on function public.sim_reset_demo() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Loading in pages. The versions are stored under the sim_ table names, so a change to one
--    dataset never makes a browser download the other one again.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['daily_marketing','people','interactions','registrations','registration_history','checkins',
    'passes','payments','perk_grants','seat_booking_history','seat_scans','waitlist_entries','exchange_offers'] loop
    insert into public.data_versions (table_name) values ('sim_' || t) on conflict do nothing;
    execute format('drop trigger if exists bump_version on public.%I', 'sim_' || t);
    execute format('create trigger bump_version after insert or update or delete or truncate on public.%I for each statement execute function public._bump_version()', 'sim_' || t);
  end loop;
end $$;

-- is there a simulated dataset to switch to?
create or replace function public.sim_dataset_status() returns boolean
language sql stable security definer set search_path = public as $$
  select (coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.is_member())
     and exists (select 1 from public.sim_event)
$$;

create or replace function public.sim_get_app_data() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'versions', (select json_object_agg(substr(table_name, 5), epoch || ':' || version) from public.data_versions where table_name like 'sim\_%'),
    'ranges', json_build_object(
      'daily_marketing',      (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_daily_marketing),
      'people',               (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_people),
      'interactions',         (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_interactions),
      'registrations',        (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_registrations),
      'registration_history', (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_registration_history),
      'checkins',             (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_checkins),
      'passes',               (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_passes),
      'payments',             (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_payments),
      'perk_grants',          (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_perk_grants),
      'seat_booking_history', (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_seat_booking_history),
      'seat_scans',           (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_seat_scans),
      'waitlist_entries',     (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_waitlist_entries),
      'exchange_offers',      (select json_build_array(coalesce(min(_row_id), 0), coalesce(max(_row_id), -1), count(*)) from public.sim_exchange_offers)
    ),
    'tables', json_build_object(
      'event',               (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_event x),
      'targets',             (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_targets x),
      'campaigns',           (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_campaigns x),
      'sponsor_activations', (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_sponsor_activations x),
      'campaign_plan',       (select coalesce(json_agg(x), '[]') from public.sim_campaign_plan x),
      'team',                (select coalesce(json_agg(x order by owner_id), '[]') from public.sim_team x),
      'tasks',               (select coalesce(json_agg(x order by created_at), '[]') from public.sim_tasks x),
      'settings',            (select coalesce(json_agg(x), '[]') from public.sim_settings x),
      'change_log',          (select coalesce(json_agg(x order by id), '[]') from (select * from public.sim_change_log order by id desc limit 200) x),
      'tickets',             (select coalesce(json_agg(x order by raised_on, created_at), '[]') from public.sim_tickets x),
      'ticket_events',       (select coalesce(json_agg(x order by id), '[]') from public.sim_ticket_events x)
    ),
    -- the small bet and program tables; the large ones are in "ranges"
    'bets', json_build_object(
      'colleges',               (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_colleges x),
      'contingents',            (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_contingents x),
      'contingent_tier_events', (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_contingent_tier_events x),
      'squads',                 (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_squads x),
      'insurance_claims',       (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_insurance_claims x),
      'venues',                 (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_venues x),
      'program_events',         (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_program_events x),
      'competition_results',    (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_competition_results x),
      'hackathon_teams',        (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_hackathon_teams x),
      'hackathon_members',      (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_hackathon_members x),
      'bets',                   (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_bets x),
      'bet_thresholds',         (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_bet_thresholds x),
      'bet_milestones',         (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_bet_milestones x),
      'bet_spend',              (select coalesce(json_agg(x order by _row_id), '[]') from public.sim_bet_spend x)
    )
  )
  where coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.is_member();
$$;

create or replace function public.sim_get_rows(p_table text, p_from bigint, p_to bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare v json; v_names json; v_list text;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_member() then
    raise exception 'Sign in as an organiser.' using errcode = '42501';
  end if;
  if p_to - p_from > 50000 then raise exception 'Ask for at most 50,000 rows at a time.'; end if;

  if p_table = 'daily_marketing' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','activity_id','campaign_id','owner_id','activity_date','impressions','clicks','reported_reach','landing_page_sessions','registration_starts','marketing_spend_inr','platform'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.activity_id,x.campaign_id,x.owner_id,x.activity_date,x.impressions,x.clicks,x.reported_reach,x.landing_page_sessions,x.registration_starts,x.marketing_spend_inr,x.platform) order by x._row_id), '[]'::json))
    into v from public.sim_daily_marketing x where x._row_id between p_from and p_to;
  elsif p_table = 'people' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','person_id','person_name','person_type','first_seen_at','first_touch_source','first_campaign_id','owner_id','college_id'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.person_id,x.person_name,x.person_type,x.first_seen_at,x.first_touch_source,x.first_campaign_id,x.owner_id,x.college_id) order by x._row_id), '[]'::json))
    into v from public.sim_people x where x._row_id between p_from and p_to;
  elsif p_table = 'interactions' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','interaction_id','person_id','campaign_id','owner_id','occurred_at','event_type','detail'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.interaction_id,x.person_id,x.campaign_id,x.owner_id,x.occurred_at,x.event_type,x.detail) order by x._row_id), '[]'::json))
    into v from public.sim_interactions x where x._row_id between p_from and p_to;
  elsif p_table = 'registrations' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','registration_id','person_id','campaign_id','owner_id','registered_at','route','squad_id','contingent_id','test_name','test_arm'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.registration_id,x.person_id,x.campaign_id,x.owner_id,x.registered_at,x.route,x.squad_id,x.contingent_id,x.test_name,x.test_arm) order by x._row_id), '[]'::json))
    into v from public.sim_registrations x where x._row_id between p_from and p_to;
  elsif p_table = 'registration_history' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','history_id','registration_id','person_id','campaign_id','owner_id','effective_at','status'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.history_id,x.registration_id,x.person_id,x.campaign_id,x.owner_id,x.effective_at,x.status) order by x._row_id), '[]'::json))
    into v from public.sim_registration_history x where x._row_id between p_from and p_to;
  elsif p_table = 'checkins' then
    select json_build_object('cols', json_build_array('_row_id','_source','_deleted','event_id','person_id','registration_id','campaign_id','owner_id','occurred_at','result','verification','source'),
      'rows', coalesce(json_agg(json_build_array(x._row_id,x._source,x._deleted,x.event_id,x.person_id,x.registration_id,x.campaign_id,x.owner_id,x.occurred_at,x.result,x.verification,x.source) order by x._row_id), '[]'::json))
    into v from public.sim_checkins x where x._row_id between p_from and p_to;
  elsif p_table = any (array['passes','payments','perk_grants','seat_booking_history','seat_scans','waitlist_entries','exchange_offers']) then
    -- these have no repeated names to leave out, so every column is sent
    select json_agg(a.attname order by a.attnum), string_agg(format('x.%I', a.attname), ',' order by a.attnum)
      into v_names, v_list
      from pg_attribute a where a.attrelid = to_regclass('public.sim_' || p_table) and a.attnum > 0 and not a.attisdropped;
    execute format('select json_build_object(''cols'', $3, ''rows'', coalesce(json_agg(json_build_array(%s) order by x._row_id), ''[]''::json)) from public.%I x where x._row_id between $1 and $2', v_list, 'sim_' || p_table)
      into v using p_from, p_to, v_names;
  else
    raise exception 'Unknown table %.', p_table;
  end if;
  return v;
end $$;

revoke all on function public.sim_dataset_status(), public.sim_get_app_data(), public.sim_get_rows(text, bigint, bigint) from public, anon;
grant execute on function public.sim_dataset_status(), public.sim_get_app_data(), public.sim_get_rows(text, bigint, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Chats remember which dataset they were about. Existing chats are about the original.
-- ---------------------------------------------------------------------------
alter table public.chat_sessions add column if not exists dataset text not null default 'original';
alter table public.chat_sessions drop constraint if exists chat_sessions_dataset_check;
alter table public.chat_sessions add constraint chat_sessions_dataset_check check (dataset in ('original', 'simulated'));

commit;

notify pgrst, 'reload schema';
