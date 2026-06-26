-- Rol-casing root fix: remaining saha/scan/visit-photo RLS policies compared profiles.role
-- to a STRICT uppercase literal ('ADMIN' / ANY['ADMIN','MANAGER']). With NAV writing UPPERCASE
-- and web/migrations writing lowercase, this was the casing-divergence root (lowercasing an
-- admin would lock them out of these tables). Fix: make every one case-insensitive via
-- upper(role) so casing NEVER matters again (drift-proof; no data change / app rebuild needed).
-- Web verified unaffected (web reads already case-insensitive). Applied to prod 2026-06-27.
-- Verified post-apply: both 'admin' and 'ADMIN' rows pass check_is_admin + scan/visit RLS.
-- (Data lowercase NOT applied — prevent_role_self_escalation trigger blocks service-role role
--  changes; unnecessary now that all reads are case-insensitive.)

drop policy if exists clinic_edit_logs_admin_select on public.saha_clinic_edit_logs;
create policy clinic_edit_logs_admin_select on public.saha_clinic_edit_logs for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = 'ADMIN'));

drop policy if exists clinic_scan_logs_admin_insert on public.saha_clinic_scan_logs;
create policy clinic_scan_logs_admin_insert on public.saha_clinic_scan_logs for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = 'ADMIN'));
drop policy if exists clinic_scan_logs_admin_select on public.saha_clinic_scan_logs;
create policy clinic_scan_logs_admin_select on public.saha_clinic_scan_logs for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = 'ADMIN'));

drop policy if exists scan_budget_config_admin_select on public.saha_scan_budget_config;
create policy scan_budget_config_admin_select on public.saha_scan_budget_config for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'));
drop policy if exists scan_budget_config_admin_update on public.saha_scan_budget_config;
create policy scan_budget_config_admin_update on public.saha_scan_budget_config for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'));

drop policy if exists saha_scan_job_items_admin_delete on public.saha_scan_job_items;
create policy saha_scan_job_items_admin_delete on public.saha_scan_job_items for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));
drop policy if exists saha_scan_job_items_admin_insert on public.saha_scan_job_items;
create policy saha_scan_job_items_admin_insert on public.saha_scan_job_items for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));
drop policy if exists saha_scan_job_items_admin_select on public.saha_scan_job_items;
create policy saha_scan_job_items_admin_select on public.saha_scan_job_items for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));
drop policy if exists saha_scan_job_items_admin_update on public.saha_scan_job_items;
create policy saha_scan_job_items_admin_update on public.saha_scan_job_items for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));

drop policy if exists saha_scan_jobs_admin_delete on public.saha_scan_jobs;
create policy saha_scan_jobs_admin_delete on public.saha_scan_jobs for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));
drop policy if exists saha_scan_jobs_admin_insert on public.saha_scan_jobs;
create policy saha_scan_jobs_admin_insert on public.saha_scan_jobs for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));
drop policy if exists saha_scan_jobs_admin_select on public.saha_scan_jobs;
create policy saha_scan_jobs_admin_select on public.saha_scan_jobs for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));
drop policy if exists saha_scan_jobs_admin_update on public.saha_scan_jobs;
create policy saha_scan_jobs_admin_update on public.saha_scan_jobs for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = any (array['ADMIN','MANAGER'])));

drop policy if exists saha_visit_photos_admin_delete on public.saha_visit_photos;
create policy saha_visit_photos_admin_delete on public.saha_visit_photos for delete
  using (exists (select 1 from saha_visits v where v.id = saha_visit_photos.visit_id and (v.rep_id = auth.uid() or exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = any (array['ADMIN','MANAGER'])))));
drop policy if exists saha_visit_photos_parent_insert on public.saha_visit_photos;
create policy saha_visit_photos_parent_insert on public.saha_visit_photos for insert
  with check (exists (select 1 from saha_visits v where v.id = saha_visit_photos.visit_id and (v.rep_id = auth.uid() or exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = any (array['ADMIN','MANAGER'])))));
drop policy if exists saha_visit_photos_parent_select on public.saha_visit_photos;
create policy saha_visit_photos_parent_select on public.saha_visit_photos for select
  using (exists (select 1 from saha_visits v where v.id = saha_visit_photos.visit_id and (v.rep_id = auth.uid() or exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = any (array['ADMIN','MANAGER'])))));
drop policy if exists saha_visit_photos_parent_update on public.saha_visit_photos;
create policy saha_visit_photos_parent_update on public.saha_visit_photos for update
  using (exists (select 1 from saha_visits v where v.id = saha_visit_photos.visit_id and (v.rep_id = auth.uid() or exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = any (array['ADMIN','MANAGER'])))));

drop policy if exists visit_photos_owner_delete on storage.objects;
create policy visit_photos_owner_delete on storage.objects for delete
  using (bucket_id = 'visit-photos' and exists (select 1 from saha_visits v where (v.id)::text = split_part(objects.name, '/', 1) and (v.rep_id = auth.uid() or exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = 'ADMIN'))));
drop policy if exists visit_photos_owner_select on storage.objects;
create policy visit_photos_owner_select on storage.objects for select
  using (bucket_id = 'visit-photos' and exists (select 1 from saha_visits v where (v.id)::text = split_part(objects.name, '/', 1) and (v.rep_id = auth.uid() or exists (select 1 from profiles where profiles.id = auth.uid() and upper(profiles.role) = any (array['ADMIN','MANAGER'])))));
