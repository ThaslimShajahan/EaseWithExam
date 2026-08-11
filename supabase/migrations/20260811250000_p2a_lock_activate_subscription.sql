-- P2a — close two LIVE routes to a free subscription.
--
-- Both are exploitable right now with nothing but the public anon key. Neither
-- is the replay bug P2 was scoped around; that one is still gated behind the
-- unset RAZORPAY_KEY_SECRET. These are not gated by anything.
--
-- FINDING 1 — activate_subscription's guard is fail-OPEN
--
--   DECLARE expected TEXT := current_setting('app.subscription_secret', true);
--   IF expected IS NOT NULL AND expected <> '' AND p_caller <> expected THEN
--     RAISE EXCEPTION 'Unauthorized caller';
--   END IF;
--
--   When the setting is absent, `expected` is empty, the condition is false,
--   and execution falls straight through to the INSERT. Measured against
--   production on 2026-08-11: app.subscription_secret is NOT set (length 0),
--   and the function carries both a PUBLIC and an explicit anon EXECUTE grant.
--
--   Proven without writing anything, by calling it as anon with a deliberately
--   invalid p_plan so the NOT NULL constraint would stop the insert:
--
--     activate_subscription('i-am-not-the-secret', 'p2-probe-no-write', NULL, ...)
--       -> 23502  null value in column "plan"
--
--   Reaching 23502 means the guard was skipped. A real plan string in that call
--   would have created an active subscription for any uid, at any duration,
--   with no payment and no signature. It bypasses the subscriptions RLS lockdown
--   too, since SECURITY DEFINER ignores RLS.
--
--   Fixed two ways, because either alone would have been enough and neither is
--   free: the guard now fails CLOSED when unconfigured, and anon/authenticated
--   lose EXECUTE so a browser cannot reach it even if the guard regresses.
--   Nothing in src/ calls it — only razorpay-verify does, with the service key.
--
-- FINDING 2 — the deployed razorpay-webhook is NOT the source in this repo
--
--   Not fixable from a migration; it needs a redeploy. Recorded here because it
--   is the same exposure and was found in the same pass.
--
--   docs/PROJECT_STATUS.md §5 flagged that the webhook once accepted unsigned
--   events, that this was "fixed in source", and that whether the DEPLOYED
--   function matched had never been verified. It does not.
--
--   An unsigned POST to razorpay-webhook returned 500 with
--   "supabase.rpc(...).catch is not a function" — a code path that does not
--   exist in the current source, so the running build predates the fix. It got
--   past the signature check and created a real row:
--
--     user_id = 'probe', plan = 'neet_complete', status = 'active'
--
--   That row was deleted immediately; subscriptions holds only its one
--   legitimate row. Fix: supabase functions deploy razorpay-webhook.

begin;

create or replace function public.activate_subscription(
  p_caller     text,
  p_uid        text,
  p_plan       text,
  p_expires    timestamptz,
  p_payment_id text,
  p_amount     integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  expected text := current_setting('app.subscription_secret', true);
  v_ref    jsonb := null;
begin
  -- FAIL CLOSED. An unconfigured secret used to mean "allow everyone"; it now
  -- means "allow no one". Before payments go live BOTH of these must be set to
  -- the same value, or activation raises here:
  --   ALTER DATABASE postgres SET app.subscription_secret = '<secret>';
  --   supabase secrets set ACTIVATE_CALLER_SECRET=<same secret>
  if expected is null or expected = '' then
    raise exception 'activate_subscription is not configured: app.subscription_secret is unset'
      using errcode = '42501';
  end if;

  if p_caller is null or p_caller <> expected then
    raise exception 'Unauthorized caller' using errcode = '42501';
  end if;

  insert into subscriptions (
    user_id, plan, status, starts_at, expires_at,
    razorpay_payment_id, amount_paid, updated_at
  )
  values (p_uid, p_plan, 'active', now(), p_expires, p_payment_id, p_amount, now())
  on conflict (user_id) do update set
    plan                = excluded.plan,
    status              = 'active',
    starts_at           = now(),
    expires_at          = excluded.expires_at,
    razorpay_payment_id = excluded.razorpay_payment_id,
    amount_paid         = excluded.amount_paid,
    updated_at          = now();

  return json_build_object('ok', true, 'ref', v_ref);
end;
$function$;

-- Second layer: unreachable from a browser regardless of the guard. Only the
-- service role (razorpay-verify) needs it.
revoke execute on function public.activate_subscription(text, text, text, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.activate_subscription(text, text, text, timestamptz, text, integer)
  to service_role;

commit;

-- VERIFY AFTER PUSHING
--   node scripts/audit-payment-paths.mjs
-- Expect: anon call -> 401/permission denied (not 23502), and no new
-- subscriptions rows.
