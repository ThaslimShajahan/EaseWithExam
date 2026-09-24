-- Rollback for 20260924000000_lock_notifications_pricing_parent_links.sql
--
-- ORDER: restore the previous frontend bundle FIRST, then run this. The old
-- bundle reads/writes these tables directly and needs the open access back.
-- This deliberately re-opens the leak documented in that migration's header:
-- use it only to recover from an outage, then re-apply a fixed lockdown.
--
-- The new RPCs are left in place (harmless, and the old bundle ignores them).

create policy "allow all" on public.user_notifications for all using (true) with check (true);
grant all on public.user_notifications to anon, authenticated;
alter publication supabase_realtime add table public.user_notifications;

create policy notif_prefs_open on public.notification_prefs for all using (true) with check (true);
grant all on public.notification_prefs to anon, authenticated;

drop policy if exists exam_notifications_read_active on public.exam_notifications;
create policy exam_notifications_open on public.exam_notifications for all using (true) with check (true);
grant all on public.exam_notifications to anon, authenticated;

create policy "Public upsert plan_config" on public.plan_config for all using (true) with check (true);
grant all on public.plan_config to anon, authenticated;

create policy psl_all_open on public.parent_student_links for all using (true) with check (true);
grant all on public.parent_student_links to anon, authenticated;
