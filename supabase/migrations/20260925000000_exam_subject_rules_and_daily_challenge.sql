-- Exam→subject rules enforced server-side; per-exam hidden subjects; Daily
-- Mini Test moved behind verified RPCs.
--
-- WHY (investigated 2026-09-24, see docs/CHANGELOG.md):
-- A student got a Daily Mini Test labelled "JEE Advanced · English". Root
-- cause: src/lib/dailyChallenge.js picked the subject from its own hardcoded
-- list, where 'JEE Advanced' matched no branch and fell through to
-- ['Mathematics','Science','English'], then the browser built the label and
-- inserted it straight into daily_challenges (anon-writable). 62 of 258 live
-- daily tests had a subject outside their exam (or exam 'NONE'). The correct
-- mapping already existed — exam_categories.subjects — and was never read.
--
-- WHAT THIS DOES
--  1. exam_categories gains:
--       hidden_subjects  per-exam "hidden from students" list (owner request:
--                        per exam/class, never global). Hiding deletes nothing;
--                        the subject stays in `subjects`, so admins still see
--                        it, profiles carrying it stay valid, content is kept.
--       content_sources  which exam_types' loaded content an exam may draw on
--                        (moved from src/lib/examMapping.js CORPUS_FALLBACK;
--                        owner decision: CBSE 11/12 NCERT is valid for
--                        NEET/JEE). Read side only — never used for writes.
--  2. allowed_subjects_for_caller(p_uid): THE server-side answer to "which
--     exams and subjects may this verified student see/generate". Mirrors
--     src/lib/studentSubjects.js exactly (competitive: fixed list; school:
--     strict reconciliation against the stored selection; 11–12 with none:
--     needs setup), then removes hidden and no-content subjects.
--     assert_exam_subject_allowed() refuses anything else with 22023.
--  3. Daily Mini Test: the server picks exam+subject (preferring subjects with
--     loaded content), the save RPC re-checks and builds the label itself.
--     daily_challenges / daily_challenge_attempts / daily_challenge_history
--     are locked (were anon-readable/writable) and reached only via RPCs.
--  4. get_recent_challenge_topics / upsert_challenge_history gain the missing
--     identity check (any caller could read/write any uid's history).
--  5. admin_set_subject_hidden: the only writer of hidden_subjects,
--     assert_verified_admin, audited to changelog in the same transaction.
--
-- NOT covered here (owner-scheduled for security pass 2): ai-proxy does not
-- yet check exam/subject, so generators other than the Daily Mini Test are
-- scoped by the server-provided picker list but not refused at generation.
--
-- BREAKING for the deployed bundle (it reads/writes daily_challenges and
-- daily_challenge_attempts directly): ship the matching frontend in the same
-- window. Rollback: supabase/rollback/20260925000000_rollback.sql.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. exam_categories: hidden_subjects + content_sources
-- ═════════════════════════════════════════════════════════════════════════
alter table public.exam_categories
  add column if not exists hidden_subjects text[] not null default '{}',
  add column if not exists content_sources text[] not null default '{}';

comment on column public.exam_categories.hidden_subjects is
  'Subjects in `subjects` that students of this exam must not see or generate. Written only by admin_set_subject_hidden (audited). Hiding deletes nothing.';
comment on column public.exam_categories.content_sources is
  'Other exam_types whose loaded content this exam may READ (e.g. NEET -> CBSE Class 11/12). Never used when writing.';

-- Same values as the CORPUS_FALLBACK constant this replaces.
update public.exam_categories
   set content_sources = array['CBSE Class 11', 'CBSE Class 12']
 where exam_key in ('NEET', 'JEE Main', 'JEE Advanced');

-- Audit rows for category changes get their own entity type.
alter table public.changelog drop constraint if exists changelog_entity_type_check;
alter table public.changelog add constraint changelog_entity_type_check check (entity_type = any (array[
  'content_item','pyq_question','published_test','study_note','syllabus_node','plan_config','feature_flag',
  'coaching_centre','user_quota','admin_user','exam_blueprint','misconception','system','exam_category'
]));

-- ═════════════════════════════════════════════════════════════════════════
-- 2. The student's exam contexts and allowed subjects (server-side truth)
-- ═════════════════════════════════════════════════════════════════════════

-- Server twin of getCompetitiveExamType/getSchoolExamType in
-- src/lib/categories.js. Competitive first. Only ACTIVE exam_categories rows
-- count — an unknown or inactive exam yields no context (fail closed; the
-- client shows "set up your exam" / "coming soon", never a guessed exam).
-- 'BOTH' -> 'NEET' mirrors the client's EXAM_ID_MAP.
create or replace function public._student_exam_contexts(p_uid text)
returns table (exam_type text, kind text, class_level text)
language sql stable security definer
set search_path = public
as $$
  with u as (
    select target_exam, syllabus, class_level from public.users where firebase_uid = p_uid
  ), keys as (
    select
      case u.target_exam
        when 'NEET' then 'NEET' when 'BOTH' then 'NEET'
        when 'JEE_MAIN' then 'JEE Main' when 'JEE_ADVANCED' then 'JEE Advanced'
        when 'CUET' then 'CUET' when 'UPSC' then 'UPSC' when 'SSC' then 'SSC CGL'
        when 'OLYMPIAD' then 'Olympiad'
      end as comp_key,
      case when u.class_level ~ '^\d+$' then
        (case upper(replace(coalesce(u.syllabus, ''), '_', ' '))
           when 'CBSE' then 'CBSE' when 'ICSE' then 'ICSE'
           when 'KERALA STATE' then 'Kerala State' when 'STATE BOARD' then 'State Board'
         end) || ' Class ' || u.class_level
      end as school_key,
      u.class_level
    from u
  )
  select ec.exam_key, case when ec.exam_key = k.comp_key then 'competitive' else 'school' end, k.class_level
    from keys k
    join public.exam_categories ec
      on ec.is_active and ec.exam_key in (k.comp_key, k.school_key)
   order by (ec.exam_key = k.comp_key) desc;
$$;

-- Returns [{exam_type, kind, subjects[], needs_setup, content_sources[]}],
-- competitive first. `subjects` = what this student may see and generate:
-- hidden and no-content subjects already removed.
create or replace function public.allowed_subjects_for_caller(p_uid text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_ctx      record;
  v_out      jsonb := '[]'::jsonb;
  v_profile  text[];
  v_board    text[];
  v_hidden   text[];
  v_sources  text[];
  v_subjects text[];
  v_needs    boolean;
begin
  perform public.assert_verified_self(p_uid);
  select coalesce(subjects, '{}') into v_profile from public.users where firebase_uid = p_uid;
  v_profile := coalesce(v_profile, '{}');

  for v_ctx in select * from public._student_exam_contexts(p_uid) loop
    select coalesce(subjects, '{}'), coalesce(hidden_subjects, '{}'), coalesce(content_sources, '{}')
      into v_board, v_hidden, v_sources
      from public.exam_categories where exam_key = v_ctx.exam_type;
    v_needs := false;

    if v_ctx.kind = 'competitive' then
      -- Fixed by the exam itself; the stored selection is the SCHOOL stream
      -- list and must not be reconciled against it (studentSubjects.js BUG 1).
      v_subjects := v_board;
    elsif cardinality(v_profile) > 0 then
      -- Strict reconciliation, same as resolveStudentSubjects: any stored
      -- subject the board no longer offers means "re-select", not a guess.
      if exists (select 1 from unnest(v_profile) s where s <> all (v_board)) then
        v_subjects := '{}'; v_needs := true;
      else
        v_subjects := array(select b.s from unnest(v_board) with ordinality b(s, i)
                             where b.s = any (v_profile) order by b.i);
      end if;
    elsif v_ctx.class_level in ('11', '12') then
      v_subjects := '{}'; v_needs := true;       -- stream class, no selection
    else
      v_subjects := v_board;                     -- classes up to 10: board list IS the list
    end if;

    -- Hidden (per exam) and no-content (global) subjects are never offered.
    v_subjects := array(
      select x.s from unnest(v_subjects) with ordinality x(s, i)
       where x.s <> all (v_hidden)
         and not exists (select 1 from public.subjects sj where sj.name = x.s and sj.content_bearing = false)
       order by x.i);

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'exam_type',       v_ctx.exam_type,
      'kind',            v_ctx.kind,
      'subjects',        to_jsonb(v_subjects),
      'needs_setup',     v_needs,
      'content_sources', to_jsonb(array[v_ctx.exam_type] || v_sources)));
  end loop;

  return v_out;
