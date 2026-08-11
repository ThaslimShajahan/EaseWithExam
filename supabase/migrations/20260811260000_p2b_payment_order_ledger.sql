-- P2b — make a payment redeemable exactly once, for exactly the account and
-- plan it was created for.
--
-- WHAT razorpay-verify DOES TODAY
--   It verifies the HMAC over `order_id|payment_id` and then calls
--   activate_subscription with the firebase_uid, plan_id and amount taken
--   straight from the REQUEST BODY. The signature proves the payment is real.
--   It proves nothing about who it was for.
--
--   Three consequences, all from the same root:
--     1. Replay      — nothing records that a payment was already used, so one
--                      valid triple can be submitted repeatedly.
--     2. Redirection — firebase_uid is caller-supplied, so a valid triple can
--                      be redeemed onto any account.
--     3. Escalation  — plan_id is caller-supplied, so a 399-rupee payment can
--                      claim neet_complete (1095 days).
--
--   And the triple is not secret: subscriptions stored razorpay_signature and
--   was anon-readable until P0.75 closed it.
--
--   Not exploitable today only because RAZORPAY_KEY_SECRET is unset, so the
--   HMAC check fails everything. It opens the moment that secret is set, which
--   is why this has to land first.
--
-- THE FIX
--   create-razorpay-order already puts firebase_uid and plan_id into the
--   Razorpay order's `notes`, so the binding exists — it is simply never
--   consulted. This records the same binding locally at creation, and makes
--   redemption a single atomic UPDATE that both claims the order and returns
--   the values to act on. razorpay-verify then uses THOSE, never the body.
--
--   The atomicity matters: `where status = 'created' returning ...` means two
--   concurrent redemptions of the same order cannot both win. Checking first
--   and updating second would leave exactly that race.

begin;

create table if not exists public.payment_orders (
  order_id     text primary key,              -- Razorpay order id
  firebase_uid text        not null,
  plan_id      text        not null,
  amount_paise integer     not null,
  status       text        not null default 'created'
                 check (status in ('created', 'redeemed')),
  payment_id   text,                          -- set when redeemed
  created_at   timestamptz not null default now(),
  redeemed_at  timestamptz
);

comment on table public.payment_orders is
  'Server-side record of every Razorpay order, written at creation. The row is '
  'the authority on which account and plan a payment belongs to; razorpay-verify '
  'reads it rather than trusting its request body. Redeeming flips status to '
  'redeemed in the same statement that reads it, so a payment cannot be replayed.';

create index if not exists payment_orders_uid_idx on public.payment_orders (firebase_uid);

-- No client policy: RLS on with zero policies denies anon and authenticated
-- outright, while service_role (the edge functions) and SECURITY DEFINER pass
-- through. Same shape as subscriptions after P0.75.
alter table public.payment_orders enable row level security;

/* ── Redemption: claim and read in one statement ─────────────────────── */

create or replace function public.redeem_payment_order(
  p_caller     text,
  p_order_id   text,
  p_payment_id text
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  expected text := current_setting('app.subscription_secret', true);
  v_row    payment_orders;
begin
  -- Fail closed, matching activate_subscription after P2a. An unconfigured
  -- secret means "allow no one", never "allow everyone".
  if expected is null or expected = '' then
    raise exception 'redeem_payment_order is not configured: app.subscription_secret is unset'
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

-- Reachable only by the edge functions.
revoke execute on function public.redeem_payment_order(text, text, text) from public, anon, authenticated;
grant  execute on function public.redeem_payment_order(text, text, text) to service_role;

commit;

-- VERIFY AFTER PUSHING
--   node scripts/audit-payment-paths.mjs --include-webhook   (still PASS)
--   node scripts/audit-replay-protection.mjs                 (new)
--
-- STILL REQUIRED BEFORE PAYMENTS GO LIVE
--   ALTER DATABASE postgres SET app.subscription_secret = '<secret>';
--   supabase secrets set ACTIVATE_CALLER_SECRET=<same secret>
--   supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=...
--   supabase functions deploy create-razorpay-order razorpay-verify
--   feature flag payments_enabled -> true
