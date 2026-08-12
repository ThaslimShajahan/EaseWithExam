-- Billing history for Admin, piece 1 of the billing/invoicing work.
--
-- WHY payment_orders AND NOT subscriptions
--
-- `subscriptions` upserts `on conflict (user_id)` — ONE ROW PER USER. A renewal
-- or a second purchase OVERWRITES the previous row's razorpay_payment_id and
-- amount_paid. It is current state, not a ledger, and a billing history built
-- on it would silently lose every payment but the latest.
--
-- `payment_orders` (20260811260000) has order_id as its primary key, so it keeps
-- one row per order for good. It was written to make a payment redeemable
-- exactly once; that same property makes it the only honest source for "who paid
-- what, when".
--
-- WHAT THIS DOES NOT ANSWER, AND MUST NOT BE MISTAKEN FOR
--
-- This is a payment LOG, not a tax invoice and not an accounting record. It has
-- no invoice number, no GSTIN, no tax breakup and no place of supply. Pieces 2-5
-- of the plan in docs/ACTION_ITEMS_FOR_YOU.md cover those, and are deliberately
-- NOT started: whether a GST tax invoice is even the right artefact depends on
-- registration status and on whether the education exemption applies, both of
-- which need a CA's answer first.
--
-- A `created` row is an ABANDONED CHECKOUT, not a payment. The status column is
-- surfaced rather than filtered so that stays visible — a history that showed
-- only redeemed rows would quietly hide every failed or abandoned attempt, which
-- is exactly what you want to see when a student says they were charged.

CREATE OR REPLACE FUNCTION public.admin_list_payments(
  p_caller text,
  p_limit  integer DEFAULT 200
)
RETURNS TABLE (
  order_id     text,
  firebase_uid text,
  plan_id      text,
  amount_paise integer,
  status       text,
  payment_id   text,
  created_at   timestamptz,
  redeemed_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Same two-step gate as every other admin list RPC (P0.5 batch 3): the
  -- verified-identity assertion, then the active-admin check. Both, not either.
  perform assert_verified_admin(p_caller);
  IF NOT EXISTS (
    SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT po.order_id, po.firebase_uid, po.plan_id, po.amount_paise,
           po.status, po.payment_id, po.created_at, po.redeemed_at
      FROM payment_orders po
     ORDER BY po.created_at DESC
     LIMIT greatest(1, least(p_limit, 1000));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_payments(text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_payments(text, integer) TO anon, authenticated;

comment on function public.admin_list_payments(text, integer) is
  'Admin billing history, read from payment_orders. NOT subscriptions, which holds one row per user and loses a payment on renewal. This is a payment log, not a tax invoice: no invoice number, GSTIN, tax breakup or place of supply. Rows with status=created are abandoned checkouts and are returned deliberately so failed attempts stay visible.';
