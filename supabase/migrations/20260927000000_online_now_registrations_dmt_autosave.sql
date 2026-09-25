-- Students Online Now + new-registration notifications + Daily Mini Test
-- attempt rewards server-side (2026-09-25, queue items 2 and 4).
--
-- Auth model reminder (see 20260926020000): every request runs as `anon`, so
-- no grant/role is a gate. Every function below decides who the caller is from
-- verified_uid() (the Firebase token's sub) in its own body. EXECUTE is revoked
-- from PUBLIC and granted to anon only because anon is the role every real
-- request (student and admin alike) arrives as.

-- ═══ 1. Heartbeat ═══════════════════════════════════════════════════════════
alter table public.users
  add column if not exists last_seen_at       timestamptz,
  add column if not exists last_seen_platform text;

do $$ begin
  alter table public.users add constraint users_last_seen_platform_check
    check (last_seen_platform is null or last_seen_platform in ('web', 'android'));
exception when duplicate_object then null; end $$;

create index if not exists users_last_seen_at_idx on public.users (last_seen_at desc) where last_seen_at is not null;

-- Own row only: there is no uid parameter, so there is nothing to point at
-- someone else. Writes at most every 20s per student however often it is
-- called (a second open tab must not double the write rate).
create or replace function public.touch_last_seen(p_platform text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare v_uid text := public.verified_uid();
begin
  if v_uid is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;
  if p_platform is null or p_platform not in ('web', 'android') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;
  update public.users
     set last_seen_at = now(), last_seen_platform = p_platform
   where firebase_uid = v_uid
     and (last_seen_at is null
          or last_seen_at < now() - interval '20 seconds'
          or last_seen_platform is distinct from p_platform);
end;
$$;

revoke all on function public.touch_last_seen(text) from public;
grant execute on function public.touch_last_seen(text) to anon;

-- ═══ 2. Registration events ═════════════════════════════════════════════════
-- One row per student. Recorded at signup ("onboarding pending"); the admin
-- toast, bell and email fire once, when onboarding completes. ON DELETE CASCADE
-- so a deleted account (including QA throwaways) leaves nothing behind.
create table if not exists public.registration_events (
  user_id          text primary key references public.users (firebase_uid) on delete cascade,
  registered_at    timestamptz not null default now(),
  onboarded_at     timestamptz,
  -- rows created by this migration for accounts that already existed: they
  -- show in the list but never count as "new" on the bell.
  backfilled       boolean not null default false,
  email_request_id bigint,          -- pg_net request id of the admin email
  email_error      text
);
create index if not exists registration_events_onboarded_idx on public.registration_events (onboarded_at desc);
create index if not exists registration_events_registered_idx on public.registration_events (registered_at desc);

alter table public.registration_events enable row level security;   -- no policies: RPC-only
revoke all on public.registration_events from anon, authenticated;

-- Per-admin "bell read up to" marker.
create table if not exists public.admin_feed_seen (
  admin_uid             text primary key,
  registrations_seen_at timestamptz not null default now()
);
alter table public.admin_feed_seen enable row level security;       -- no policies: RPC-only
revoke all on public.admin_feed_seen from anon, authenticated;

insert into public.registration_events (user_id, registered_at, onboarded_at, backfilled)
select u.firebase_uid, coalesce(u.created_at, now()),
       case when u.onboarding_completed then coalesce(u.created_at, now()) end, true
  from public.users u
on conflict (user_id) do nothing;

-- Queues the admin email (async via pg_net, so it can never slow or fail the
-- signup transaction; send-email accepts this template from internal callers
-- only and always sends it to the fixed admin address).
create or replace function public._email_admin_new_registration(p_uid text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_url text; v_key text; v_internal text; v_req bigint;
  u public.users%rowtype;
begin
  select decrypted_secret into v_url      from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key      from vault.decrypted_secrets where name = 'anon_key';
  select decrypted_secret into v_internal from vault.decrypted_secrets where name = 'internal_call_secret';
  if v_url is null or v_key is null or v_internal is null then
    update public.registration_events set email_error = 'vault secrets missing' where user_id = p_uid;
    return;
  end if;
  select * into u from public.users where firebase_uid = p_uid;

  select net.http_post(
    url     := v_url || '/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key,
                                  'x-internal-secret', v_internal),
    body    := jsonb_build_object(
      'admin_alert', true,
      'template',    'admin_new_registration',
      'data', jsonb_build_object(
        'name',         coalesce(nullif(trim(u.display_name), ''), '(no name yet)'),
        'classLevel',   u.class_level,
        'board',        u.syllabus,
        'targetExam',   u.target_exam,
        'authMethod',   u.auth_method,
        'registeredAt', to_char((coalesce(u.created_at, now()) at time zone 'Asia/Kolkata'), 'DD Mon YYYY, HH12:MI AM') || ' IST'
      )
    )
  ) into v_req;
  update public.registration_events set email_request_id = v_req, email_error = null where user_id = p_uid;
end;
$$;
revoke all on function public._email_admin_new_registration(text) from public, anon, authenticated;

-- Triggers. Everything is inside an exception block: a failure here is logged
-- as a warning and swallowed, so signup and onboarding always succeed.
create or replace function public._trg_users_registration()
returns trigger
language plpgsql volatile security definer
set search_path = public
as $$
declare v_newly_onboarded boolean := false;
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.registration_events (user_id, registered_at, onboarded_at)
      values (new.firebase_uid, coalesce(new.created_at, now()),
              case when new.onboarding_completed then now() end)
      on conflict (user_id) do nothing;
      v_newly_onboarded := coalesce(new.onboarding_completed, false) and found;
    else
      -- onboarding_completed just became true (the trigger's WHEN guarantees it)
      insert into public.registration_events (user_id, registered_at, onboarded_at)
      values (new.firebase_uid, coalesce(new.created_at, now()), now())
      on conflict (user_id) do update set onboarded_at = now()
        where public.registration_events.onboarded_at is null;
      v_newly_onboarded := found;   -- false if it was already onboarded once: notify only once
    end if;

    if v_newly_onboarded then
      perform public._email_admin_new_registration(new.firebase_uid);
    end if;
  exception when others then
    raise warning 'registration notification failed for %: % (%)', new.firebase_uid, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke all on function public._trg_users_registration() from public, anon, authenticated;

drop trigger if exists users_registration_insert on public.users;
create trigger users_registration_insert
  after insert on public.users
  for each row execute function public._trg_users_registration();

drop trigger if exists users_registration_onboarded on public.users;
create trigger users_registration_onboarded
  after update of onboarding_completed on public.users
  for each row
  when (new.onboarding_completed is true and old.onboarding_completed is distinct from true)
  execute function public._trg_users_registration();

-- ═══ 3. Admin feed RPCs (polled every 30s by the admin panel) ═══════════════
create or replace function public.admin_get_online_students(p_caller text, p_window_minutes integer default 2)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_window int := least(greatest(coalesce(p_window_minutes, 2), 1), 60);
  v_today  timestamptz := date_trunc('day',  now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_week   timestamptz := date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';  -- Monday
begin
  perform public.assert_verified_admin(p_caller);
  return (
    with students as (
      select u.* from public.users u
       where u.last_seen_at is not null
         and not exists (select 1 from public.admins a where a.uid = u.firebase_uid and a.is_active)
    )
    select json_build_object(
      'server_now',     now(),
      'window_minutes', v_window,
      'online_count',   (select count(*) from students where last_seen_at >= now() - make_interval(mins => v_window)),
      'active_today',   (select count(*) from students where last_seen_at >= v_today),
      'active_week',    (select count(*) from students where last_seen_at >= v_week),
      'online', coalesce((
        select json_agg(json_build_object(
                 'uid', s.firebase_uid, 'name', s.display_name, 'class_level', s.class_level,
                 'board', s.syllabus, 'target_exam', s.target_exam,
                 'last_seen_at', s.last_seen_at, 'platform', s.last_seen_platform)
               order by s.last_seen_at desc)
          from (select * from students
                 where last_seen_at >= now() - make_interval(mins => v_window)
                 order by last_seen_at desc limit 200) s), '[]'::json)
    )
  );
end;
$$;

create or replace function public.admin_get_recent_registrations(p_caller text, p_limit integer default 20)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare v_seen timestamptz;
begin
  perform public.assert_verified_admin(p_caller);
  select registrations_seen_at into v_seen from public.admin_feed_seen where admin_uid = p_caller;
  return json_build_object(
    'server_now', now(),
    'seen_at',    v_seen,
    'unseen_count', (select count(*) from public.registration_events e
                      where not e.backfilled and e.onboarded_at is not null
                        and e.onboarded_at > coalesce(v_seen, '-infinity'::timestamptz)),
    'items', coalesce((
      select json_agg(x order by x.registered_at desc) from (
        select e.user_id as uid, u.display_name as name, u.class_level, u.syllabus as board,
               u.target_exam, u.auth_method, e.registered_at, e.onboarded_at, e.backfilled,
               case when e.onboarded_at is null then 'onboarding_pending' else 'onboarded' end as status
          from public.registration_events e join public.users u on u.firebase_uid = e.user_id
         order by e.registered_at desc
         limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::json)
  );
end;
$$;

create or replace function public.admin_mark_registrations_seen(p_caller text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform public.assert_verified_admin(p_caller);
  insert into public.admin_feed_seen (admin_uid, registrations_seen_at) values (p_caller, now())
  on conflict (admin_uid) do update set registrations_seen_at = now();
end;
$$;

revoke all on function public.admin_get_online_students(text, integer)     from public;
revoke all on function public.admin_get_recent_registrations(text, integer) from public;
revoke all on function public.admin_mark_registrations_seen(text)            from public;
grant execute on function public.admin_get_online_students(text, integer)     to anon;
grant execute on function public.admin_get_recent_registrations(text, integer) to anon;
grant execute on function public.admin_mark_registrations_seen(text)            to anon;

-- ═══ 4. Daily Mini Test: reward only a confirmed, first save ════════════════
-- The attempt is now saved automatically when the last question is answered.
-- XP/streak move into the same transaction as the save, so they happen only
-- if the attempt is stored, and only on its FIRST save (a retry or re-save of
-- the same attempt never pays twice — the old client awarded on every save).
drop function if exists public.save_daily_challenge_attempt(text, uuid, text, boolean);
create function public.save_daily_challenge_attempt(p_uid text, p_challenge_id uuid, p_selected text, p_is_correct boolean)
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare v_first boolean; v_xp int := 0; v_gam json;
begin
  perform public.assert_verified_self(p_uid);
  if not exists (select 1 from public.daily_challenges where id = p_challenge_id and user_id = p_uid) then
    raise exception 'Unknown challenge' using errcode = '22023';
  end if;
  insert into public.daily_challenge_attempts (challenge_id, user_id, selected_option, is_correct)
  values (p_challenge_id, p_uid, left(p_selected, 5000), p_is_correct)
  on conflict (challenge_id, user_id)
  do update set selected_option = excluded.selected_option, is_correct = excluded.is_correct
  returning (xmax = 0) into v_first;

  if v_first then
    v_gam := public.award_xp_atomic(p_uid, 20);   -- XP_REWARDS.daily_challenge; also advances the streak
    v_xp := 20;
  end if;
  -- gamification: the updated user_gamification row (null on a re-save), so
  -- the client can announce streak / level milestones as awardXP() does.
  return json_build_object('saved', true, 'first_save', v_first, 'xp_awarded', v_xp, 'gamification', v_gam);
end;
$$;
revoke all on function public.save_daily_challenge_attempt(text, uuid, text, boolean) from public;
grant execute on function public.save_daily_challenge_attempt(text, uuid, text, boolean) to anon;

-- ═══ 5. Daily Mini Test no longer counts against AI questions ═══════════════
-- Owner decision 2026-09-25: one free Daily Mini Test per student per day, for
-- free and premium alike; it must not use the ai_questions allowance (a free
-- student who did one 20-question Practice set lost that day's test).
--
-- New action bucket 'daily_test'. It charges nothing to daily_usage_quota.
-- Instead:
--   - refused once today's Daily Mini Test exists (the one-per-day rule that
--     save_daily_challenge / pick_daily_challenge_subject already enforce);
--   - at most 3 daily_test actions per student per IST day, so a failing
--     generation can be retried but the free bucket can't be farmed for AI
--     calls (each action also allows only 10 proxy calls, not the usual 200).
-- 'ai_questions' stays accepted for daily-challenge until every open page has
-- the new bundle (the old bundle still charges ai_questions for it).
create or replace function public.begin_ai_action(
  p_uid text, p_bucket text, p_amount integer default 1,
  p_exam_type text default null, p_subject text default null
) returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_field text; v_limit integer; v_used integer; v_today date := public._ist_today(); v_id uuid;
  v_labels jsonb := '{"ai_questions":"AI questions","veda_messages":"EWE messages","paper_evaluations":"paper evaluations","podcasts":"podcasts","paper_generations":"full papers","daily_test":"Daily Mini Test"}';
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

  if p_bucket = 'daily_test' then
    if exists (select 1 from public.daily_challenges
                where user_id = p_uid and challenge_date = v_today) then
      raise exception 'Today''s Daily Mini Test already exists' using errcode = '54000',
        hint = json_build_object('bucket', 'daily_test', 'reason', 'done_today')::text;
    end if;
    -- Serialise per student so two tabs can't both pass the count below.
    perform pg_advisory_xact_lock(hashtext('daily_test:' || p_uid));
    if (select count(*) from public.ai_actions
         where user_id = p_uid and bucket = 'daily_test' and usage_date = v_today) >= 3 then
      raise exception 'Daily Mini Test could not be generated today — please try again tomorrow' using errcode = '54000',
        hint = json_build_object('bucket', 'daily_test', 'reason', 'retries_used')::text;
    end if;
    insert into public.ai_actions (user_id, bucket, amount, exam_type, subject, usage_date, max_calls)
    values (p_uid, 'daily_test', 1, p_exam_type, p_subject, v_today, 10) returning id into v_id;
    return json_build_object('action_id', v_id, 'exempt', false, 'free', true);
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
$$;

create or replace function public.end_ai_action(p_uid text, p_action_id uuid, p_actual integer)
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare v_a public.ai_actions; v_refund integer;
begin
  perform public.assert_verified_self(p_uid);
  select * into v_a from public.ai_actions where id = p_action_id and user_id = p_uid for update;
  if not found then raise exception 'Unknown action' using errcode = '22023'; end if;
  if v_a.ended_at is not null then return json_build_object('refunded', 0, 'already_ended', true); end if;

  v_refund := greatest(0, v_a.amount - greatest(0, coalesce(p_actual, 0)));
  -- daily_test charges nothing to daily_usage_quota, so there is nothing to refund.
  if v_refund > 0 and v_a.bucket <> 'daily_test' then
    execute format('update public.daily_usage_quota set %I = greatest(0, coalesce(%I, 0) - $1) where user_id = $2 and usage_date = $3',
                   v_a.bucket || '_used', v_a.bucket || '_used')
      using v_refund, p_uid, v_a.usage_date;
  end if;
  if v_a.bucket = 'daily_test' then v_refund := 0; end if;
  update public.ai_actions set ended_at = now() where id = p_action_id;
  return json_build_object('refunded', v_refund);
end;
$$;

-- The Daily Mini Test's AI calls: the generation itself, and the textbook
-- retrieval embedding it runs first. 'daily_test' joins the known buckets.
alter table public.ai_features drop constraint ai_features_buckets_known;
alter table public.ai_features add constraint ai_features_buckets_known check (quota_buckets <@ array[
  'ai_questions','veda_messages','paper_evaluations','podcasts','paper_generations','daily_test']::text[]);
update public.ai_features set quota_buckets = array_append(quota_buckets, 'daily_test')
 where feature in ('daily-challenge', 'question-gen-embed')
   and not ('daily_test' = any (quota_buckets));
