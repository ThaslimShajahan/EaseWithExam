-- Security pass 2, Part B: ai-proxy stops being an open OpenAI relay, and the
-- EXISTING quota system is enforced server-side.
--
-- FOUND 2026-09-25 (proven with a zero-cost probe — a nonexistent model name,
-- which OpenAI rejected with model_not_found, proving the request was relayed):
-- ai-proxy forwarded ANY body to OpenAI with the company key — any model, and
-- the images / tts / embeddings routes too — to anyone holding the public anon
-- key. `_caller_uid` was client-claimed and used only for logging.
-- Quota (quota_config per plan + quota_overrides campaign grants) was enforced
-- ONLY in the browser: checkQuota() before a call, incrementQuota() after. The
-- server never refused an AI call.
--
-- DESIGN (owner-approved 2026-09-25: no new caps — enforce the existing quota):
--  * ai_features — the allowlist. Every feature the app sends as `_feature`,
--    who may use it (student|admin), which quota buckets it may draw on, whether
--    it is exam+subject scoped, and which routes/models it may use. Unknown or
--    inactive feature → refused. Admins are exempt from quota.
--  * begin_ai_action — a student action (one practice set, one flashcard deck,
--    one doubt message...) is charged ONCE, up front, against the existing
--    bucket, using the same limit rule the app already applied client-side:
--    an active campaign grant (quota_overrides) wins, else the student's
--    effective plan row in quota_config; -1 = unlimited. Exam+subject, when
--    given, must pass assert_exam_subject_allowed. The action then covers the
--    several proxy calls one action makes (topic distribution, generation,
--    verification, diagrams, embeddings) for 30 minutes / 200 calls.
--  * end_ai_action — refunds what was not used (0 = full refund on failure).
--  * ai_proxy_authorize — called by ai-proxy with the caller's Firebase token:
--    verified identity, feature/route/model allowlist, admin gate, and for
--    students an open action in one of the feature's buckets (subject checked
--    again from the action).
--
-- Rollback: supabase/rollback/20260926010000_rollback.sql (redeploy the
-- previous ai-proxy first).

-- ═════════════════════════════════════════════════════════════════════════
-- 1. The allowlist
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_features (
  feature        text primary key,
  audience       text not null check (audience in ('student', 'admin')),
  -- quota buckets a student call may draw on (daily_usage_quota *_used fields
  -- minus the suffix). Empty = unmetered for students (none today).
  quota_buckets  text[] not null default '{}',
  needs_subject  boolean not null default false,
  allowed_routes text[] not null default '{chat}',
  allowed_models text[] not null default '{}',
  is_active      boolean not null default true,
  notes          text,
  updated_at     timestamptz not null default now(),
  constraint ai_features_buckets_known check (quota_buckets <@ array[
    'ai_questions','veda_messages','paper_evaluations','podcasts','paper_generations']::text[]),
  constraint ai_features_routes_known check (allowed_routes <@ array['chat','embeddings','tts','images']::text[])
);
alter table public.ai_features enable row level security;   -- no policies: RPC-only
revoke all on public.ai_features from anon, authenticated;

