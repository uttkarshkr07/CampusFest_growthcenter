-- Session 3, team tickets. ADDITIVE: new tables, two new task columns, and one seeded ticket.
-- It does not reset or change any existing data. Run after parts A and B.
-- How to run: Supabase > SQL editor > paste the WHOLE file > Run. Safe to run again.
-- If you ever run part A again, run this file again afterwards (part A replaces the data load).
--
-- The seeded ticket is a SIMULATED SCENARIO: RISA Labs has not agreed to this.
--
-- Everyone signed in can read tickets and comment. All changes go through the functions below,
-- which check the team, the allowed status steps and the date order. No account can write the
-- ticket tables directly.

begin;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  details text not null default '' check (char_length(details) <= 4000),
  from_team text not null check (from_team in ('publicity', 'sponsorship', 'events')),
  to_team text not null check (to_team in ('publicity', 'sponsorship', 'events')),
  requester_id text,
  assignee_id text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'in_progress', 'done')),
  raised_on date not null,          -- date in the story (2025), not the real clock
  needed_by date,
  simulation_note text,             -- set only on made-up scenarios; shown wherever the ticket appears
  created_at timestamptz not null default now(),
  check (from_team <> to_team),
  check (needed_by is null or needed_by >= raised_on)
);

-- The history of each ticket: the status at a past date is read from here.
create table if not exists public.ticket_events (
  id bigserial primary key,
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  kind text not null check (kind in ('raised', 'comment', 'accepted', 'declined', 'in_progress', 'done', 'edited')),
  body text check (char_length(body) <= 2000),
  before jsonb,                     -- for 'edited': the request as it was, so earlier dates still show it
  actor_name text not null,
  story_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_events_ticket on public.ticket_events (ticket_id, id);

alter table public.tasks add column if not exists ticket_id uuid references public.tickets (id) on delete set null;
alter table public.tasks add column if not exists story_date date;

alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
revoke all on public.tickets, public.ticket_events from public, anon, authenticated;
grant select on public.tickets, public.ticket_events to authenticated;
grant all on public.tickets, public.ticket_events to service_role;
revoke all on sequence public.ticket_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.ticket_events_id_seq to service_role;
drop policy if exists member_read on public.tickets;
create policy member_read on public.tickets for select to authenticated using ((select public.is_member()));
drop policy if exists member_read on public.ticket_events;
create policy member_read on public.ticket_events for select to authenticated using ((select public.is_member()));

-- ---------------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------------
create or replace function public._ticket_actor() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_name text;
begin
  select display_name into v_name from public.profiles where user_id = auth.uid();
  if v_name is null then
    raise exception 'Sign in as an organiser to do this.' using errcode = '42501';
  end if;
  return v_name;
end $$;

create or replace function public._ticket_owner_in_team(p_owner text, p_team text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team t where t.owner_id = p_owner and t.team = p_team)
      or exists (select 1 from public.profiles p join public.memberships m on m.user_id = p.user_id where p.person_id = p_owner and m.team = p_team)
$$;

create or replace function public.raise_ticket(p_title text, p_details text, p_from text, p_to text, p_priority text, p_needed_by date, p_assignee text, p_on date) returns uuid
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
  if p_assignee is not null and not public._ticket_owner_in_team(p_assignee, p_to) then
    raise exception 'The person chosen is not in the % team.', p_to;
  end if;
  insert into public.tickets (title, details, from_team, to_team, requester_id, assignee_id, priority, raised_on, needed_by)
  values (trim(p_title), coalesce(trim(p_details), ''), p_from, p_to,
          (select person_id from public.profiles where user_id = auth.uid()), p_assignee, coalesce(p_priority, 'medium'), p_on, p_needed_by)
  returning id into v_id;
  insert into public.ticket_events (ticket_id, kind, actor_name, story_date) values (v_id, 'raised', v_actor, p_on);
  return v_id;
end $$;

-- open -> accepted or declined (reason optional); accepted -> in_progress -> done. Receiving team or Reviewer.
create or replace function public.move_ticket(p_id uuid, p_status text, p_note text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_ticket public.tickets%rowtype; v_last date;
begin
  v_actor := public._ticket_actor();
  select * into v_ticket from public.tickets where id = p_id for update;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if not public.in_team(v_ticket.to_team) then
    raise exception 'Only the % team or the Reviewer can do this.', v_ticket.to_team using errcode = '42501';
  end if;
  if not ((v_ticket.status = 'open' and p_status in ('accepted', 'declined'))
       or (v_ticket.status = 'accepted' and p_status = 'in_progress')
       or (v_ticket.status = 'in_progress' and p_status = 'done')) then
    raise exception 'A ticket that is % cannot become %.', v_ticket.status, p_status;
  end if;
  select max(story_date) into v_last from public.ticket_events where ticket_id = p_id and kind <> 'comment';
  if p_on is null or p_on < v_last then
    raise exception 'This ticket already has activity on %. Choose that date or a later one.', v_last;
  end if;
  update public.tickets set status = p_status where id = p_id;
  insert into public.ticket_events (ticket_id, kind, body, actor_name, story_date)
  values (p_id, p_status, nullif(trim(coalesce(p_note, '')), ''), v_actor, p_on);
end $$;

-- any organiser
create or replace function public.comment_ticket(p_id uuid, p_body text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_raised date;
begin
  v_actor := public._ticket_actor();
  select raised_on into v_raised from public.tickets where id = p_id;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'Write a comment first.'; end if;
  if p_on is null or p_on < v_raised then
    raise exception 'The ticket was raised on %. Choose that date or a later one.', v_raised;
  end if;
  insert into public.ticket_events (ticket_id, kind, body, actor_name, story_date) values (p_id, 'comment', trim(p_body), v_actor, p_on);
end $$;

-- the sending team changes its own request, while it is not finished
create or replace function public.edit_ticket(p_id uuid, p_title text, p_details text, p_priority text, p_needed_by date, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_ticket public.tickets%rowtype; v_last date;
begin
  v_actor := public._ticket_actor();
  select * into v_ticket from public.tickets where id = p_id for update;
  if not found then raise exception 'That ticket no longer exists.'; end if;
  if not public.in_team(v_ticket.from_team) then
    raise exception 'Only the % team or the Reviewer can change this request.', v_ticket.from_team using errcode = '42501';
  end if;
  if v_ticket.status in ('declined', 'done') then raise exception 'A % ticket cannot be changed.', v_ticket.status; end if;
  select max(story_date) into v_last from public.ticket_events where ticket_id = p_id and kind <> 'comment';
  if p_on is null or p_on < v_last then
    raise exception 'This ticket already has activity on %. Choose that date or a later one.', v_last;
  end if;
  if p_needed_by is not null and p_needed_by < v_ticket.raised_on then raise exception 'The needed-by date is before the date the ticket was raised.'; end if;
  update public.tickets set title = trim(p_title), details = coalesce(trim(p_details), ''), priority = p_priority, needed_by = p_needed_by where id = p_id;
  insert into public.ticket_events (ticket_id, kind, before, actor_name, story_date)
  values (p_id, 'edited', jsonb_build_object('title', v_ticket.title, 'details', v_ticket.details, 'priority', v_ticket.priority, 'needed_by', v_ticket.needed_by), v_actor, p_on);
end $$;

revoke all on function public._ticket_actor(), public._ticket_owner_in_team(text, text) from public, anon, authenticated;
revoke all on function public.raise_ticket(text, text, text, text, text, date, text, date), public.move_ticket(uuid, text, text, date),
  public.comment_ticket(uuid, text, date), public.edit_ticket(uuid, text, text, text, date, date) from public, anon;
grant execute on function public.raise_ticket(text, text, text, text, text, date, text, date), public.move_ticket(uuid, text, text, date),
  public.comment_ticket(uuid, text, date), public.edit_ticket(uuid, text, text, text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The seeded ticket. SIMULATED SCENARIO: RISA Labs has not agreed to this.
-- ---------------------------------------------------------------------------
create or replace function public._seed_tickets() returns void
language plpgsql security definer set search_path = public as $seed$
declare v_id constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from public.tickets where id = v_id) then return; end if;
  insert into public.tickets (id, title, details, from_team, to_team, requester_id, assignee_id, priority, status, raised_on, needed_by, simulation_note)
  values (v_id,
    'RISA Labs on board for an AI x Health Hackathon: publicity needed',
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
    'sponsorship', 'publicity', 'T01', 'T03', 'high', 'open', date '2025-03-15', date '2025-03-22',
    'SIMULATED SCENARIO: RISA Labs has not agreed to this.');
  insert into public.ticket_events (ticket_id, kind, actor_name, story_date) values (v_id, 'raised', 'Riya Kapoor', date '2025-03-15');
end $seed$;
revoke all on function public._seed_tickets() from public, anon, authenticated;

-- Reset also restores the tickets. Same as before, with the ticket lines added.
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
  select distinct campaign_id, 'active', null::numeric from public.original_campaigns;
  insert into public.settings (key, value) values
    ('showup_low', '0.65'), ('showup_mid', '0.75'), ('showup_high', '0.85'), ('walkin_assumption', '100'),
    ('scale_cost_ratio', '0.8'), ('stop_cost_ratio', '1.5'), ('scale_min_showup', '0.75'),
    ('stop_max_showup', '0.55'), ('min_sample', '30');
  perform public._seed_tickets();
end $$;

-- add the seeded ticket now, without resetting anything
select public._seed_tickets();

-- the data load now includes the tickets
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
    'change_log',           (select coalesce(json_agg(x order by id), '[]') from (select * from public.change_log order by id desc limit 200) x),
    'tickets',              (select coalesce(json_agg(x order by raised_on, created_at), '[]') from public.tickets x),
    'ticket_events',        (select coalesce(json_agg(x order by id), '[]') from public.ticket_events x)
  )
  where coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.is_member();
$$;

commit;

notify pgrst, 'reload schema';
