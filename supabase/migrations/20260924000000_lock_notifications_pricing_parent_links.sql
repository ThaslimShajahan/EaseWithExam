-- Close five wide-open tables and give create-razorpay-order a verified
-- identity + server-side payments gate.
--
-- FOUND 2026-09-24, PROVEN LIVE WITH THE PUBLIC ANON KEY AND NO LOGIN:
--   notification_prefs    SELECT 200 (3/3 rows: phone_number, whatsapp_number,
--                         push endpoint/keys, FCM tokens); INSERT 23502
--   user_notifications    SELECT 200 (49/49 rows); INSERT 23502; on the
--                         supabase_realtime publication, so any client could
--                         subscribe to every student's notification inserts
--   exam_notifications    INSERT 23502
--   plan_config           INSERT 23502. create-razorpay-order charges
--                         plan_config.price_paise when > 0, so anyone could
--                         set any plan's price (e.g. ₹1) and buy it.
--   parent_student_links  INSERT 23502. get_own_user() grants read access to a
--                         student's profile when a link row names the caller
--                         as parent_uid, so anyone could self-authorise.
-- "INSERT 23502" = a NULL into a NOT NULL column was rejected only by the
-- NOT NULL constraint, i.e. the write itself was permitted. The control table
-- (users) correctly returned 42501 for the same probe. Nothing was written.
--
-- Every request in this project arrives as the `anon` role (Firebase tokens
-- carry no role claim — see project memory / 20260811180000), so role grants
-- cannot tell a student from an admin. The gate is always the function body:
-- assert_verified_self(p_uid) or assert_verified_admin(p_caller). Grants below
-- follow 20260815050000: revoke PUBLIC, grant the three API roles explicitly.
--
-- UNAFFECTED BY DESIGN: every existing SECURITY DEFINER function that touches
-- these tables (send_expiry_reminders, expire_subscriptions, complete_referral,
-- set_email_enabled, admin_delete_student, admin_delete_test_rows,
-- get_own_user, get_user_subscription, admin_upsert_plan_config) runs as the
-- table owner and bypasses RLS; every edge function uses the service role.
--
-- BREAKING for the currently-deployed bundle (it reads/writes these tables
-- directly). Ship the matching frontend in the same window — see DEPLOY.md
-- "When a deploy is paired with a migration". Rollback:
-- supabase/rollback/20260924000000_rollback.sql (bundle first, then SQL).

-- ═════════════════════════════════════════════════════════════════════════
-- 1. user_notifications — own rows only; admins send via admin_* RPCs
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists "allow all" on public.user_notifications;
revoke all on public.user_notifications from anon, authenticated;
-- RLS stays enabled with no policies: deny-all for direct access.

-- Off Realtime: a postgres_changes subscription is authorised by RLS, and
-- nothing proves Realtime evaluates verified_uid() for a Firebase token. The
-- bell now polls get_own_user_notifications instead (frontend, same deploy).
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'user_notifications') then
    alter publication supabase_realtime drop table public.user_notifications;
  end if;
end $$;

-- Shared input validation for every writer below.
create or replace function public._check_user_notification_fields(
  p_type text, p_title text, p_body text, p_link text
) returns void
language plpgsql immutable
set search_path = public
as $$
begin
  if p_type is null or length(p_type) = 0 or length(p_type) > 50 then
    raise exception 'Invalid notification type' using errcode = '22023';
  end if;
  if p_title is null or length(p_title) = 0 or length(p_title) > 200 then
    raise exception 'Invalid notification title' using errcode = '22023';
  end if;
  if p_body is null or length(p_body) > 2000 then
    raise exception 'Invalid notification body' using errcode = '22023';
  end if;
  -- In-app paths only. A notification link is rendered as a navigation
  -- target; an off-site URL there is a phishing surface.
  if p_link is not null and (p_link !~ '^/' or p_link ~ '^//' or length(p_link) > 500) then
    raise exception 'Invalid notification link' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.get_own_user_notifications(p_uid text, p_limit integer default 30)
