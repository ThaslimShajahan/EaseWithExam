-- Closes SECURITY_INCIDENTS.md's 2026-08-13 finding for the 8 highest-severity
-- of 68 SECURITY DEFINER RPCs that take an identity parameter (p_uid/p_caller)
-- with NO check binding it to the actual authenticated caller. Full audit,
-- remediation batches for the other 60, and severity groupings are in that
-- file, not here.
--
-- ONE REUSABLE PATTERN, applied identically everywhere it fits --
--
-- assert_verified_self(p_claimed_uid) mirrors assert_verified_admin() exactly
-- (same errcode, same two-step check: unverified caller, then caller
-- mismatch) but without the admins-table role check, since these are
-- self-service RPCs, not admin ones. `perform assert_verified_self(p_uid);`
-- as the first statement is the entire fix for 7 of the 8 -- one line, not a
-- bespoke patch per function. Any future self-service RPC should call this
-- exact helper rather than reinventing the check.
--
-- THE ONE THAT DOES NOT FIT THE PATTERN, AND WHY --
--
-- referral_grant_premium_days(p_uid, p_days) is NOT self-service. Its real
-- caller, traced in 20260809070000_referral_convert_on_payment.sql, is
-- complete_referral() -- itself SECURITY DEFINER, invoked from the
-- razorpay-verify edge function after payment verification -- calling it
-- TWICE: once for the referrer (v_referrer) and once for the referred user
-- (p_uid). The referrer grant is for a DIFFERENT uid than either the
-- original HTTP caller or p_uid. Binding this function to
-- `verified_uid() = p_uid` would have SILENTLY BROKEN the referral reward
-- for the referrer while looking like a security fix -- exactly the kind of
-- mistake "prove real flows still work" exists to catch.
--
-- The correct fix is structural, not a caller check: this function should
-- never have been directly callable by a client at all. REVOKE, not a check.
-- Verified this is safe BEFORE applying it, in an isolated rolled-back
-- probe: a SECURITY DEFINER function's internal call to another function
-- executes as the OUTER function's owner, not as the original caller's role
-- -- so revoking anon/authenticated from the INNER function does not break
-- the OUTER function's (complete_referral's) internal calls to it. Proven
-- with throwaway _probe_inner/_probe_outer functions and `set role anon`,
-- not assumed from documentation.
--
-- student_submit_centre_result has ZERO call sites anywhere in src/ as of
-- this migration -- unreachable from the current frontend. The check is
-- still added (closing the hole costs nothing since nothing currently calls
-- it), but there is no live flow to verify it against, unlike the other 6.

