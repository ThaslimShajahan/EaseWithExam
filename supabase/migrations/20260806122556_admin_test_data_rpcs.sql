-- AdminTestData.jsx (dev-tool test-data seeder) touches users, question_history,
-- user_weak_topics, flashcards, coaching_centres, and a few tables outside
-- Part A's scope (user_gamification, daily_usage_quota, notification_prefs)
-- with direct table access — all now broken or about to break as each group
-- gets locked down. Routing all of it through admin-checked RPCs in one
-- pass rather than 3 partial ones.

create or replace function public.admin_seed_question_history(p_caller text, p_uids text[], p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  delete from public.question_history where user_id = any(p_uids);

  insert into public.question_history (
    user_id, question_id, question_text, subject, topic, question_type,
    is_correct, source, due_date, ease_factor, interval_days, repetitions, is_mastered
  )
  select
    r->>'user_id', r->>'question_id', r->>'question_text', r->>'subject', r->>'topic',
    r->>'question_type', (r->>'is_correct')::boolean, r->>'source',
    (r->>'due_date')::date, (r->>'ease_factor')::real, (r->>'interval_days')::int,
    (r->>'repetitions')::int, (r->>'is_mastered')::boolean
  from jsonb_array_elements(p_rows) r;
end; $$;

create or replace function public.admin_seed_weak_topics(p_caller text, p_uids text[], p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  delete from public.user_weak_topics where user_id = any(p_uids);

  insert into public.user_weak_topics (user_id, subject, topic, wrong_count, total_attempts, accuracy_pct, last_seen)
  select
    r->>'user_id', r->>'subject', r->>'topic',
    (r->>'wrong_count')::int, (r->>'total_attempts')::int, (r->>'accuracy_pct')::int, (r->>'last_seen')::date
  from jsonb_array_elements(p_rows) r;
end; $$;

-- Generic allowlisted cleanup delete for the "Remove all dummy data" button —
-- restricted to a fixed set of dev-tool-owned tables/columns so this can't
-- become an arbitrary-table-delete backdoor.
create or replace function public.admin_delete_test_rows(p_caller text, p_table text, p_col text, p_values text[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  if p_table not in (
    'question_history', 'user_weak_topics', 'user_gamification',
    'daily_usage_quota', 'flashcards', 'notification_prefs', 'users'
  ) then
    raise exception 'Table not allowed for this operation';
  end if;
  if p_col not in ('user_id', 'firebase_uid') then
    raise exception 'Column not allowed for this operation';
  end if;

  execute format('delete from public.%I where %I = any($1)', p_table, p_col) using p_values;
end; $$;

grant execute on function public.admin_seed_question_history(text, text[], jsonb) to anon;
grant execute on function public.admin_seed_weak_topics(text, text[], jsonb) to anon;
grant execute on function public.admin_delete_test_rows(text, text, text, text[]) to anon;
