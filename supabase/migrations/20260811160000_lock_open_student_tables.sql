-- P0.75 — close the wide-open policies on four student tables.
--
-- THE STATE THIS REPLACES
--   RLS was *enabled* on all four, which made them look protected. The
--   policies underneath were literally `true`:
--
--     subscriptions      subscriptions_open        ALL     using(true) check(true)
--     test_sessions      test_sessions_open        ALL     using(true) check(true)
--     daily_usage_quota  "Public read/insert/update quota"  true
--     user_gamification  "Public read/update/upsert gamification"  true
--
--   By contrast users, flashcards, published_tests, question_history,
--   doubt_chats and admins all run RLS with ZERO policies (deny-all, access via
--   SECURITY DEFINER RPCs). These four were the outliers, not the pattern.
--
--   Verified against production on 2026-08-11 with only the public anon key and
--   no login: an INSERT into subscriptions granting `neet_complete` returned
--   201, and the DELETE that removed it again returned 204. That is live
--   privilege escalation plus a destructive primitive, not just disclosure.
--   (The probe row was removed immediately; the table holds one legitimate row.)
--
-- SPLIT BY VERB, NOT BY TABLE
--   Self-scoping SELECT on all four at once would break ~11 admin call sites
--   that read across users, and the RPCs replacing them are P1 work. Writes are
--   where the danger is — escalation, quota reset, XP forgery, forged results —
--   so writes are locked here and the cross-user SELECT on three tables is left
--   permissive until P1 lands the admin RPCs. Each is marked TEMPORARY below.
--
--   subscriptions is the exception: it is fully closed here, because it is the
--   escalation path and its call sites are few enough to migrate in one go.

begin;

/* ══ 1. subscriptions — full lock ═══════════════════════════════════════ */

drop policy if exists subscriptions_open on public.subscriptions;

-- Deliberately NO client policy. RLS with zero policies denies anon and
-- authenticated outright while service_role (razorpay-verify) and
-- SECURITY DEFINER functions still pass through. Reads move to
-- get_user_subscription(), writes to admin_grant_subscription() /
-- activate_subscription().

-- Belt and braces: even a future policy cannot hand out payment credentials if
-- the column privilege is gone. Nothing in the client reads these.
revoke select (razorpay_order_id, razorpay_payment_id, razorpay_signature)
  on public.subscriptions from anon, authenticated;

-- get_user_subscription was SECURITY DEFINER with NO authorisation and
-- returned row_to_json(s) — every column, for any uid the caller named,
-- including razorpay_signature. Locking the table without this would simply
-- move the leak into the RPC.
create or replace function public.get_user_subscription(p_uid text)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare v_sub text;
begin
  v_sub := public.verified_uid();

  if v_sub is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;

  -- Self, or a parent with an active link to this student. The parent case is
  -- real: ParentDashboardPage.jsx:189 reads a linked child's plan, and
  -- self-only enforcement would silently break that screen. Admins go through
  -- admin_list_subscriptions, which carries its own role check.
  if p_uid is null then
    raise exception 'Access denied: no subject' using errcode = '42501';
  end if;

  if p_uid <> v_sub and not exists (
    select 1 from parent_student_links l
    where l.student_uid = p_uid
      and l.parent_uid  = v_sub
      and l.is_active   = true
  ) then
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;

  -- Explicit column list: razorpay_* are never returned to a client.
  return (
    select json_build_object(
      'user_id',    s.user_id,
      'plan',       s.plan,
      'status',     s.status,
      'starts_at',  s.starts_at,
      'expires_at', s.expires_at,
      'amount_paid', s.amount_paid,
      'created_at', s.created_at,
      'updated_at', s.updated_at
    )
    from subscriptions s
    where s.user_id = p_uid
    limit 1
  );
end;
$function$;