end;
$$;

create or replace function public.assert_exam_subject_allowed(p_uid text, p_exam_type text, p_subject text)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare v_ctx jsonb;
begin
  select x into v_ctx
    from jsonb_array_elements(public.allowed_subjects_for_caller(p_uid)) x
   where x->>'exam_type' = p_exam_type;
  if v_ctx is null then
    raise exception 'Exam not allowed for this student: %', coalesce(p_exam_type, '(none)') using errcode = '22023';
  end if;
  if (v_ctx->>'needs_setup')::boolean then
    raise exception 'Subject setup required for %', p_exam_type using errcode = '22023';
  end if;
  if p_subject is null or not (v_ctx->'subjects' ? p_subject) then
    raise exception 'Subject not allowed for %: %', p_exam_type, coalesce(p_subject, '(none)') using errcode = '22023';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Daily Mini Test
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists public_all_dc               on public.daily_challenges;
drop policy if exists "insert daily challenges"   on public.daily_challenges;
drop policy if exists "read daily challenges"     on public.daily_challenges;
drop policy if exists public_all_dca              on public.daily_challenge_attempts;
drop policy if exists "read attempts"             on public.daily_challenge_attempts;
drop policy if exists "upsert attempts"           on public.daily_challenge_attempts;
drop policy if exists "update attempts"           on public.daily_challenge_attempts;
revoke all on public.daily_challenges         from anon, authenticated;
revoke all on public.daily_challenge_attempts from anon, authenticated;
revoke all on public.daily_challenge_history  from anon, authenticated;
-- RLS stays on with no policies (history already had dch_deny_all): deny-all.

