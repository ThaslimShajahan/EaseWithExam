-- Security pass 2, Part A: edge functions stop trusting caller_uid.
--
-- FOUND 2026-09-25 (proven live with non-delivering probes):
--   * send-email / send-push authorised a "self-send" when body caller_uid ==
--     body user_id — both caller-supplied. A forged self-send passed auth
--     (HTTP 200, stopped only because the probe uid had no email).
--   * Broadcasts were gated on caller_uid being an active admin, and an active
--     admin uid is anon-readable (chapter_manifests.approved_by; hidden in
--     Part C) — so anyone could email/push every student.
--   * whatsapp-alert single-send had no check at all (disabled in this pass).
--   * exam-scraper / connect-email / pdf-proxy trusted caller_uid or nothing.
--
-- The fix, in the functions (supabase/functions/_shared/caller.ts): a caller
-- is either
--   internal  — Authorization: Bearer <service role key> (razorpay-verify /
--               razorpay-webhook already send this), or header
--               x-internal-secret matching the INTERNAL_CALL_SECRET function
--               secret (used by this DB's own cron, below);
--   a user    — header x-firebase-id-token, verified by Supabase exactly as
--               for every RPC, via whoami_verified() below.
-- The body's caller_uid is ignored everywhere.
--
-- The internal secret itself lives in vault ('internal_call_secret') and as the
-- INTERNAL_CALL_SECRET function secret. It is set out-of-band at deploy time
-- and NEVER appears in a migration, a log or the repo.
--
-- Rollback: supabase/rollback/20260926000000_rollback.sql (restores the old
-- send_expiry_reminders; redeploy the previous function versions first).

-- The verified identity behind a Firebase ID token. Called by edge functions
-- with the caller's token forwarded, so verified_uid() is Supabase's own check.
create or replace function public.whoami_verified()
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare v_uid text; v_role text;
begin
  v_uid := public.verified_uid();
  if v_uid is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;
  select role into v_role from public.admins where uid = v_uid and is_active = true;
  return json_build_object('uid', v_uid, 'admin_role', v_role);
end;
$$;

revoke execute on function public.whoami_verified() from public;
grant execute on function public.whoami_verified() to anon, authenticated, service_role;

-- send_expiry_reminders: identical logic, but it now proves it is the platform
-- (x-internal-secret) instead of relying on send-email trusting caller_uid.
CREATE OR REPLACE FUNCTION public.send_expiry_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_url  text;
  v_key  text;
  v_internal text;
  v_days int;
  v_target_stage int;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'anon_key';
  -- Proves to send-email that this is the platform itself (not a browser
  -- claiming a caller_uid). Set out-of-band; never in a migration.
  select decrypted_secret into v_internal from vault.decrypted_secrets where name = 'internal_call_secret';
  if v_url is null or v_key is null or v_internal is null then
    -- Fail loudly into the Postgres log rather than silently sending nothing —
    -- a missing vault secret is a deploy/ops mistake, not a "no reminders due
    -- today" case, and the two must not look identical from outside.
    raise warning 'send_expiry_reminders: vault secrets missing (project_url=%, anon_key=%, internal_call_secret=%) — no reminders sent this run', (v_url is not null), (v_key is not null), (v_internal is not null);
    return;
  end if;

  -- ── Subscriptions: EMAIL ONLY, single touch, same window expire_subscriptions() already reminds in-app for ──
  for r in
    select user_id, plan, expires_at from subscriptions
     where status = 'active'
       and expires_at is not null
       and expires_at between now() and now() + interval '3 days'
       and reminder_stage = 0
  loop
    perform net.http_post(
      url     := v_url || '/functions/v1/send-email',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'x-internal-secret',v_internal),
      body    := jsonb_build_object(
        'caller_uid', r.user_id, 'user_id', r.user_id, 'template', 'subscription_expiring',
        'data', jsonb_build_object(
          'planName', r.plan,
          'daysLeft', greatest(0, floor(extract(epoch from (r.expires_at - now())) / 86400))::int,
          'expiryDate', to_char(r.expires_at, 'DD Mon YYYY')
        )
      )
    );
    update subscriptions set reminder_stage = 1 where user_id = r.user_id;
  end loop;

  -- ── Quota grants: full 3-stage, EMAIL + IN-APP, pure net-new ──
  for r in
    select user_id, expires_at, reason, reminder_stage as stage_before from quota_overrides
     where expires_at is not null and expires_at > now() - interval '1 day'
     -- the lower bound excludes grants that expired more than a day ago —
     -- nothing to remind about a grant nobody will look at again; the loop
     -- below still recomputes target_stage per-row from the real expiry.
  loop
    v_days := floor(extract(epoch from (r.expires_at - now())) / 86400)::int;
    v_target_stage := case
      when v_days <= 0 then 3
      when v_days = 1  then 2
      when v_days <= 3 then 1
      else 0
    end;

    continue when v_target_stage <= r.stage_before;  -- nothing new to say this run

    insert into user_notifications (user_id, type, title, body, link, read, created_at)
    values (
      r.user_id, 'subscription_active',
      case when v_days <= 0 then 'Your bonus access ends today'
           else 'Your bonus access is ending soon' end,
      case when v_days <= 0 then 'Your extra quota grant ends today. You will revert to your normal plan limits.'
           else 'Your extra quota grant ends in ' || v_days || ' day(s) ('
                || to_char(r.expires_at, 'DD Mon YYYY') || '). You will revert to your normal plan limits after that.' end,
      '/profile', false, now()
    );

    perform net.http_post(
      url     := v_url || '/functions/v1/send-email',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'x-internal-secret',v_internal),
      body    := jsonb_build_object(
        'caller_uid', r.user_id, 'user_id', r.user_id, 'template', 'subscription_expiring',
        'data', jsonb_build_object(
          'planName', coalesce('Bonus access (' || r.reason || ')', 'Your bonus access'),
          'daysLeft', greatest(0, v_days),
          'expiryDate', to_char(r.expires_at, 'DD Mon YYYY')
        )
      )
    );

    update quota_overrides set reminder_stage = v_target_stage where user_id = r.user_id;
  end loop;
end;
$function$
;

-- Only the cron (as postgres) runs these. Both are idempotent (reminder_stage),
-- but nothing outside the platform needs to trigger them.
revoke execute on function public.send_expiry_reminders() from public, anon, authenticated;
revoke execute on function public.expire_subscriptions()  from public, anon, authenticated;
