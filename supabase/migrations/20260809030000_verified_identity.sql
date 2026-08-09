-- Bind admin authorization to a VERIFIED identity.
--
-- Firebase is now registered as a Supabase third-party auth provider, so
-- Supabase validates incoming Firebase ID tokens against Google's JWKS and
-- `auth.jwt() ->> 'sub'` is a proven Firebase UID rather than a string the
-- caller picked. Before this, every admin_* RPC trusted a plain
-- `p_caller text` parameter, and anyone holding the public anon key could
-- call them by supplying a known admin UID.
--
-- Two layers here:
--
--   1. ROLE GATE (broad, applied to every admin_*/coaching_admin_* function).
--      A caller presenting only the anon key gets the `anon` Postgres role; a
--      caller presenting a valid Firebase ID token gets `authenticated`.
--      Revoking anon's EXECUTE therefore makes the entire admin RPC surface
--      unreachable without a real Firebase sign-in. This is the layer that
--      actually closes the anon-key bypass, and it needs no function rewrites.
--
--   2. IDENTITY BINDING (narrow, applied to the most destructive RPCs).
--      Being signed in as *someone* isn't enough for these — p_caller must
--      equal the verified subject, so one signed-in student can't act as an
--      admin by passing an admin's UID. Applied selectively because it means
--      redefining each function; the remaining admin_* RPCs are protected by
--      layer 1 and tracked for follow-up.

begin;

/* ── Helpers ──────────────────────────────────────────────────────────── */

-- The verified Firebase UID for this request, or NULL when the caller
-- presented no token (anon key only).
create or replace function public.verified_uid()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

comment on function public.verified_uid() is
  'Firebase UID proven by the request JWT (third-party auth). NULL for anon-key-only callers.';

-- Raises unless the request carries a verified token whose subject is
-- p_caller AND that subject is an active admin.
create or replace function public.assert_verified_admin(p_caller text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_sub text; v_role text;
begin
  v_sub := verified_uid();
  if v_sub is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;
  if p_caller is null or p_caller <> v_sub then
    -- Someone signed in as A trying to act as B.
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;
  select role into v_role from admins where uid = v_sub and is_active = true;
  if v_role is null or v_role not in ('superadmin', 'admin') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

grant execute on function public.verified_uid()             to anon, authenticated;
grant execute on function public.assert_verified_admin(text) to authenticated;

/* ── Layer 1 — role gate over the whole admin RPC surface ─────────────── */

do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname like 'coaching\_admin\_%')
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('grant  execute on function %s to authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'admin RPC role gate applied to % function(s)', n;
end $$;

-- get_admin_record stays anon-callable: AdminGuard needs it before the admin
-- has completed passcode entry, and it now returns only has_passcode (never
-- the hash) — see 20260809020000. admin_verify_passcode likewise, since it is
-- itself the authentication step and is rate limited.

/* ── Layer 2 — identity binding on the most destructive RPCs ──────────── */

create or replace function public.admin_list_users(p_caller text)
returns setof users
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_verified_admin(p_caller);
  return query select * from users order by created_at desc;
end;
$$;

create or replace function public.admin_delete_student(p_caller text, p_firebase_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_verified_admin(p_caller);

  delete from doubt_messages where chat_id in (select id from doubt_chats where firebase_uid = p_firebase_uid);
  delete from doubt_chats             where firebase_uid = p_firebase_uid;
  delete from centre_student_results  where student_uid  = p_firebase_uid;
  delete from coaching_students       where firebase_uid = p_firebase_uid;
  delete from concept_misconceptions  where user_id      = p_firebase_uid;
  delete from daily_challenge_attempts where user_id     = p_firebase_uid;
  delete from daily_challenge_history where user_id      = p_firebase_uid;
  delete from daily_challenges        where user_id      = p_firebase_uid;
  delete from daily_usage_quota       where user_id      = p_firebase_uid;
  delete from flashcard_progress      where firebase_uid = p_firebase_uid;
  delete from flashcards              where firebase_uid = p_firebase_uid;
  delete from in_app_notifications    where user_id      = p_firebase_uid;
  -- leaderboard_alltime / leaderboard_weekly omitted: views, not tables.
  delete from notification_prefs      where user_id      = p_firebase_uid;
  delete from parent_student_links    where student_uid  = p_firebase_uid;
  delete from question_history        where user_id      = p_firebase_uid;
  delete from quota_overrides         where user_id      = p_firebase_uid;
  delete from referral_codes          where user_id      = p_firebase_uid;
  delete from study_goals             where firebase_uid = p_firebase_uid;
  delete from subscriptions           where user_id      = p_firebase_uid;
  delete from test_sessions           where firebase_uid = p_firebase_uid;
  delete from user_chapter_progress   where user_id      = p_firebase_uid;
  delete from user_daily_tasks        where user_id      = p_firebase_uid;
  delete from user_gamification       where user_id      = p_firebase_uid;
  delete from user_notifications      where user_id      = p_firebase_uid;
  delete from user_weak_topics        where user_id      = p_firebase_uid;
  delete from users                   where firebase_uid = p_firebase_uid;
end;
$$;

grant execute on function public.admin_list_users(text)            to authenticated;
grant execute on function public.admin_delete_student(text, text)  to authenticated;

commit;