returns setof public.user_notifications
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  return query
    select * from public.user_notifications
     where user_id = p_uid
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- A student may only ever notify themselves (all 18 client call sites do).
create or replace function public.create_own_user_notification(
  p_uid text, p_type text, p_title text, p_body text, p_link text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.assert_verified_self(p_uid);
  perform public._check_user_notification_fields(p_type, p_title, p_body, p_link);
  -- Self-only, so abuse can only bloat the caller's own feed; still cap it.
  if (select count(*) from public.user_notifications
       where user_id = p_uid and created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Notification rate limit exceeded' using errcode = '54000';
  end if;
  insert into public.user_notifications (user_id, type, title, body, link)
  values (p_uid, p_type, p_title, coalesce(p_body, ''), p_link)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.mark_own_user_notification_read(p_uid text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  update public.user_notifications set read = true where id = p_id and user_id = p_uid;
end;
$$;

create or replace function public.mark_all_own_user_notifications_read(p_uid text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  update public.user_notifications set read = true where user_id = p_uid and read = false;
end;
$$;

create or replace function public.delete_own_user_notification(p_uid text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  delete from public.user_notifications where id = p_id and user_id = p_uid;
end;
$$;

create or replace function public.delete_all_own_user_notifications(p_uid text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_uid);
  delete from public.user_notifications where user_id = p_uid;
end;
$$;

create or replace function public.admin_send_user_notification(
  p_caller text, p_user_id text, p_type text, p_title text, p_body text, p_link text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.assert_verified_admin(p_caller);
  perform public._check_user_notification_fields(p_type, p_title, p_body, p_link);
  if p_user_id is null or not exists (select 1 from public.users where firebase_uid = p_user_id) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;
  insert into public.user_notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, coalesce(p_body, ''), p_link)
  returning id into v_id;
  return v_id;
end;
$$;

-- Replaces the client-side loop (fetch every uid, insert in batches of 200)
-- with one server-side insert.
create or replace function public.admin_broadcast_user_notification(
  p_caller text, p_type text, p_title text, p_body text, p_link text default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public.assert_verified_admin(p_caller);
  perform public._check_user_notification_fields(p_type, p_title, p_body, p_link);
  insert into public.user_notifications (user_id, type, title, body, link)
  select firebase_uid, p_type, p_title, coalesce(p_body, ''), p_link from public.users;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. notification_prefs — own row only
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists notif_prefs_open on public.notification_prefs;
revoke all on public.notification_prefs from anon, authenticated;

create or replace function public.get_own_notification_prefs(p_uid text)
returns public.notification_prefs
language plpgsql stable security definer
set search_path = public
as $$
declare v_row public.notification_prefs;
begin
  perform public.assert_verified_self(p_uid);
  select * into v_row from public.notification_prefs where user_id = p_uid;
  return v_row;  -- NULL when no row yet, same as the old .maybeSingle()
end;
$$;

-- Whitelist = exactly the columns the app writes today (notifications.js,
-- NotificationSettings.jsx). Any other key is refused, not ignored, so a new
-- caller can't silently lose a field. A key that is present sets the column
-- (including to null — disablePush clears the push subscription); an absent
-- key leaves it unchanged.
create or replace function public.upsert_own_notification_prefs(p_uid text, p_fields jsonb)
returns public.notification_prefs
language plpgsql security definer
set search_path = public
as $$
declare
  v_allowed text[] := array['push_enabled','push_endpoint','push_p256dh','push_auth',
                            'push_fcm_token','email_enabled','whatsapp_enabled','daily_reminder'];
  v_bad  text;
  v_row  public.notification_prefs;
begin
  perform public.assert_verified_self(p_uid);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'p_fields must be a JSON object' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_object_keys(p_fields) k where k <> all (v_allowed) limit 1;
  if v_bad is not null then
    raise exception 'Field not allowed: %', v_bad using errcode = '22023';
  end if;

  insert into public.notification_prefs as np (
    user_id, push_enabled, push_endpoint, push_p256dh, push_auth, push_fcm_token,
    email_enabled, whatsapp_enabled, daily_reminder, updated_at
  ) values (
    p_uid,
    (p_fields->>'push_enabled')::boolean, p_fields->>'push_endpoint', p_fields->>'push_p256dh',
    p_fields->>'push_auth', p_fields->>'push_fcm_token',
    (p_fields->>'email_enabled')::boolean, (p_fields->>'whatsapp_enabled')::boolean,
    (p_fields->>'daily_reminder')::time, now()
  )
  on conflict (user_id) do update set
    push_enabled     = case when p_fields ? 'push_enabled'     then excluded.push_enabled     else np.push_enabled     end,
    push_endpoint    = case when p_fields ? 'push_endpoint'    then excluded.push_endpoint    else np.push_endpoint    end,
    push_p256dh      = case when p_fields ? 'push_p256dh'      then excluded.push_p256dh      else np.push_p256dh      end,
    push_auth        = case when p_fields ? 'push_auth'        then excluded.push_auth        else np.push_auth        end,
    push_fcm_token   = case when p_fields ? 'push_fcm_token'   then excluded.push_fcm_token   else np.push_fcm_token   end,
    email_enabled    = case when p_fields ? 'email_enabled'    then excluded.email_enabled    else np.email_enabled    end,
    whatsapp_enabled = case when p_fields ? 'whatsapp_enabled' then excluded.whatsapp_enabled else np.whatsapp_enabled end,
    daily_reminder   = case when p_fields ? 'daily_reminder'   then excluded.daily_reminder   else np.daily_reminder   end,
    updated_at       = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. exam_notifications — public read of active rows; admin-only writes
--    (exam-scraper writes with the service role and is unaffected)
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists exam_notifications_open on public.exam_notifications;
revoke all on public.exam_notifications from anon, authenticated;
grant select on public.exam_notifications to anon, authenticated;
drop policy if exists exam_notifications_read_active on public.exam_notifications;
create policy exam_notifications_read_active on public.exam_notifications
  for select using (is_active = true);

create or replace function public.admin_deactivate_exam_notification(p_caller text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_admin(p_caller);
  update public.exam_notifications set is_active = false where id = p_id;
end;
$$;

create or replace function public.admin_clear_exam_notifications(p_caller text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_n integer;
begin
  perform public.assert_verified_admin(p_caller);
  delete from public.exam_notifications where true;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. plan_config — public read (pricing page), writes only via the existing
--    admin_upsert_plan_config (assert_verified_admin)
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists "Public upsert plan_config" on public.plan_config;
revoke all on public.plan_config from anon, authenticated;
grant select on public.plan_config to anon, authenticated;
-- "Public read plan_config" (SELECT, true) is kept deliberately.

-- ═════════════════════════════════════════════════════════════════════════
-- 5. parent_student_links — locked, no replacement RPCs. The parent feature
--    stays disabled (owner decision 2026-09-24) until it is rebuilt with
--    expiring single-use links and student-visible, removable parent links.
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists psl_all_open on public.parent_student_links;
revoke all on public.parent_student_links from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. payment_order_preflight — the identity + gate check for
--    create-razorpay-order. The edge function forwards the caller's Firebase
--    ID token, so verified_uid() here is the same verified identity every
--    other RPC uses; the request body's firebase_uid is no longer trusted.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.payment_order_preflight(p_plan_id text)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare v_uid text; v_price integer;
begin
  v_uid := public.verified_uid();
  if v_uid is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;
  -- Fail closed: a missing flag row reads as closed, same as the frontend.
  if not coalesce((select enabled from public.feature_flags where key = 'payments_enabled'), false) then
    raise exception 'Payments are closed' using errcode = '42501';
  end if;
  if p_plan_id = 'verification_1rs' and not public.is_active_superadmin(v_uid) then
    -- Same non-distinguishing refusal as an unknown plan.
    raise exception 'Invalid plan_id' using errcode = '22023';
  end if;
  -- Only rows written through admin_upsert_plan_config can exist once this
  -- migration has revoked direct writes.
  select price_paise into v_price from public.plan_config
   where plan_id = p_plan_id and coalesce(active, true) and price_paise > 0;
  return json_build_object('uid', v_uid, 'price_override_paise', v_price);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════
revoke execute on function public._check_user_notification_fields(text, text, text, text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.get_own_user_notifications(text, integer)',
    'public.create_own_user_notification(text, text, text, text, text)',
    'public.mark_own_user_notification_read(text, uuid)',
    'public.mark_all_own_user_notifications_read(text)',
    'public.delete_own_user_notification(text, uuid)',
    'public.delete_all_own_user_notifications(text)',
    'public.admin_send_user_notification(text, text, text, text, text, text)',
    'public.admin_broadcast_user_notification(text, text, text, text, text)',
    'public.get_own_notification_prefs(text)',
    'public.upsert_own_notification_prefs(text, jsonb)',
    'public.admin_deactivate_exam_notification(text, uuid)',
    'public.admin_clear_exam_notifications(text)',
    'public.payment_order_preflight(text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
