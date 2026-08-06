-- Extend the generic test-data cleanup RPC's allowlist to cover
-- coaching_centres (by name) — completes AdminTestData.jsx's seedCoaching/
-- removeAllDummyData, deferred from A1/A2 until the coaching RPCs existed.
create or replace function public.admin_delete_test_rows(p_caller text, p_table text, p_col text, p_values text[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  if p_table not in (
    'question_history', 'user_weak_topics', 'user_gamification',
    'daily_usage_quota', 'flashcards', 'notification_prefs', 'users',
    'coaching_centres'
  ) then
    raise exception 'Table not allowed for this operation';
  end if;
  if p_col not in ('user_id', 'firebase_uid', 'name') then
    raise exception 'Column not allowed for this operation';
  end if;

  execute format('delete from public.%I where %I = any($1)', p_table, p_col) using p_values;
end; $$;
