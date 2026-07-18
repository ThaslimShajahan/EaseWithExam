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
  neet_complete:   365,
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

  // Activate subscription via SECURITY DEFINER RPC
  const supabase  = createClient(SUPABASE_URL, SERVICE_KEY);
  const days      = PLAN_DAYS[plan_id] ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.rpc('activate_subscription', {
    p_caller:    ACTIVATE_SECRET,
    p_uid:       firebase_uid,
    p_plan:      plan_id,
    p_expires:   expiresAt,
    p_payment_id:razorpay_payment_id,
    p_amount:    amount_paid ?? 0,
  });

  if (error) {
    console.error('activate_subscription error:', error);
    return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  console.log(`✅ Payment verified and subscription activated: ${plan_id} for ${firebase_uid}`);
  return new Response(JSON.stringify({ success: true, plan_id, firebase_uid }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
