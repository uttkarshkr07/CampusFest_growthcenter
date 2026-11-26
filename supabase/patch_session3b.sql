-- Session 3, PART B: close the database to anyone who has not signed in.
-- Run ONLY after (1) part A, (2) the accounts exist, and (3) the live site shows the sign-in screen
-- and you have signed in on it. From then on, a site build without sign-in cannot read any data.
-- How to run: Supabase > SQL editor > paste the WHOLE file > Run.

begin;

do $$
begin
  if not exists (select 1 from public.profiles where is_reviewer) then
    raise exception 'No Reviewer account yet. Run: node scripts/setup_logins.mjs';
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['event','targets','campaigns','daily_marketing','people','interactions',
    'registrations','registration_history','checkins','sponsor_activations',
    'campaign_plan','team','tasks','settings','change_log'] loop
    execute format('drop policy if exists %I on public.%I', 'demo_rw_' || t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;
revoke execute on function public.get_dataset(), public.reset_demo() from public, anon;
grant execute on function public.get_dataset(), public.reset_demo() to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
