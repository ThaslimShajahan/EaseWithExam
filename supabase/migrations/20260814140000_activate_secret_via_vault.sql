-- Step 5 blocker, root-caused: current_setting('app.subscription_secret', true)
-- was never a viable pattern on HOSTED Supabase. Setting a custom GUC's
-- database-wide default requires `ALTER DATABASE ... SET`, which Postgres
-- restricts to superuser for any parameter it can't verify the GUC_USERSET/
-- GUC_SUSET class of — true for any app-defined `app.*` placeholder that was
-- never registered via a loaded extension / postgresql.conf. Confirmed twice
-- tonight: 42501 permission denied via the CLI's linked connection AND via
-- the Supabase Dashboard SQL Editor — the owner's own dashboard SQL access is
-- NOT superuser on hosted Supabase. No support ticket needed; this was never
-- going to work regardless of which SQL client ran it.
--
-- This project already has the correct hosted-Supabase-native pattern for
-- exactly this need — a secret a SECURITY DEFINER function must read at
-- call time — in send_expiry_reminders() (20260814090000), which reads
-- project_url/anon_key from vault.decrypted_secrets. supabase_vault ships
-- pre-installed on every hosted project and its functions are callable by
-- the ordinary project role (verified: vault.create_secret succeeded here
-- with no privilege error, unlike ALTER DATABASE). That inconsistency —
-- one secret via Vault, a near-identical one via a GUC that could never
-- work on hosted infra — was the actual bug; activate_subscription and
-- redeem_payment_order simply predate send_expiry_reminders() adopting the
-- Vault pattern and were never brought in line with it.
--
-- The secret itself is not in this file (operational state, not schema,
-- same rule as 20260814090000) — already stored via vault.create_secret()
-- ad hoc, named 'activate_caller_secret', matching the value already set as
-- the ACTIVATE_CALLER_SECRET edge function secret. Same value, same fail-
-- closed behaviour, same signatures (CREATE OR REPLACE genuinely replaces
-- in place — verified below), only the read source changes.

create or replace function public.activate_subscription(p_caller text, p_uid text, p_plan text, p_expires timestamp with time zone, p_payment_id text, p_amount integer DEFAULT 0)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  expected text;
  v_ref    jsonb := null;
begin
  select decrypted_secret into expected from vault.decrypted_secrets where name = 'activate_caller_secret';

  -- FAIL CLOSED. An unconfigured secret means "allow no one", never "allow
  -- everyone". Configure it with:
  --   select vault.create_secret('<secret>', 'activate_caller_secret', '...');
  --   supabase secrets set ACTIVATE_CALLER_SECRET=<same secret>
  if expected is null or expected = '' then
    raise exception 'activate_subscription is not configured: vault secret activate_caller_secret is unset'
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

create or replace function public.redeem_payment_order(p_caller text, p_order_id text, p_payment_id text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  expected text;
  v_row    payment_orders;
begin
  select decrypted_secret into expected from vault.decrypted_secrets where name = 'activate_caller_secret';

  -- Fail closed, matching activate_subscription. An unconfigured secret
  -- means "allow no one", never "allow everyone".
  if expected is null or expected = '' then
    raise exception 'redeem_payment_order is not configured: vault secret activate_caller_secret is unset'
      using errcode = '42501';
  end if;
  if p_caller is null or p_caller <> expected then
    raise exception 'Unauthorized caller' using errcode = '42501';
  end if;

  -- The whole replay defence is this one statement. `status = 'created'` in the
  -- WHERE means the second attempt matches no row; RETURNING hands back the
  -- binding recorded at creation so the caller never has to be trusted for it.
  update payment_orders
     set status      = 'redeemed',
         payment_id  = p_payment_id,
         redeemed_at = now()
   where order_id = p_order_id
     and status   = 'created'
  returning * into v_row;

  if not found then
    -- Unknown order, or already redeemed. Deliberately one message: telling a
    -- caller which of the two it was leaks whether an order id exists.
    raise exception 'Order not redeemable' using errcode = '42501';
  end if;

  return json_build_object(
    'firebase_uid', v_row.firebase_uid,
    'plan_id',      v_row.plan_id,
    'amount_paise', v_row.amount_paise
  );
end;
$function$;

-- Self-verifying: confirm exactly one signature of each survives (same
-- overload-safety discipline as every CREATE OR REPLACE tonight).
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM pg_proc
    WHERE proname = 'activate_subscription' AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 activate_subscription signature, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_proc
    WHERE proname = 'redeem_payment_order' AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 redeem_payment_order signature, found %', v_count;
  END IF;
END $$;
