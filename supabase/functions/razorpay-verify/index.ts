/**
 * Supabase Edge Function: razorpay-verify
 *
 * Called by the client after Razorpay payment.handler() fires.
 * Verifies the HMAC-SHA256 signature server-side, then calls
 * the activate_subscription RPC to unlock the student's plan.
 *
 * Request body (JSON):
 *   {
 *     razorpay_order_id:   string,
 *     razorpay_payment_id: string,
 *     razorpay_signature:  string,
 *     firebase_uid:        string,
 *     plan_id:             string,
 *     amount_paid:         number   // paise
 *   }
 *
 * Deploy:
 *   supabase secrets set RAZORPAY_KEY_SECRET=rzp_... ACTIVATE_CALLER_SECRET=some-long-secret
 *   supabase functions deploy razorpay-verify
 */

import { serve }       from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac }   from 'https://deno.land/std@0.177.0/node/crypto.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')           ?? '';
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RAZORPAY_SECRET   = Deno.env.get('RAZORPAY_KEY_SECRET')    ?? '';
const ACTIVATE_SECRET   = Deno.env.get('ACTIVATE_CALLER_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PLAN_DAYS: Record<string, number> = {
  premium_monthly: 30,
  premium_yearly:  365,
  // Was 365 — the plan is now sold and displayed as "3 years access", not
  // "Lifetime (never expires)"; this must match what the checkout page and
  // pricing cards actually claim. See src/lib/subscription.js.
  neet_complete:   1095,
};

function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!RAZORPAY_SECRET) return false;
  const payload  = `${orderId}|${paymentId}`;
  const expected = createHmac('sha256', RAZORPAY_SECRET).update(payload).digest('hex');
  return expected === signature;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  let body: {
    razorpay_order_id:   string;
    razorpay_payment_id: string;
    razorpay_signature:  string;
    firebase_uid:        string;
    plan_id:             string;
    amount_paid?:        number;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firebase_uid, plan_id, amount_paid } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !firebase_uid || !plan_id) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Verify Razorpay signature
  const valid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Payment signature verification failed' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Claim the order. This is the security boundary, not the signature above.
  //
  // The HMAC proves the payment is real; it says nothing about WHO it was for.
  // Previously firebase_uid, plan_id and amount_paid were taken from the request
  // body, so one valid triple could be replayed indefinitely, redeemed onto any
  // account, and upgraded to any plan. redeem_payment_order flips the row to
  // 'redeemed' in the same statement that reads it, so a second attempt matches
  // nothing, and it returns the binding recorded when the order was created.
  //
  // Everything below uses those values. The body's copies are ignored.
  const { data: claim, error: claimErr } = await supabase.rpc('redeem_payment_order', {
    p_caller:     ACTIVATE_SECRET,
    p_order_id:   razorpay_order_id,
    p_payment_id: razorpay_payment_id,
  });

  if (claimErr || !claim) {
    // Already redeemed, unknown order, or the shared secret is unset. All are
    // refusals; the RPC deliberately does not distinguish them to the caller.
    console.error('redeem_payment_order refused:', claimErr);
    return new Response(JSON.stringify({ error: 'Order not redeemable' }), {
      status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (claim.firebase_uid !== firebase_uid || claim.plan_id !== plan_id) {
    // Not fatal — the stored values win either way — but a mismatch means the
    // client sent something the order does not agree with, which is worth
    // seeing in the logs.
    console.warn(
      `payload/order mismatch on ${razorpay_order_id}: ` +
      `body(${firebase_uid}, ${plan_id}) vs order(${claim.firebase_uid}, ${claim.plan_id})`,
    );
  }

  const days      = PLAN_DAYS[claim.plan_id] ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.rpc('activate_subscription', {
    p_caller:    ACTIVATE_SECRET,
    p_uid:       claim.firebase_uid,
    p_plan:      claim.plan_id,
    p_expires:   expiresAt,
    p_payment_id:razorpay_payment_id,
    p_amount:    claim.amount_paise ?? 0,
  });

  if (error) {
    console.error('activate_subscription error:', error);
    return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Report what was actually activated, which is the order's binding — not the
  // body's copy. Logging the request's version here would have made a
  // redirected redemption look correct in the logs.
  console.log(`✅ Payment verified and subscription activated: ${claim.plan_id} for ${claim.firebase_uid}`);
  return new Response(
    JSON.stringify({ success: true, plan_id: claim.plan_id, firebase_uid: claim.firebase_uid }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