create or replace function public.assert_verified_self(p_claimed_uid text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_sub text;
begin
  v_sub := verified_uid();
  if v_sub is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;
  if p_claimed_uid is null or p_claimed_uid <> v_sub then
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;
  return v_sub;
end;
$$;

comment on function public.assert_verified_self(text) is
  'Raises unless the request carries a verified JWT (see verified_uid()) whose subject equals p_claimed_uid. The self-service equivalent of assert_verified_admin() -- same shape, no admins-table role check. Call as `perform assert_verified_self(p_uid);` as the first statement in any RPC that must be scoped to the calling user, never trust the parameter alone.';

revoke all on function public.assert_verified_self(text) from public, anon;
grant execute on function public.assert_verified_self(text) to authenticated;

-- ── 1/7: upsert_own_user ──────────────────────────────────────────────────
create or replace function public.upsert_own_user(p_uid text, p_fields jsonb)
returns public.users
language sql
security definer
set search_path = public
as $$
  select public.assert_verified_self(p_uid);
  insert into public.users (
    firebase_uid, auth_method, display_name, email, phone_number, photo_url,
    onboarding_completed, target_exam, syllabus, class_level, subjects, academic_track
  )
  values (
    p_uid,
    p_fields->>'auth_method', p_fields->>'display_name', p_fields->>'email',
    p_fields->>'phone_number', p_fields->>'photo_url',
    coalesce((p_fields->>'onboarding_completed')::boolean, false),
    p_fields->>'target_exam', p_fields->>'syllabus', p_fields->>'class_level',
    (select array_agg(x) from jsonb_array_elements_text(p_fields->'subjects') x),
    p_fields->'academic_track'
  )
  on conflict (firebase_uid) do update set
    auth_method           = coalesce(excluded.auth_method, public.users.auth_method),
    display_name          = coalesce(excluded.display_name, public.users.display_name),
    email                 = coalesce(excluded.email, public.users.email),
    phone_number          = coalesce(excluded.phone_number, public.users.phone_number),
    photo_url              = coalesce(excluded.photo_url, public.users.photo_url),
    onboarding_completed  = coalesce((p_fields->>'onboarding_completed')::boolean, public.users.onboarding_completed),
    target_exam            = coalesce(excluded.target_exam, public.users.target_exam),
    syllabus                = coalesce(excluded.syllabus, public.users.syllabus),
    class_level             = coalesce(excluded.class_level, public.users.class_level),
    subjects                = coalesce(excluded.subjects, public.users.subjects),
    academic_track          = coalesce(excluded.academic_track, public.users.academic_track)
  returning *;
$$;

-- ── 2/7: update_own_user ──────────────────────────────────────────────────
create or replace function public.update_own_user(p_uid text, p_fields jsonb)
returns public.users
language sql
security definer
set search_path = public
as $$
  select public.assert_verified_self(p_uid);
  update public.users set
    auth_method            = coalesce(p_fields->>'auth_method', auth_method),
    display_name           = coalesce(p_fields->>'display_name', display_name),
    email                   = coalesce(p_fields->>'email', email),
    phone_number            = coalesce(p_fields->>'phone_number', phone_number),
    photo_url               = coalesce(p_fields->>'photo_url', photo_url),
    onboarding_completed    = coalesce((p_fields->>'onboarding_completed')::boolean, onboarding_completed),
    target_exam             = coalesce(p_fields->>'target_exam', target_exam),
    syllabus                 = coalesce(p_fields->>'syllabus', syllabus),
    class_level              = coalesce(p_fields->>'class_level', class_level),
    subjects                 = coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'subjects') x), subjects),
    academic_track           = coalesce(p_fields->'academic_track', academic_track)
  where firebase_uid = p_uid
  returning *;
$$;

-- ── 3/7: check_and_increment_quota ────────────────────────────────────────
create or replace function public.check_and_increment_quota(p_uid text, p_field text, p_amount integer default 1, p_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used         int := 0;
  v_limit        int := -1;
  v_config_field text;
  v_plan         text := 'free';
begin
  perform public.assert_verified_self(p_uid);

  begin
    select get_student_effective_plan(p_uid) into v_plan;
  exception when others then
    v_plan := 'free';
  end;

  v_config_field := case p_field
    when 'ai_questions_used'      then 'ai_questions'
    when 'veda_messages_used'     then 'veda_messages'
    when 'mock_tests_used'        then 'mock_tests'
    when 'paper_evaluations_used' then 'paper_evaluations'
    when 'podcasts_used'          then 'podcasts'
    when 'paper_generations_used' then 'paper_generations'
    else null
  end;

  if v_config_field is not null then
    begin
      execute format('select %I from quota_config where plan_id = $1', v_config_field)
        into v_limit using v_plan;
    exception when others then null; end;
  end if;

  declare
    v_override_val int;
    v_expires      timestamptz;
  begin
    if v_config_field is not null then
      execute format('select %I, expires_at from quota_overrides where user_id = $1', v_config_field)
        into v_override_val, v_expires using p_uid;
      if v_override_val is not null and (v_expires is null or v_expires > now()) then
        v_limit := v_override_val;
      end if;
    end if;
  exception when others then null; end;

  if v_limit = -1 then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'used', 0, 'limit', -1);
  end if;

  insert into daily_usage_quota (user_id, usage_date)
  values (p_uid, p_date)
  on conflict (user_id, usage_date) do nothing;

  execute format('select coalesce(%I, 0) from daily_usage_quota where user_id = $1 and usage_date = $2 for update', p_field)
    into v_used using p_uid, p_date;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit);
  end if;

  execute format('update daily_usage_quota set %I = coalesce(%I, 0) + $1 where user_id = $2 and usage_date = $3', p_field, p_field)
    using p_amount, p_uid, p_date;

  return jsonb_build_object('allowed', true, 'used', v_used + p_amount, 'limit', v_limit);
