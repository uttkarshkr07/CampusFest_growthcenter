-- Patch (26 Nov): DELETE needs WHERE (Supabase safeupdate) + typed null budget. Re-creates _seed_app_defaults only.
-- ---------------------------------------------------------------------------
-- 3. Seed app defaults (also restored by reset_demo)
-- ---------------------------------------------------------------------------
create or replace function public._seed_app_defaults() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.tasks where true;
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
end $$;
