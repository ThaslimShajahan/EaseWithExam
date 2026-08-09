-- upsert_usage_quota rejected 'podcasts_used' with "invalid quota field".
--
-- Its whitelist listed ai_questions / veda_messages / image_uploads /
-- daily_challenges / mock_tests / paper_evaluations / paper_generations but
-- never podcasts, even though FREE_LIMITS, FIELD_LABELS, FIELD_TO_CONFIG
-- (src/lib/quota.js), quota_config and the Sidebar usage panel all carry it.
--
-- It is currently masked: incrementQuota() picks between this function and
-- check_and_increment_quota() on the `atomic_quota_rpc_enabled` flag, that
-- flag is on, and the atomic function accepts podcasts_used fine. The moment
-- anyone flips that flag off — it is presented as the safe fallback — every
-- podcast generation would silently stop counting, because incrementQuota
-- swallows the error in a bare catch.
--
-- Derive the whitelist from the table itself rather than restating it, so a
-- future quota column can't drift out of sync again. Still a whitelist: the
-- column name is interpolated into dynamic SQL, so it must be constrained to
-- real columns of this table, and the _used suffix keeps it to counters.

create or replace function public.upsert_usage_quota(
  p_uid text,
  p_date date,
  p_field text,
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.upsert_usage_quota(text, date, text, integer) to anon, authenticated;