end;
$$;

-- ── 4/7: get_user_notifications ───────────────────────────────────────────
create or replace function public.get_user_notifications(p_uid text, p_limit integer default 50)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  return (
    select json_agg(n order by n.created_at desc)
    from (
      select * from in_app_notifications
      where (user_id = p_uid or user_id is null)
        and (expires_at is null or expires_at > now())
      order by created_at desc
      limit p_limit
    ) n
  );
end;
$$;

-- ── 5/7: save_wrong_answers ────────────────────────────────────────────────
create or replace function public.save_wrong_answers(p_uid text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; v_existing_id uuid; v_today date;
begin
  perform public.assert_verified_self(p_uid);
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_existing_id
    from public.question_history
    where user_id = p_uid and question_id = r->>'question_id' and is_mastered = false
    limit 1;

    if v_existing_id is not null then
      update public.question_history set
        user_answer = r->>'user_answer',
        due_date    = v_today,
        is_correct  = false,
        updated_at  = now()
      where id = v_existing_id;
    else
      insert into public.question_history (
        user_id, question_id, question_text, subject, topic, question_type,
        options, correct_option, correct_answer, explanation, user_answer,
        is_correct, source, source_name, due_date, ease_factor, interval_days, repetitions
      ) values (
        p_uid, r->>'question_id', r->>'question_text', r->>'subject', r->>'topic',
        coalesce(r->>'question_type', 'MCQ'),
        r->'options',
        nullif(r->>'correct_option','')::int,
        r->>'correct_answer', r->>'explanation', r->>'user_answer',
        false, coalesce(r->>'source','practice'), r->>'source_name',
        v_today, 2.5, 1, 0
      );
    end if;
  end loop;
end;
$$;

-- ── 6/7: publish_test_by_student ──────────────────────────────────────────
create or replace function public.publish_test_by_student(p_uid text, p_title text, p_subject text, p_exam_type text, p_difficulty text, p_questions jsonb, p_duration_minutes integer, p_blueprint_match_pct numeric default null::numeric)
returns published_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.published_tests;
begin
  perform public.assert_verified_self(p_uid);

  insert into public.published_tests (
    title, subject, exam_type, difficulty, questions,
    duration_minutes, is_published, question_count,
    blueprint_match_pct, created_by, user_id
  ) values (
    p_title, p_subject, p_exam_type, p_difficulty, p_questions,
    p_duration_minutes, true, coalesce(jsonb_array_length(p_questions), 0),
    p_blueprint_match_pct, 'student', p_uid
  ) returning * into v_row;

  return v_row;
end;
$$;

-- ── 7/7: student_submit_centre_result ─────────────────────────────────────
-- Unreachable from src/ today (see header) -- check added regardless; the
-- pre-existing centre-membership check is kept, now as a second, independent
-- layer rather than the only one.
create or replace function public.student_submit_centre_result(p_uid text, p_test_id uuid, p_centre_id uuid, p_score integer, p_max_score integer, p_time_taken_secs integer, p_answers jsonb)
returns centre_student_results
language plpgsql
security definer
set search_path = public
as $$
declare v_row centre_student_results;
begin
  perform public.assert_verified_self(p_uid);
  if not exists (select 1 from coaching_students where firebase_uid = p_uid and centre_id = p_centre_id) then
    raise exception 'Access denied';
  end if;
  insert into centre_student_results (test_id, centre_id, student_uid, score, max_score, time_taken_secs, answers)
  values (p_test_id, p_centre_id, p_uid, p_score, p_max_score, p_time_taken_secs, p_answers)
  returning * into v_row;
  return v_row;
end;
$$;

-- ── The 8th: referral_grant_premium_days — REVOKE, not a caller check ─────
-- No body change. See header for why a caller check would have silently
-- broken the referrer's reward. Internal callers (complete_referral, itself
-- SECURITY DEFINER) are unaffected -- proven in an isolated probe before
-- this line was written, not assumed.
revoke all on function public.referral_grant_premium_days(text, integer) from public, anon, authenticated;
