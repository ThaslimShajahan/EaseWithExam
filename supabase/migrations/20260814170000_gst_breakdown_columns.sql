-- GST now applies exclusive/on-top of the listed price (owner confirmed
-- with their CA, 2026-08-14 — resolves the open question tracked in
-- docs/ACTION_ITEMS_FOR_YOU.md). create-razorpay-order becomes the single
-- authoritative place that computes base + GST = total and charges the
-- total; every downstream consumer (razorpay-verify's receipt send, this
-- order's own record) must read what was ACTUALLY computed and charged at
-- creation time, not re-derive it later from whatever the tax rate happens
-- to be at verification time (which could theoretically differ if an admin
-- edits platform_settings.tax_rate_percent between order creation and
-- payment — a short window, but a financial record should never depend on
-- "the rate hadn't changed yet").
--
-- amount_paise (existing column) keeps meaning what it already means: the
-- total, i.e. what create-razorpay-order actually sends to Razorpay and
-- what activate_subscription actually records — unchanged by this
-- migration, still the number every existing reader already trusts.
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS base_amount_paise integer,
  ADD COLUMN IF NOT EXISTS gst_amount_paise  integer NOT NULL DEFAULT 0;
-- base_amount_paise nullable, not defaulted: NULL on every pre-existing row
-- (including tonight's own real test payments) means "created before GST
-- breakdown tracking existed", which is honest — backfilling a base/GST
-- split onto a payment that was actually charged as one flat number would
-- be inventing a number, not recording one. gst_amount_paise defaults to 0
-- for the same rows, which is also literally true: nothing beyond the flat
-- amount was actually collected on them.

-- redeem_payment_order must return the new fields alongside the existing
-- three so razorpay-verify can build the receipt breakdown from what was
-- actually charged, not recompute it. Same signature, same fail-closed
-- vault-secret check as the 2026-08-14 fix earlier tonight — only the
-- RETURNS shape (still `json`, so no signature change) and the final
-- json_build_object change.
CREATE OR REPLACE FUNCTION public.redeem_payment_order(p_caller text, p_order_id text, p_payment_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  expected text;
  v_row    payment_orders;
BEGIN
  SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name = 'activate_caller_secret';

  IF expected IS NULL OR expected = '' THEN
    RAISE EXCEPTION 'redeem_payment_order is not configured: vault secret activate_caller_secret is unset'
      USING errcode = '42501';
  END IF;
  IF p_caller IS NULL OR p_caller <> expected THEN
    RAISE EXCEPTION 'Unauthorized caller' USING errcode = '42501';
  END IF;

  UPDATE payment_orders
     SET status      = 'redeemed',
         payment_id  = p_payment_id,
         redeemed_at = now()
   WHERE order_id = p_order_id
     AND status   = 'created'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not redeemable' USING errcode = '42501';
  END IF;

  RETURN json_build_object(
    'firebase_uid',      v_row.firebase_uid,
    'plan_id',           v_row.plan_id,
    'amount_paise',      v_row.amount_paise,
    'base_amount_paise', v_row.base_amount_paise,
    'gst_amount_paise',  v_row.gst_amount_paise
  );
END;
$function$;

-- Self-verifying: confirm exactly one signature survives.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM pg_proc
    WHERE proname = 'redeem_payment_order' AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 redeem_payment_order signature, found %', v_count;
  END IF;
END $$;