-- Models: exactly those seen in ai_call_log for real features (2026-09-25).
-- No feature has ever used the images route, so none is allowed it.
insert into public.ai_features (feature, audience, quota_buckets, needs_subject, allowed_routes, allowed_models, notes) values
  -- student, exam+subject scoped generation
  ('question-gen-paper',              'student', '{ai_questions,paper_generations}', true,  '{chat}',       '{gpt-4o,gpt-4o-mini}', 'Practice (ai_questions) and Exam Center papers (paper_generations)'),
  ('question-gen-topic-distribution', 'student', '{ai_questions,paper_generations}', true,  '{chat}',       '{gpt-4o,gpt-4o-mini}', 'sub-call of question generation'),
  ('answer-verification',             'student', '{ai_questions,paper_generations}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', 'sub-call: verifies generated questions'),
  ('diagram-gen',                     'student', '{ai_questions,paper_generations}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', 'sub-call: SVG figures for generated questions'),
  ('chem-structure-gen',              'student', '{ai_questions,paper_generations}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', 'sub-call: chemical structures for generated questions'),
  ('question-gen-embed',              'student', '{ai_questions,paper_generations}', false, '{embeddings}', '{text-embedding-3-small}', 'sub-call: textbook retrieval'),
  ('flashcards',                      'student', '{ai_questions}',                   true,  '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('important-qa-gen',                'student', '{ai_questions}',                   true,  '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('chapter-notes-gen',               'student', '{ai_questions}',                   true,  '{chat}',       '{gpt-4o,gpt-4o-mini}', 'PROPOSED bucket (was uncharged) — owner to approve'),
  ('daily-challenge',                 'student', '{ai_questions}',                   true,  '{chat}',       '{gpt-4o,gpt-4o-mini}', 'PROPOSED bucket (was uncharged) — owner to approve'),
  -- student, exam-level or free-form
  ('study-plan-gen',                  'student', '{ai_questions}',                   false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('summarizer',                      'student', '{ai_questions}',                   false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('doubt-chat-text',                 'student', '{veda_messages}',                  false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('doubt-chat-image',                'student', '{veda_messages}',                  false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('doubt-chat-embed',                'student', '{veda_messages}',                  false, '{embeddings}', '{text-embedding-3-small}', null),
  ('paper-mode-evaluate',             'student', '{paper_evaluations}',              false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('paper-mode-grade',                'student', '{paper_evaluations}',              false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('mock-test-answer-eval',           'student', '{paper_evaluations}',              false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('podcast-script',                  'student', '{podcasts}',                       false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('podcast-tts',                     'student', '{podcasts}',                       false, '{tts}',        '{tts-1}', null),
  -- admin-only tooling (admins are exempt from quota)
  ('admin-paper-gen',                 'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('admin-study-notes',               'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('admin-syllabus-fetch',            'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('content-review',                  'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('kb-chunk-embed',                  'admin',   '{}', false, '{embeddings}', '{text-embedding-3-small}', null),
  ('manifest-draft',                  'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('notes-extraction',                'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('notes-latexify-backfill',         'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', 'local maintenance scripts'),
  ('paper-template-gen',              'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('pdf-analyzer',                    'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('pyq-extract-from-kb',             'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('pyq-extraction',                  'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null),
  ('vision-page-extract',             'admin',   '{}', false, '{chat}',       '{gpt-4o,gpt-4o-mini}', null)
on conflict (feature) do nothing;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Actions (one charged unit of student work)
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  bucket      text not null,
  amount      integer not null check (amount between 0 and 500),
  exam_type   text,
  subject     text,
  usage_date  date not null,
  calls_used  integer not null default 0,
  max_calls   integer not null default 200,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 minutes',
  ended_at    timestamptz
);
create index if not exists ai_actions_open_idx on public.ai_actions (user_id, bucket, expires_at desc) where ended_at is null;
alter table public.ai_actions enable row level security;    -- no policies: RPC-only
revoke all on public.ai_actions from anon, authenticated;

create or replace function public._ist_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- The limit rule the app already used (src/lib/quota.js resolveQuota): an
-- active campaign grant wins, else the effective plan's quota_config row.
-- -1 = unlimited. Server-side twin, so a browser can no longer skip it.
create or replace function public._quota_limit(p_uid text, p_bucket text)
returns integer
language plpgsql stable security definer
set search_path = public
as $$
declare v_plan text := 'free'; v_limit integer; v_override integer; v_expires timestamptz;
begin
  begin v_plan := coalesce(public.get_student_effective_plan(p_uid), 'free');
  exception when others then v_plan := 'free'; end;

  execute format('select %I from public.quota_config where plan_id = $1', p_bucket) into v_limit using v_plan;
  if v_limit is null then
    execute format('select %I from public.quota_config where plan_id = ''free''', p_bucket) into v_limit;
  end if;

  execute format('select %I, expires_at from public.quota_overrides where user_id = $1', p_bucket)
    into v_override, v_expires using p_uid;
  if v_override is not null and (v_expires is null or v_expires > now()) then
    v_limit := v_override;
  end if;

  return coalesce(v_limit, 0);   -- no config at all → nothing allowed (fail closed)
end;
$$;

-- The exam+subject scope of an action. 'Mixed' (Practice's all-subjects mode)
-- means "any of this student's allowed subjects for that exam": the exam must
-- still be one of theirs and have at least one allowed subject; retrieval is
-- already limited to that exam's content. Anything else → the exact pair check.
create or replace function public._assert_action_scope(p_uid text, p_exam_type text, p_subject text)
returns void
language plpgsql stable security definer
set search_path = public
as $$
declare v_ctx jsonb;
begin
  if p_subject = 'Mixed' then
    select x into v_ctx from jsonb_array_elements(public.allowed_subjects_for_caller(p_uid)) x
     where x->>'exam_type' = p_exam_type;
    if v_ctx is null then
      raise exception 'Exam not allowed for this student: %', coalesce(p_exam_type, '(none)') using errcode = '22023';
    end if;
    if (v_ctx->>'needs_setup')::boolean or jsonb_array_length(v_ctx->'subjects') = 0 then
      raise exception 'No subjects available for %', p_exam_type using errcode = '22023';
    end if;
    return;
  end if;
  perform public.assert_exam_subject_allowed(p_uid, p_exam_type, p_subject);
end;
$$;

create or replace function public.begin_ai_action(
  p_uid text, p_bucket text, p_amount integer default 1,
  p_exam_type text default null, p_subject text default null
) returns json
language plpgsql volatile security definer
set search_path = public
as $$
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
$$;

-- Refund what the action did not use (p_actual 0 = it failed: full refund).
-- Only once, only for the caller's own action, never below zero.
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
  if v_refund > 0 then
    execute format('update public.daily_usage_quota set %I = greatest(0, coalesce(%I, 0) - $1) where user_id = $2 and usage_date = $3',
                   v_a.bucket || '_used', v_a.bucket || '_used')
      using v_refund, p_uid, v_a.usage_date;
  end if;
  update public.ai_actions set ended_at = now() where id = p_action_id;
  return json_build_object('refunded', v_refund);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. The proxy's gate (called with the caller's forwarded Firebase token)
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.ai_proxy_authorize(p_feature text, p_route text, p_model text)
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare v_uid text; v_f public.ai_features; v_admin boolean; v_a public.ai_actions;
begin
  v_uid := public.verified_uid();
  if v_uid is null then raise exception 'Access denied: unverified caller' using errcode = '42501'; end if;

  select * into v_f from public.ai_features where feature = p_feature and is_active;
  if not found then raise exception 'Unknown AI feature: %', coalesce(p_feature, '(none)') using errcode = '22023'; end if;
  if not (coalesce(p_route, '') = any (v_f.allowed_routes)) then
    raise exception 'Route % not allowed for %', coalesce(p_route, '(none)'), p_feature using errcode = '22023';
  end if;
  if cardinality(v_f.allowed_models) > 0 and not (coalesce(p_model, '') = any (v_f.allowed_models)) then
    raise exception 'Model % not allowed for %', coalesce(p_model, '(none)'), p_feature using errcode = '22023';
  end if;

  v_admin := exists (select 1 from public.admins where uid = v_uid and is_active);
  if v_admin then
    return json_build_object('uid', v_uid, 'is_admin', true);          -- exempt
  end if;
  if v_f.audience = 'admin' then
    raise exception 'Feature % is admin-only', p_feature using errcode = '42501';
  end if;

  -- Students: the call must belong to an open, charged action in one of this
  -- feature's buckets. Most recent first; one row locked and counted.
  select * into v_a from public.ai_actions
   where user_id = v_uid and ended_at is null and expires_at > now()
     and calls_used < max_calls and bucket = any (v_f.quota_buckets)
   order by created_at desc limit 1 for update;
  if not found then
    raise exception 'No active quota for % — start the action again', p_feature using errcode = '54000';
  end if;

  if v_f.needs_subject then
    if v_a.exam_type is null or v_a.subject is null then
      raise exception 'Feature % needs an exam and subject', p_feature using errcode = '22023';
    end if;
    perform public._assert_action_scope(v_uid, v_a.exam_type, v_a.subject);   -- still allowed now?
  end if;

  update public.ai_actions set calls_used = calls_used + 1 where id = v_a.id;
  return json_build_object('uid', v_uid, 'is_admin', false, 'action_id', v_a.id);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Existing quota RPCs: close the holes found alongside
-- ═════════════════════════════════════════════════════════════════════════
-- upsert_usage_quota had NO identity check and accepted any amount, so anyone
-- could burn another student's quota, or pass a negative amount to reset their
-- own. Both RPCs also trusted a caller-supplied date. Now: self only, amount
-- 1–500, date is always today in IST (the parameter is kept for compatibility
-- and ignored). Still used for the non-AI mock_tests bucket (MockTestPage).
create or replace function public.upsert_usage_quota(p_uid text, p_date date, p_field text, p_amount integer default 1)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_today date := public._ist_today();
begin
  perform public.assert_verified_self(p_uid);
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'daily_usage_quota'
      and column_name = p_field and column_name like '%\_used'
  ) then
    raise exception 'invalid quota field: %', p_field;
  end if;
  insert into daily_usage_quota (user_id, usage_date) values (p_uid, v_today)
  on conflict (user_id, usage_date) do nothing;
  execute format('update daily_usage_quota set %I = coalesce(%I, 0) + $1 where user_id = $2 and usage_date = $3', p_field, p_field)
    using p_amount, p_uid, v_today;
end;
$$;

-- Same fixes; the limit rule now comes from _quota_limit (identical logic).
create or replace function public.check_and_increment_quota(p_uid text, p_field text, p_amount integer default 1, p_date date default current_date)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_used int := 0; v_limit int; v_bucket text; v_today date := public._ist_today();
begin
  perform public.assert_verified_self(p_uid);
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  v_bucket := case p_field
    when 'ai_questions_used' then 'ai_questions' when 'veda_messages_used' then 'veda_messages'
    when 'mock_tests_used' then 'mock_tests' when 'paper_evaluations_used' then 'paper_evaluations'
    when 'podcasts_used' then 'podcasts' when 'paper_generations_used' then 'paper_generations' end;
  if v_bucket is null then raise exception 'invalid quota field: %', p_field using errcode = '22023'; end if;

  v_limit := public._quota_limit(p_uid, v_bucket);
  if v_limit = -1 then
    perform public.upsert_usage_quota(p_uid, v_today, p_field, p_amount);
    return jsonb_build_object('allowed', true, 'unlimited', true, 'limit', -1);
  end if;

  insert into daily_usage_quota (user_id, usage_date) values (p_uid, v_today)
  on conflict (user_id, usage_date) do nothing;
  execute format('select coalesce(%I, 0) from daily_usage_quota where user_id = $1 and usage_date = $2 for update', p_field)
    into v_used using p_uid, v_today;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit);
  end if;
  execute format('update daily_usage_quota set %I = coalesce(%I, 0) + $1 where user_id = $2 and usage_date = $3', p_field, p_field)
    using p_amount, p_uid, v_today;
  return jsonb_build_object('allowed', true, 'used', v_used + p_amount, 'limit', v_limit);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════
revoke execute on function public._quota_limit(text, text) from public, anon, authenticated;
revoke execute on function public._assert_action_scope(text, text, text) from public, anon, authenticated;
revoke execute on function public._ist_today() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.begin_ai_action(text, text, integer, text, text)',
    'public.end_ai_action(text, uuid, integer)',
    'public.ai_proxy_authorize(text, text, text)',
    'public.upsert_usage_quota(text, date, text, integer)',
    'public.check_and_increment_quota(text, text, integer, date)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
