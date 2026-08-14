/**
 * Supabase Edge Function: razorpay-webhook
 *
 * Backup activation path for Razorpay payments — NOT the primary trigger.
 * razorpay-verify (client-called, right after Razorpay's checkout.js
 * handler fires) is the primary, already-tested path; this exists to
 * activate a subscription in the rare case the client never gets to make
 * that call at all (browser closed/crashed right after payment, network
 * drop before the handler fires).
 *
 * Hardened 2026-08-14, chasing exactly the gap this comment used to
 * describe: this function used to write straight to `subscriptions` via a
 * raw service-role upsert, trusting `notes.firebase_uid`/`notes.plan_id`
 * read back from the Razorpay entity — no vault-secret gate, no replay
 * protection, a genuinely weaker path than razorpay-verify's. It also had
 * `verify_jwt: true` on the deployed function, which meant Razorpay's own
 * calls (no Supabase JWT to send) were rejected at the platform gateway
 * before this code ever ran — so in practice it was both insecure AND
 * completely unreachable. Now:
 *   - Deployed with --no-verify-jwt (this function's own HMAC signature
 *     check, verifySignature() below, is the real gate — same pattern as
 *     unsubscribe-email/resend-inbound).
 *   - payment.captured routes through the SAME redeem_payment_order ->
 *     activate_subscription calls razorpay-verify uses, both gated on the
 *     same vault secret (ACTIVATE_CALLER_SECRET / activate_caller_secret).
 *     redeem_payment_order flips payment_orders.status 'created'->
 *     'redeemed' exactly once — so if razorpay-verify already claimed this
 *     order (the normal case), this call finds nothing to redeem and
 *     no-ops cleanly. Only ONE of the two paths can ever actually activate
 *     a given order, whichever gets there first. The request's own
 *     notes.firebase_uid/plan_id are never trusted, same reason
 *     razorpay-verify doesn't trust its request body either — the
 *     redeemed order row is the security boundary, not anything the
 *     caller supplied.
 *
 * subscription.activated / subscription.cancelled are handled but
 * deliberately NOT hardened the same way — this app only ever creates
 * Razorpay Orders (create-razorpay-order), never Razorpay Subscription
 * objects, so these two event types cannot fire for real traffic today.
 * Building a service-identity-gated cancel path for an event with no
 * caller would be effort spent on a path nothing can reach. Flagged here,
 * not built — revisit if this app ever adopts Razorpay's Subscriptions API.
 *
 * Deploy:
 *   supabase secrets set RAZORPAY_WEBHOOK_SECRET=whsec_...
 *   supabase functions deploy razorpay-webhook --no-verify-jwt
 *
 * In Razorpay Dashboard → Webhooks:
 *   URL: https://<project>.supabase.co/functions/v1/razorpay-webhook
 *   Events: payment.captured, subscription.activated, subscription.cancelled
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac }   from 'https://deno.land/std@0.177.0/node/crypto.ts';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')            ?? '';
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET  = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')   ?? '';
const ACTIVATE_SECRET = Deno.env.get('ACTIVATE_CALLER_SECRET')    ?? '';

// Duration in days per plan — must match create-razorpay-order/razorpay-verify's
// own copies (this repo doesn't share code between edge functions; kept in
// sync by hand, same as those two already are with each other).
const PLAN_DAYS: Record<string, number> = {
  premium_monthly: 30,
  premium_yearly:  365,
  neet_complete:   1095,
};

function verifySignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false; // fail closed — unconfigured means allow no one
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return expected === signature;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';

  if (!verifySignature(body, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const eventType = event?.event;

    if (eventType === 'payment.captured') {
      const paymentEntity = event?.payload?.payment?.entity;
      const paymentId = paymentEntity?.id;
      const orderId   = paymentEntity?.order_id;

      if (!paymentId || !orderId) {
        console.warn('payment.captured missing payment id or order id — nothing to redeem');
        return new Response(JSON.stringify({ received: true, ignored: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Same claim-once gate razorpay-verify uses. Refusal here is the
      // EXPECTED, normal outcome whenever razorpay-verify already handled
      // this order — not an error, not logged as one.
      const { data: claim, error: claimErr } = await supabase.rpc('redeem_payment_order', {
        p_caller:     ACTIVATE_SECRET,
        p_order_id:   orderId,
        p_payment_id: paymentId,
      });

      if (claimErr || !claim) {
        console.log(`payment.captured: order ${orderId} not redeemable here (already claimed by razorpay-verify, or unknown order) — no action needed`);
        return new Response(JSON.stringify({ received: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      const days      = PLAN_DAYS[claim.plan_id] ?? 30;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const { error: activateErr } = await supabase.rpc('activate_subscription', {
        p_caller:     ACTIVATE_SECRET,
        p_uid:        claim.firebase_uid,
        p_plan:       claim.plan_id,
        p_expires:    expiresAt,
        p_payment_id: paymentId,
        p_amount:     claim.amount_paise ?? 0,
      });

      if (activateErr) {
        console.error('payment.captured: activate_subscription failed after redeeming order', orderId, activateErr);
        // The order is already marked 'redeemed' at this point — a genuine
        // partial-failure state (claimed but not activated). 500 so
        // Razorpay retries the delivery; a retry re-enters this handler,
        // finds the order no longer 'created', and no-ops — which means a
        // failure here needs separate alerting, not webhook retries, to
        // actually get fixed. Logged loudly rather than silently.
        return new Response(JSON.stringify({ error: 'Activation failed after order redeemed — needs manual attention' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`✅ [webhook backup path] Activated ${claim.plan_id} for ${claim.firebase_uid} via payment.captured (order ${orderId})`);

      // Best-effort XP bonus, matching what the old code did — never worth
      // failing activation over.
      try {
        await supabase.rpc('award_xp_atomic', { p_uid: claim.firebase_uid, p_event: 'subscription_upgrade' });
      } catch { /* best-effort, ignore */ }
    }

    // subscription.activated / subscription.cancelled — see file header.
    // Cannot fire for this app's real traffic (Orders only, never Razorpay
    // Subscription objects); logged if they ever do, never acted on.
    if (eventType === 'subscription.activated' || eventType === 'subscription.cancelled') {
      console.warn(`${eventType} received but not handled — this integration only creates Razorpay Orders, never Subscription objects. See this file's header comment.`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('razorpay-webhook error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
