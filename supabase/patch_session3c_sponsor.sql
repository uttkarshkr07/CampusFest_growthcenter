-- Session 3, sponsor view: one table holding the sponsor records, one row per source sheet.
-- View only: signed-in organisers can read it, and nobody can change it from the app.
-- ADDITIVE: creates one new table and touches nothing else. Run after parts A and B.
-- How to run: Supabase > SQL editor > paste the WHOLE file > Run. Safe to run again.
-- Then load the records:  node scripts/import_sponsor.mjs

begin;

create table if not exists public.sponsor_data (
  sheet text primary key,
  rows jsonb not null,
  loaded_at timestamptz not null default now()
);
alter table public.sponsor_data enable row level security;
revoke all on public.sponsor_data from public, anon, authenticated;
grant select on public.sponsor_data to authenticated;
grant all on public.sponsor_data to service_role;
drop policy if exists member_read on public.sponsor_data;
create policy member_read on public.sponsor_data for select to authenticated using ((select public.is_member()));

commit;

notify pgrst, 'reload schema';
