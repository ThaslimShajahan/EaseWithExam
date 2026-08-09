// Supabase Edge Function: create-razorpay-order
//
// Creates a Razorpay Order server-side, resolving the charge amount from the
// database (never trusting a client-supplied amount). This closes the gap where
// the client previously opened Razorpay Checkout with a self-reported amount and
// wrote directly to `subscriptions` afterward with no server verification at all.
//
// Flow: client calls this function → gets back a real order_id + amount →
// opens Razorpay Checkout with that order_id → on success, client calls
// razorpay-verify (HMAC signature check + activate_subscription RPC), never
// writes to `subscriptions` directly.
//
// Deploy:
//   supabase secrets set RAZORPAY_KEY_ID=rzp_... RAZORPAY_KEY_SECRET=...
//   supabase functions deploy create-razorpay-order

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')            ?? '';
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')          ?? '';
const RAZORPAY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')      ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Server-side source of truth for plan amounts — mirrors src/lib/subscription.js's
// PLANS catalogue. Kept in sync manually since this function can't import client code.
const PLAN_AMOUNTS_PAISE: Record<string, number> = {
  premium_monthly: 39900,
  premium_yearly:  399900,
  neet_complete:   499900,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (!RAZORPAY_KEY_ID || !RAZORPAY_SECRET) {
    return json(500, { error: 'Razorpay credentials not configured' });
  }

  let body: { plan_id?: string; firebase_uid?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { plan_id, firebase_uid } = body;
  if (!plan_id || !firebase_uid) return json(400, { error: 'Missing plan_id or firebase_uid' });

  // Admin-set price (Admin > Pricing) takes priority over the hardcoded catalogue,
  // matching the same precedence the client used to apply itself.
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: cfg } = await supabase
    .from('plan_config')
    .select('price_paise')
    .eq('plan_id', plan_id)
    .maybeSingle();

  const amount = cfg?.price_paise > 0 ? cfg.price_paise : PLAN_AMOUNTS_PAISE[plan_id];
  if (!amount) return json(400, { error: 'Invalid plan_id' });

  const receipt = `${plan_id}_${firebase_uid.slice(0, 16)}_${Date.now()}`;

  const rzRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_SECRET}`)}`,
    },
    body: JSON.stringify({
      amount,
      currency: 'INR',
      receipt,
      notes: { firebase_uid, plan_id },
    }),
  });

  const order = await rzRes.json();
  if (!rzRes.ok) {
    console.error('Razorpay order creation failed:', order);
    return json(502, { error: order?.error?.description || 'Failed to create order' });
  }

  return json(200, { order_id: order.id, amount, currency: 'INR' });
});