-- admin_list_subscriptions returned json_agg(s) — all columns, signatures
-- included. Admins have no use for the signature and it should not sit in a
-- browser tab. Role check is unchanged (identity binding lands in P0.5).
create or replace function public.admin_list_subscriptions(p_caller text)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;

  return (
    select coalesce(json_agg(x order by x.updated_at desc), '[]'::json)
    from (
      select s.user_id, s.plan, s.status, s.starts_at, s.expires_at,
             s.amount_paid, s.created_at, s.updated_at
      from subscriptions s
    ) x
  );
end;
$function$;

/* ══ 2. daily_usage_quota — writes locked, SELECT temporarily open ══════ */

drop policy if exists "Public insert quota" on public.daily_usage_quota;
drop policy if exists "Public update quota" on public.daily_usage_quota;

-- A student may only write their own usage row. This is the quota bypass:
-- previously anyone could reset ai_questions_used to 0 and mine gpt-4o
-- indefinitely at our cost.
create policy quota_self_insert on public.daily_usage_quota
  for insert to authenticated
  with check (user_id = public.verified_uid());

create policy quota_self_update on public.daily_usage_quota
  for update to authenticated
  using (user_id = public.verified_uid())
  with check (user_id = public.verified_uid());

-- TEMPORARY — replaced in P1 by a self-scoped read once AdminOverview,
-- AdminQuota and AdminStudentLookup read through admin RPCs instead.
drop policy if exists "Public read quota" on public.daily_usage_quota;
create policy quota_read_temporary_open on public.daily_usage_quota
  for select using (true);

comment on policy quota_read_temporary_open on public.daily_usage_quota is
  'TEMPORARY (P0.75). Cross-user read kept open only because admin panels still '
  'read this table directly. Replace with user_id = verified_uid() in P1.';

/* ══ 3. user_gamification — writes locked, SELECT temporarily open ══════ */

drop policy if exists "Public update gamification" on public.user_gamification;
drop policy if exists "Public upsert gamification" on public.user_gamification;

create policy gamification_self_insert on public.user_gamification
  for insert to authenticated
  with check (user_id = public.verified_uid());

create policy gamification_self_update on public.user_gamification
  for update to authenticated
  using (user_id = public.verified_uid())
  with check (user_id = public.verified_uid());

-- TEMPORARY — see above. Also note the leaderboard reads the
-- leaderboard_alltime / leaderboard_weekly VIEWS, not this table; those are not
-- in migration history and are deliberately untouched until captured.
drop policy if exists "Public read gamification" on public.user_gamification;
create policy gamification_read_temporary_open on public.user_gamification
  for select using (true);

comment on policy gamification_read_temporary_open on public.user_gamification is
  'TEMPORARY (P0.75). Cross-user read kept open only because AdminStudentLookup '
  'still reads this table directly. Replace with user_id = verified_uid() in P1.';

/* ══ 4. test_sessions — writes locked, SELECT temporarily open ══════════ */

drop policy if exists test_sessions_open on public.test_sessions;

-- Note the column is firebase_uid here, not user_id.
create policy test_sessions_self_insert on public.test_sessions
  for insert to authenticated
  with check (firebase_uid = public.verified_uid());

create policy test_sessions_self_update on public.test_sessions
  for update to authenticated
  using (firebase_uid = public.verified_uid())
  with check (firebase_uid = public.verified_uid());

-- No DELETE policy: nothing in the client deletes sessions, and
-- admin_delete_student removes them through SECURITY DEFINER.

create policy test_sessions_read_temporary_open on public.test_sessions
  for select using (true);

comment on policy test_sessions_read_temporary_open on public.test_sessions is
  'TEMPORARY (P0.75). Cross-user read kept open only because AdminPublishedTests '
  'and AdminStudentLookup still read this table directly. Replace with '
  'firebase_uid = verified_uid() in P1.';

commit;

-- KNOWN BREAKAGE, ACCEPTED
--   Admin > Ops > Test Data (src/admin/AdminTestData.jsx:52,65) upserts
--   user_gamification and daily_usage_quota rows for synthetic TEST_UIDS. Those
--   are cross-user writes and now fail. It is a seeding tool for QA fixtures,
--   not a student-facing path; it moves to an admin RPC in P1.
