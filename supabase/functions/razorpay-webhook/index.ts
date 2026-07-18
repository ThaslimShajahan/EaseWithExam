/**
 * Supabase Edge Function: razorpay-webhook
 * Handles Razorpay payment events to activate subscriptions.
 *
 * Deploy:
 *   supabase secrets set RAZORPAY_KEY_SECRET=rzp_live_... RAZORPAY_WEBHOOK_SECRET=webhook_...
 *   supabase functions deploy razorpay-webhook
 *
 * In Razorpay Dashboard → Webhooks:
 *   URL: https://<project>.supabase.co/functions/v1/razorpay-webhook
 *   Events: payment.captured, subscription.activated, subscription.cancelled
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac }   from 'https://deno.land/std@0.177.0/node/crypto.ts';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET  = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')   ?? '';

const PLAN_MAP: Record<string, string> = {
  premium_monthly: 'premium_monthly',
  premium_yearly:  'premium_yearly',
  neet_complete:   'neet_complete',
};

// Duration in days per plan
const PLAN_DAYS: Record<string, number> = {
  premium_monthly: 30,
  premium_yearly:  365,
  neet_complete:   365,
};

function verifySignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true; // skip in dev
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return expected === signature;
}

async function activateSubscription(supabase: any, firebaseUid: string, planId: string, paymentId: string) {
  const days = PLAN_DAYS[planId] ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('subscriptions').upsert({
    user_id:    firebaseUid,
    plan:       planId,
    status:     'active',
    starts_at:  new Date().toISOString(),
    expires_at: expiresAt,
    payment_id: paymentId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) throw error;

  // Award XP bonus for upgrading
  await supabase.rpc('award_xp_atomic', { p_uid: firebaseUid, p_event: 'subscription_upgrade' }).catch(() => {});
}

async function cancelSubscription(supabase: any, firebaseUid: string) {
  await supabase.from('subscriptions').update({
    status:     'cancelled',
    updated_at: new Date().toISOString(),
  }).eq('user_id', firebaseUid);
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

  const event = JSON.parse(body);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const entity    = event?.payload?.payment?.entity || event?.payload?.subscription?.entity;
    const eventType = event?.event;

    if (eventType === 'payment.captured') {
      const paymentId  = entity?.id;
      const notes      = entity?.notes || {};
      const firebaseUid= notes?.firebase_uid;
      const planId     = notes?.plan_id;

      if (!firebaseUid || !planId) {
        console.warn('Missing firebase_uid or plan_id in payment notes');
        return new Response('ok — no action (missing notes)', { status: 200 });
      }

      await activateSubscription(supabase, firebaseUid, planId, paymentId);
      console.log(`✅ Activated ${planId} for ${firebaseUid}`);
    }

    if (eventType === 'subscription.activated') {
      const paymentId   = entity?.latest_invoice?.payment?.entity?.id;
      const firebaseUid = entity?.notes?.firebase_uid;
      const planId      = entity?.notes?.plan_id;

      if (firebaseUid && planId) {
        await activateSubscription(supabase, firebaseUid, planId, paymentId || '');
        console.log(`✅ Subscription activated: ${planId} for ${firebaseUid}`);
      }
    }

    if (eventType === 'subscription.cancelled') {
      const firebaseUid = entity?.notes?.firebase_uid;
      if (firebaseUid) {
        await cancelSubscription(supabase, firebaseUid);
        console.log(`❌ Subscription cancelled for ${firebaseUid}`);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
