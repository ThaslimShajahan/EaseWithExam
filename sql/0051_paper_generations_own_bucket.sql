-- ═══════════════════════════════════════════════════════════════════
-- Migration 0051 — Full-paper generation gets its own quota bucket
--
-- Exam Center's "Generate full paper" charged the shared ai_questions
-- bucket per QUESTION in the paper (e.g. a 45-question NEET-style paper
-- cost 45 units against a 20/day free allowance) — a free student could
-- never generate a single full paper; checkQuota rejected it outright
-- before generation even started. This splits full-paper generation into
-- its own small daily bucket (paper_generations_used), so one full paper
-- always costs exactly 1 unit, decoupled from the ai_questions bucket used
-- by Practice Generator / Flashcards / Study Plan (which correctly scales
-- with question count). Free tier: 2 full papers/day, per explicit
-- request ("they should only generate 1 or 2 question papers a day").
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE daily_usage_quota ADD COLUMN IF NOT EXISTS paper_generations_used int DEFAULT 0;
ALTER TABLE quota_config      ADD COLUMN IF NOT EXISTS paper_generations      int;
ALTER TABLE quota_overrides   ADD COLUMN IF NOT EXISTS paper_generations      int;

UPDATE quota_config SET paper_generations = CASE plan_id
  WHEN 'free'        THEN 2
  WHEN 'centre_free' THEN 2
  ELSE -1
END;

-- ── check_and_increment_quota: add paper_generations_used to the field whitelist ──
CREATE OR REPLACE FUNCTION public.check_and_increment_quota(p_uid text, p_field text, p_amount integer DEFAULT 1, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_used         int := 0;
  v_limit        int := -1;
  v_config_field text;
  v_plan         text := 'free';
begin
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
$function$;

-- ── upsert_usage_quota: add paper_generations_used to the field whitelist ──
CREATE OR REPLACE FUNCTION public.upsert_usage_quota(p_uid text, p_date date, p_field text, p_amount integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _allowed text[] := ARRAY[
    'ai_questions_used',
    'veda_messages_used',
    'image_uploads_used',
    'daily_challenges_used',
    'mock_tests_used',
    'paper_evaluations_used',
    'paper_generations_used'
  ];
BEGIN
  IF p_field != ALL(_allowed) THEN
    RAISE EXCEPTION 'invalid quota field: %', p_field;
  END IF;

  -- Ensure a row exists for today (new columns use DEFAULT 0; existing columns
  -- keep their current value via DO NOTHING — no data loss).
  INSERT INTO daily_usage_quota (
    user_id, usage_date,
    ai_questions_used, veda_messages_used,
    image_uploads_used, daily_challenges_used,
    paper_evaluations_used, paper_generations_used
  ) VALUES (p_uid, p_date, 0, 0, 0, 0, 0, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  -- Atomic increment via whitelisted dynamic column name.
  EXECUTE format(
    'UPDATE daily_usage_quota SET %I = COALESCE(%I, 0) + $1
     WHERE user_id = $2 AND usage_date = $3',
    p_field, p_field
  ) USING p_amount, p_uid, p_date;
END;
$function$;

-- ── admin_set_quota_config: now accepts paper_generations too ─────────
DROP FUNCTION IF EXISTS public.admin_set_quota_config(text, text, integer, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_set_quota_config(
  p_caller             text,
  p_plan_id            text,
  p_ai                 integer,
  p_veda               integer,
  p_mock               integer,
  p_paper_evaluations  integer DEFAULT NULL,
  p_podcasts           integer DEFAULT NULL,
  p_paper_generations  integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO quota_config (plan_id, ai_questions, veda_messages, mock_tests, paper_evaluations, podcasts, paper_generations)
  VALUES (p_plan_id, p_ai, p_veda, p_mock, p_paper_evaluations, p_podcasts, p_paper_generations)
  ON CONFLICT (plan_id) DO UPDATE SET
    ai_questions       = EXCLUDED.ai_questions,
    veda_messages      = EXCLUDED.veda_messages,
    mock_tests         = EXCLUDED.mock_tests,
    paper_evaluations  = EXCLUDED.paper_evaluations,
    podcasts           = EXCLUDED.podcasts,
    paper_generations  = EXCLUDED.paper_generations;
  RETURN json_build_object('ok', true);
END;
$$;

-- ── admin_set_quota_override: now accepts paper_generations too ───────
DROP FUNCTION IF EXISTS public.admin_set_quota_override(text, text, integer, integer, integer, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_set_quota_override(
  p_caller             text,
  p_user_id            text,
  p_ai                 integer DEFAULT NULL,
  p_veda               integer DEFAULT NULL,
  p_mock               integer DEFAULT NULL,
  p_reason             text    DEFAULT NULL,
  p_expires_at         text    DEFAULT NULL,
  p_paper_evaluations  integer DEFAULT NULL,
  p_podcasts           integer DEFAULT NULL,
  p_paper_generations  integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT; v_expires TIMESTAMPTZ;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <> '' THEN
    v_expires := p_expires_at::TIMESTAMPTZ;
  END IF;
  INSERT INTO quota_overrides (user_id, ai_questions, veda_messages, mock_tests, reason, expires_at, updated_at, paper_evaluations, podcasts, paper_generations)
  VALUES (p_user_id, p_ai, p_veda, p_mock, p_reason, v_expires, NOW(), p_paper_evaluations, p_podcasts, p_paper_generations)
  ON CONFLICT (user_id) DO UPDATE SET
    ai_questions       = EXCLUDED.ai_questions,
    veda_messages      = EXCLUDED.veda_messages,
    mock_tests         = EXCLUDED.mock_tests,
    reason             = EXCLUDED.reason,
    expires_at         = EXCLUDED.expires_at,
    updated_at         = NOW(),
    paper_evaluations  = EXCLUDED.paper_evaluations,
    podcasts           = EXCLUDED.podcasts,
    paper_generations  = EXCLUDED.paper_generations;
  RETURN json_build_object('ok', true);
END;
$$;

-- ── admin_list_quota_overrides: now returns paper_generations too ─────
DROP FUNCTION IF EXISTS public.admin_list_quota_overrides(text);

CREATE OR REPLACE FUNCTION public.admin_list_quota_overrides(p_caller text)
RETURNS TABLE(
  id uuid, user_id text, ai_questions integer, veda_messages integer, mock_tests integer,
  paper_evaluations integer, podcasts integer, paper_generations integer,
  reason text, expires_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.user_id, o.ai_questions, o.veda_messages, o.mock_tests,
           o.paper_evaluations, o.podcasts, o.paper_generations,
           o.reason, o.expires_at, o.created_at, o.updated_at
    FROM   quota_overrides o
    ORDER  BY o.created_at DESC;
END;
$$;
