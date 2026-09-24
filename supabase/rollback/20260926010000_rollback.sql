-- Rollback for 20260926010000_ai_proxy_features_and_quota.sql.
--
-- ORDER: redeploy the previous ai-proxy (the open relay) and the previous
-- web bundle FIRST — the new bundle calls begin_ai_action/end_ai_action and
-- the new proxy requires ai_proxy_authorize. Then run this.
--
-- ai_features, ai_actions and the new RPCs are left in place: harmless and
-- unused by the old bundle. This only restores the two quota RPCs to their
-- exact pre-migration definitions (captured from live 2026-09-25) — which
-- REOPENS their holes (upsert_usage_quota: no identity check, any amount;
-- both: caller-supplied date). Use only to recover from an outage.

CREATE OR REPLACE FUNCTION public.upsert_usage_quota(p_uid text, p_date date, p_field text, p_amount integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'daily_usage_quota'
      and column_name  = p_field
      and column_name like '%\_used'
  ) then
    raise exception 'invalid quota field: %', p_field;
  end if;

  insert into daily_usage_quota (user_id, usage_date)
  values (p_uid, p_date)
  on conflict (user_id, usage_date) do nothing;

  execute format(
    'update daily_usage_quota set %I = coalesce(%I, 0) + $1
     where user_id = $2 and usage_date = $3',
    p_field, p_field
  ) using p_amount, p_uid, p_date;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_and_increment_quota(p_uid text, p_field text, p_amount integer DEFAULT 1, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