create or replace function public._ist_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- The server chooses today's exam + subject. First exam context that has
-- subjects (competitive first, as the old client did); within it, subjects
-- with loaded content in its content_sources win; yesterday's subject is
-- avoided when there is an alternative. Never returns a disallowed pair.
create or replace function public.pick_daily_challenge_subject(p_uid text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_ctx      jsonb;
  v_subjects text[];
  v_sources  text[];
  v_with     text[];
  v_pool     text[];
  v_last     text;
  v_pick     text;
  v_any_setup boolean := false;
begin
  for v_ctx in select x from jsonb_array_elements(public.allowed_subjects_for_caller(p_uid)) x loop
    if (v_ctx->>'needs_setup')::boolean then v_any_setup := true; continue; end if;
    v_subjects := array(select jsonb_array_elements_text(v_ctx->'subjects'));
    if cardinality(v_subjects) = 0 then continue; end if;
    v_sources := array(select jsonb_array_elements_text(v_ctx->'content_sources'));

    v_with := array(select s from unnest(v_subjects) s
                     where exists (select 1 from public.knowledge_base kb
                                    where kb.subject = s and kb.exam_type = any (v_sources)));
    v_pool := case when cardinality(v_with) > 0 then v_with else v_subjects end;

    select subject into v_last from public.daily_challenge_history
     where user_id = p_uid and challenge_date < public._ist_today()
     order by challenge_date desc limit 1;
    if cardinality(v_pool) > 1 and v_last = any (v_pool) then
      v_pool := array_remove(v_pool, v_last);
    end if;

    v_pick := v_pool[1 + floor(random() * cardinality(v_pool))::int];
    return jsonb_build_object(
      'status',          'ok',
      'exam_type',       v_ctx->>'exam_type',
      'subject',         v_pick,
      'has_content',     v_pick = any (v_with),
      'content_sources', v_ctx->'content_sources');
  end loop;

  return jsonb_build_object('status', case when v_any_setup then 'setup_required' else 'no_subjects' end);
end;
$$;

create or replace function public.save_daily_challenge(
  p_uid text, p_exam_type text, p_subject text, p_chapter text, p_questions jsonb
) returns public.daily_challenges
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_row     public.daily_challenges;
  v_chapter text := nullif(btrim(left(coalesce(p_chapter, ''), 200)), '');
  v_q       jsonb;
begin
  perform public.assert_exam_subject_allowed(p_uid, p_exam_type, p_subject);

  if p_questions is null or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) not between 1 and 10 then
    raise exception 'p_questions must be an array of 1-10 questions' using errcode = '22023';
  end if;
  for v_q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_q) <> 'object'
       or coalesce(btrim(v_q->>'q'), '') = '' or coalesce(btrim(v_q->>'answer'), '') = '' then
      raise exception 'Every question needs non-empty q and answer' using errcode = '22023';
    end if;
  end loop;

  -- Each save is a paid AI generation; cap regenerations per student per day.
  if (select count(*) from public.daily_challenges
       where user_id = p_uid and challenge_date = public._ist_today()) >= 6 then
    raise exception 'Daily challenge limit reached for today' using errcode = '54000';
  end if;

  insert into public.daily_challenges
    (user_id, challenge_date, exam_type, subject, question, options, correct_answer, explanation, chapter)
  values
    (p_uid, public._ist_today(), p_exam_type, p_subject,
     'Daily ' || p_exam_type || ' · ' || p_subject || ' · ' || coalesce(v_chapter, 'Mixed'),
     p_questions, 'paper', '', coalesce(v_chapter, p_subject))
  returning * into v_row;

  insert into public.daily_challenge_history (user_id, subject, topic, challenge_date)
  values (p_uid, p_subject, coalesce(v_chapter, p_subject), public._ist_today())
  on conflict (user_id, challenge_date) do update set subject = excluded.subject, topic = excluded.topic;

  return v_row;
