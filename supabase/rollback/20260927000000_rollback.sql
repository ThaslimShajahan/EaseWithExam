-- Rollback for 20260927000000_online_now_registrations_dmt_autosave.sql
-- Restores save_daily_challenge_attempt (void, no server-side XP) and removes
-- the heartbeat, registration events and admin feed. The client that ships
-- with the migration tolerates both return shapes, but roll the web bundle
-- back too (it would otherwise call RPCs that no longer exist; those calls
-- fail quietly — heartbeat and admin panels only).
begin;

drop trigger if exists users_registration_insert    on public.users;
drop trigger if exists users_registration_onboarded on public.users;
drop function if exists public._trg_users_registration();
drop function if exists public._email_admin_new_registration(text);
drop function if exists public.admin_get_online_students(text, integer);
drop function if exists public.admin_get_recent_registrations(text, integer);
drop function if exists public.admin_mark_registrations_seen(text);
drop function if exists public.touch_last_seen(text);
drop table if exists public.admin_feed_seen;
drop table if exists public.registration_events;
drop index if exists public.users_last_seen_at_idx;
alter table public.users drop constraint if exists users_last_seen_platform_check;
alter table public.users drop column if exists last_seen_platform;
alter table public.users drop column if exists last_seen_at;

drop function if exists public.save_daily_challenge_attempt(text, uuid, text, boolean);
create function public.save_daily_challenge_attempt(p_uid text, p_challenge_id uuid, p_selected text, p_is_correct boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.assert_verified_self(p_uid);
  if not exists (select 1 from public.daily_challenges where id = p_challenge_id and user_id = p_uid) then
    raise exception 'Unknown challenge' using errcode = '22023';
  end if;
  insert into public.daily_challenge_attempts (challenge_id, user_id, selected_option, is_correct)
  values (p_challenge_id, p_uid, left(p_selected, 5000), p_is_correct)
  on conflict (challenge_id, user_id)
  do update set selected_option = excluded.selected_option, is_correct = excluded.is_correct;
end;
$function$;
revoke all on function public.save_daily_challenge_attempt(text, uuid, text, boolean) from public;
grant execute on function public.save_daily_challenge_attempt(text, uuid, text, boolean) to anon, authenticated;

commit;
