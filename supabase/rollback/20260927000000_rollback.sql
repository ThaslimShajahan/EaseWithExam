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

-- Section 5: restore begin_ai_action / end_ai_action exactly as they were live
-- before 20260927000000 (pg_get_functiondef, 2026-09-25), and drop daily_test.
update public.ai_features set quota_buckets = array_remove(quota_buckets, 'daily_test')
 where 'daily_test' = any (quota_buckets);
alter table public.ai_features drop constraint ai_features_buckets_known;
alter table public.ai_features add constraint ai_features_buckets_known check (quota_buckets <@ array[
  'ai_questions','veda_messages','paper_evaluations','podcasts','paper_generations']::text[]);
CREATE OR REPLACE FUNCTION public.begin_ai_action(p_uid text, p_bucket text, p_amount integer DEFAULT 1, p_exam_type text DEFAULT NULL::text, p_subject text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_field text; v_limit integer; v_used integer; v_today date := public._ist_today(); v_id uuid;
  v_labels jsonb := '{"ai_questions":"AI questions","veda_messages":"EWE messages","paper_evaluations":"paper evaluations","podcasts":"podcasts","paper_generations":"full papers"}';
begin
  perform public.assert_verified_self(p_uid);
  if p_bucket is null or not (v_labels ? p_bucket) then
    raise exception 'Unknown quota bucket: %', coalesce(p_bucket, '(none)') using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  if p_exam_type is not null or p_subject is not null then
    perform public._assert_action_scope(p_uid, p_exam_type, p_subject);
  end if;

  -- Admins are exempt: an action is still recorded (so proxy calls tie back
  -- to it) but nothing is charged.
  if exists (select 1 from public.admins where uid = p_uid and is_active) then
    insert into public.ai_actions (user_id, bucket, amount, exam_type, subject, usage_date)
    values (p_uid, p_bucket, 0, p_exam_type, p_subject, v_today) returning id into v_id;
    return json_build_object('action_id', v_id, 'exempt', true);
  end if;

  v_field := p_bucket || '_used';
  v_limit := public._quota_limit(p_uid, p_bucket);

  insert into public.daily_usage_quota (user_id, usage_date) values (p_uid, v_today)
  on conflict (user_id, usage_date) do nothing;
  execute format('select coalesce(%I, 0) from public.daily_usage_quota where user_id = $1 and usage_date = $2 for update', v_field)
    into v_used using p_uid, v_today;

  if v_limit <> -1 and v_used + p_amount > v_limit then
    raise exception 'Daily limit reached for %: used % of %', v_labels->>p_bucket, v_used, v_limit
      using errcode = '54000', hint = json_build_object('used', v_used, 'limit', v_limit, 'bucket', p_bucket)::text;
  end if;

  execute format('update public.daily_usage_quota set %I = coalesce(%I, 0) + $1 where user_id = $2 and usage_date = $3', v_field, v_field)
    using p_amount, p_uid, v_today;

  insert into public.ai_actions (user_id, bucket, amount, exam_type, subject, usage_date)
  values (p_uid, p_bucket, p_amount, p_exam_type, p_subject, v_today) returning id into v_id;

  return json_build_object('action_id', v_id, 'exempt', false, 'used', v_used + p_amount, 'limit', v_limit);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.end_ai_action(p_uid text, p_action_id uuid, p_actual integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_a public.ai_actions; v_refund integer;
begin
  perform public.assert_verified_self(p_uid);
  select * into v_a from public.ai_actions where id = p_action_id and user_id = p_uid for update;
  if not found then raise exception 'Unknown action' using errcode = '22023'; end if;
  if v_a.ended_at is not null then return json_build_object('refunded', 0, 'already_ended', true); end if;

  v_refund := greatest(0, v_a.amount - greatest(0, coalesce(p_actual, 0)));
  if v_refund > 0 then
    execute format('update public.daily_usage_quota set %I = greatest(0, coalesce(%I, 0) - $1) where user_id = $2 and usage_date = $3',
                   v_a.bucket || '_used', v_a.bucket || '_used')
      using v_refund, p_uid, v_a.usage_date;
  end if;
  update public.ai_actions set ended_at = now() where id = p_action_id;
  return json_build_object('refunded', v_refund);
end;
$function$

;


commit;
