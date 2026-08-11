-- P0.5 batch 5 — the two self-read RPCs that batch 2 missed.
--
-- Found 2026-08-12 while investigating an unrelated "wrong account in the
-- sidebar" report. Both were reachable with nothing but the public anon key:
--
--   get_own_user('<any uid>')
--     -> 200 with id, firebase_uid, auth_method, display_name, email,
--        phone_number, photo_url, onboarding_completed, target_exam, syllabus,
--        class_level, pending_email, pending_email_code_hash,
--        pending_email_requested_at
--
--   get_student_effective_plan('<any uid>')
--     -> 200 "premium_monthly"
--
-- pending_email_code_hash is an email-change verification secret, so this was
-- strictly worse than the five reads closed in 20260811220000 — it leaks the
-- material used to complete an address change, not just the address.
--
-- Same shape as the rest of P0.5: the check lives in the function BODY, not in
-- a grant. Every request to this project arrives as the `anon` Postgres role
-- (Firebase ID tokens carry no `role` claim), so a grant can only choose
-- "everyone" or "nobody" — see 20260811180000, which reverted exactly that
-- mistake after it locked every admin out of production.

------------------------------------------------------------------------------
-- get_own_user
--
-- Was: language sql, `select * from public.users where firebase_uid = p_uid`,
-- with no authorisation of any kind. Becomes plpgsql so it can raise.
--
-- ACCESS RULE: self, or a parent with an active link — deliberately IDENTICAL
-- to get_user_subscription (20260811160000). ParentDashboardPage.jsx reads
-- both for the SAME target uid on the SAME screen (getUser at :185,
-- getUserSubscription at :189); a stricter rule here would make half that page
-- work and the other half 401, which is worse than either outcome alone.
--
-- parent_student_links is empty in production today (0 rows), so the parent
-- branch matches nothing yet and this cannot regress a working path.
------------------------------------------------------------------------------
create or replace function public.get_own_user(p_uid text)
returns public.users
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_caller text;
  v_row    public.users;
begin
  v_caller := public.verified_uid();

  if v_caller is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;

  if p_uid is null then
    raise exception 'Access denied: no subject' using errcode = '42501';
  end if;

  if p_uid <> v_caller and not exists (
    select 1
    from public.parent_student_links l
    where l.student_uid = p_uid
      and l.parent_uid  = v_caller
      and l.is_active   = true
  ) then
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;

  -- No row for this uid returns NULL, exactly as the previous SQL function
  -- did. AuthContext relies on that: a brand-new Firebase user has no `users`
  -- row until upsertUser creates one, and a raise here would break sign-up.
  select * into v_row from public.users where firebase_uid = p_uid;
  return v_row;
end;
$function$;

------------------------------------------------------------------------------
-- get_student_effective_plan
--
-- ACCESS RULE: self only. Narrower than get_own_user on purpose — the only
-- callers are quota.js:84 (always the signed-in user's own uid) and
-- check_and_increment_quota, which passes its own p_uid straight through.
-- Nothing reads another user's plan, so nothing needs to.
--
-- ONE BEHAVIOURAL NOTE, because it is not obvious from the diff:
-- check_and_increment_quota wraps its call in
--     begin ... exception when others then v_plan := 'free'; end
-- so a raise here does NOT surface as an error to that caller — it silently
-- resolves the plan to 'free'. That is the correct failure direction (an
-- unverified caller gets the most restrictive plan, never premium), but it
-- means a transient missing token degrades a premium user to free limits for
-- that one call rather than erroring loudly.
--
-- That same fail-closed behaviour incidentally FIXES a live inconsistency:
-- get_user_subscription (guarded, drives the plan badge) and this function
-- (unguarded, drives the quota numbers) could disagree, producing a UI showing
-- "Free plan" alongside "Unlimited" on every quota. With both guarded, they
-- fail closed together and agree.
------------------------------------------------------------------------------
create or replace function public.get_student_effective_plan(p_uid text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_caller      text;
  v_sub         text;
  v_centre_plan text;
begin
  v_caller := public.verified_uid();

  if v_caller is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;

  if p_uid is null or p_uid <> v_caller then
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;

  -- Body below is unchanged from the original definition.

  -- Personal subscription takes priority
  select plan into v_sub from subscriptions
  where user_id = p_uid and status = 'active'
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_sub is not null and v_sub <> 'free' then return v_sub; end if;

  -- Fall back to coaching centre plan
  select cc.plan into v_centre_plan
  from coaching_students cs
  join coaching_centres cc on cc.id = cs.centre_id
  where cs.firebase_uid = p_uid and cc.status = 'active'
  order by case cc.plan
    when 'enterprise' then 1
    when 'premium'    then 2
    when 'free'       then 3
    else 4
  end
  limit 1;

  if v_centre_plan = 'enterprise' then return 'centre_enterprise'; end if;
  if v_centre_plan = 'premium'    then return 'centre_premium';    end if;
  if v_centre_plan = 'free'       then return 'centre_free';       end if;

  return coalesce(v_sub, 'free');
end;
$function$;