end;
$$;

-- Today's newest test whose exam+subject is STILL allowed — so hiding a
-- subject removes today's test immediately rather than tomorrow.
create or replace function public.get_today_daily_challenge(p_uid text)
returns public.daily_challenges
language plpgsql stable security definer
set search_path = public
as $$
declare v_allowed jsonb; v_row public.daily_challenges;
begin
  v_allowed := public.allowed_subjects_for_caller(p_uid);
  select d.* into v_row
    from public.daily_challenges d
   where d.user_id = p_uid and d.challenge_date = public._ist_today()
     and exists (select 1 from jsonb_array_elements(v_allowed) x
                  where x->>'exam_type' = d.exam_type
                    and not (x->>'needs_setup')::boolean
                    and x->'subjects' ? d.subject)
   order by d.created_at desc
   limit 1;
  return v_row;
end;
$$;

create or replace function public.save_daily_challenge_attempt(
  p_uid text, p_challenge_id uuid, p_selected text, p_is_correct boolean
) returns void
language plpgsql volatile security definer
set search_path = public
as $$
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
$$;

create or replace function public.get_own_daily_challenge_attempt(p_uid text, p_challenge_id uuid)
returns table (selected_option text, is_correct boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  return query select a.selected_option, a.is_correct from public.daily_challenge_attempts a
                where a.challenge_id = p_challenge_id and a.user_id = p_uid;
end;
$$;

-- WeeklyReport: it selected `attempted_at`, a column that never existed, so
-- its daily-challenge numbers were always silently empty.
create or replace function public.get_own_daily_challenge_attempts(p_uid text, p_from timestamptz, p_to timestamptz)
returns table (is_correct boolean, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  return query select a.is_correct, a.created_at from public.daily_challenge_attempts a
                where a.user_id = p_uid and a.created_at >= p_from and a.created_at < p_to;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Existing history RPCs: add the missing identity check
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.get_recent_challenge_topics(p_uid text, p_cutoff text)
returns table (topic text, subject text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  return query select h.topic, h.subject from public.daily_challenge_history h
                where h.user_id = p_uid and h.challenge_date >= p_cutoff::date;
end;
$$;

-- No longer called by the current client (save_daily_challenge records
-- history itself); kept for older bundles, now self-only and subject-checked.
create or replace function public.upsert_challenge_history(p_uid text, p_subject text, p_topic text, p_date text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  if not exists (select 1 from jsonb_array_elements(public.allowed_subjects_for_caller(p_uid)) x
                  where x->'subjects' ? p_subject) then
    raise exception 'Subject not allowed: %', coalesce(p_subject, '(none)') using errcode = '22023';
  end if;
  insert into public.daily_challenge_history (user_id, subject, topic, challenge_date)
  values (p_uid, p_subject, left(p_topic, 200), p_date::date)
  on conflict (user_id, challenge_date) do update set subject = excluded.subject, topic = excluded.topic;
end;
$$;

-- Published (admin-authored) tests: a test in a subject hidden for its exam is
-- not returned to students. Deliberately independent of the caller — this
-- function's own access rules (can_student_view_test) are unchanged, and one
-- caller passes p_uid null just to count. Unhiding restores the tests.
create or replace function public.get_published_tests_for_student(p_uid text)
returns setof public.published_tests
language sql stable security definer
set search_path = public
as $$
  select pt.* from public.published_tests pt
  where pt.is_published = true
    and public.can_student_view_test(pt.id, p_uid)
    and not exists (select 1 from public.exam_categories ec
                     where ec.exam_key = pt.exam_type and pt.subject = any (ec.hidden_subjects))
  order by pt.created_at desc;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Admin: hide / show a subject for one exam (audited)
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.admin_set_subject_hidden(
  p_caller text, p_exam_key text, p_subject text, p_hidden boolean, p_note text default null
) returns public.exam_categories
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_role   text;
  v_before boolean;
  v_row    public.exam_categories;
begin
  v_role := public.assert_verified_admin(p_caller);
  if p_hidden is null then
    raise exception 'p_hidden is required' using errcode = '22023';
  end if;

  select * into v_row from public.exam_categories where exam_key = p_exam_key for update;
  if not found then
    raise exception 'Unknown exam: %', coalesce(p_exam_key, '(none)') using errcode = '22023';
  end if;
  if p_subject is null or p_subject <> all (v_row.subjects) then
    raise exception 'Subject % is not offered for %', coalesce(p_subject, '(none)'), p_exam_key using errcode = '22023';
  end if;

  v_before := p_subject = any (v_row.hidden_subjects);
  if v_before = p_hidden then
    return v_row;                               -- no change, nothing to audit
  end if;

  update public.exam_categories
     set hidden_subjects = case when p_hidden
                                then array_append(hidden_subjects, p_subject)
                                else array_remove(hidden_subjects, p_subject) end,
         updated_at = now()
   where exam_key = p_exam_key
  returning * into v_row;

  insert into public.changelog (entity_type, entity_id, action, actor_uid, actor_role, diff, note)
  values ('exam_category', p_exam_key, 'update', p_caller, v_role,
          jsonb_build_object('field', 'hidden_subjects', 'subject', p_subject,
                             'before', jsonb_build_object('hidden', v_before),
                             'after',  jsonb_build_object('hidden', p_hidden)),
          coalesce(nullif(btrim(p_note), ''),
                   case when p_hidden then 'Subject hidden from students: ' else 'Subject shown to students: ' end
                   || p_subject || ' (' || p_exam_key || ')'));

  return v_row;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════
-- Internal helpers: callable only from the SECURITY DEFINER functions above.
revoke execute on function public._student_exam_contexts(text) from public, anon, authenticated;
revoke execute on function public._ist_today()                from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.allowed_subjects_for_caller(text)',
    'public.assert_exam_subject_allowed(text, text, text)',
    'public.pick_daily_challenge_subject(text)',
    'public.save_daily_challenge(text, text, text, text, jsonb)',
    'public.get_today_daily_challenge(text)',
    'public.save_daily_challenge_attempt(text, uuid, text, boolean)',
    'public.get_own_daily_challenge_attempt(text, uuid)',
    'public.get_own_daily_challenge_attempts(text, timestamptz, timestamptz)',
    'public.get_recent_challenge_topics(text, text)',
    'public.upsert_challenge_history(text, text, text, text)',
    'public.admin_set_subject_hidden(text, text, text, boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
