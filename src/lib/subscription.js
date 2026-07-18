import { supabase } from './supabase';
import { createNotification } from './notifications';

/* ── Plan catalogue ─────────────────────────────────────── */

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: '₹0',
    description: 'Get started with daily practice',
    limits: {
      ai_questions_per_day: 10,
      veda_messages_per_day: 5,
      mock_tests_per_week: 1,
    },
    features: [
      '10 AI practice questions/day',
      '1 mock test per week',
      '5 EWE messages/day',
      'Daily challenge',
      'Basic analytics',
    ],
    locked: [
      'Score predictor',
      'Deep chapter notes',
      'Unlimited EWE',
      'Progress certificates',
      'Referral bonuses',
    ],
  },
  premium_monthly: {
    id: 'premium_monthly',
    name: 'Premium',
    priceLabel: '₹399/month',
    description: 'Full AI power, no limits',
    razorpayAmount: 39900,
    expiryDays: 30,
    badge: 'Most Popular',
    badgeColor: 'bg-primary-500',
    limits: {
      ai_questions_per_day: Infinity,
      veda_messages_per_day: Infinity,
      mock_tests_per_week: Infinity,
    },
    features: [
      'Unlimited AI practice questions',
      'Unlimited mock tests',
      'Unlimited EWE chat',
      'Score predictor (premium)',
      'Deep chapter notes + derivations',
      'Progress certificates',
      'Referral bonuses',
      'Priority support',
    ],
  },
  premium_yearly: {
    id: 'premium_yearly',
    name: 'Premium Yearly',
    priceLabel: '₹2,999/year',
    description: 'Best per-month value',
    razorpayAmount: 299900,
    expiryDays: 365,
    badge: 'Save ₹1,789',
    badgeColor: 'bg-emerald-500',
    limits: {
      ai_questions_per_day: Infinity,
      veda_messages_per_day: Infinity,
      mock_tests_per_week: Infinity,
    },
    features: [
      'Everything in Premium',
      '12 months access',
      'Early access to new features',
      'Priority support',
    ],
  },
  neet_complete: {
    id: 'neet_complete',
    name: 'NEET Complete',
    priceLabel: '₹4,999 one-time',
    description: 'Lifetime access for NEET 2026',
    razorpayAmount: 499900,
    expiryDays: 365,
    badge: 'NEET Aspirants',
    badgeColor: 'bg-rose-500',
    limits: {
      ai_questions_per_day: Infinity,
      veda_messages_per_day: Infinity,
      mock_tests_per_week: Infinity,
    },
    features: [
      'Everything in Premium',
      'NEET-specific test series packs',
      'Score predictor with NEET ranking estimate',
      'Live doubt resolution via EWE',
      'Lifetime access (never expires)',
    ],
  },
};

/* ── Subscription CRUD ──────────────────────────────────── */

export async function getUserSubscription(firebaseUid) {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', firebaseUid)
    .maybeSingle();

  if (!data) return { plan: 'free', status: 'active' };

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { ...data, plan: 'free', status: 'expired' };
  }

  return data;
}

export function isPremium(subscription) {
  if (!subscription) return false;
  return subscription.plan !== 'free' && subscription.status === 'active';
}

// Verifies a completed Razorpay payment server-side (HMAC signature check +
// SECURITY DEFINER activate_subscription RPC) via the razorpay-verify edge
// function — the client never writes to `subscriptions` directly.
async function verifyAndActivateSubscription(firebaseUid, {
  plan, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount_paid,
}) {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/razorpay-verify`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      firebase_uid: firebaseUid,
      plan_id:      plan,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      amount_paid,
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result?.error || 'Payment verification failed');

  const planName = PLANS[plan]?.name ?? plan;
  createNotification(
    firebaseUid,
    'subscription_active',
    `${planName} activated! 🎉`,
    'All premium features are now unlocked. Welcome to the full EWE experience!',
    '/dashboard',
  ).catch(() => {});

  return { plan };
}

/* ── Daily usage quota ──────────────────────────────────── */

export async function getDailyUsage(firebaseUid) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('daily_usage_quota')
    .select('*')
    .eq('user_id', firebaseUid)
    .eq('usage_date', today)
    .maybeSingle();

  return data ?? { ai_questions_used: 0, veda_messages_used: 0, mock_tests_used: 0 };
}

export async function incrementUsage(firebaseUid, field) {
  const today = new Date().toISOString().split('T')[0];
  const { data: row } = await supabase
    .from('daily_usage_quota')
    .select(`id, ${field}`)
    .eq('user_id', firebaseUid)
    .eq('usage_date', today)
    .maybeSingle();

  if (row?.id) {
    await supabase
      .from('daily_usage_quota')
      .update({ [field]: (row[field] || 0) + 1 })
      .eq('id', row.id);
  } else {
    await supabase
      .from('daily_usage_quota')
      .insert({ user_id: firebaseUid, usage_date: today, [field]: 1 });
  }
}

/* Returns { allowed, used, limit } */
export async function canUseFeature(firebaseUid, feature, subscription) {
  if (isPremium(subscription)) return { allowed: true };

  const limits = PLANS.free.limits;
  const usage  = await getDailyUsage(firebaseUid);

  const map = {
    ai_questions:  { used: usage.ai_questions_used,   limit: limits.ai_questions_per_day  },
    veda_messages: { used: usage.veda_messages_used,  limit: limits.veda_messages_per_day },
    mock_tests:    { used: usage.mock_tests_used,      limit: limits.mock_tests_per_week   },
  };

  const check = map[feature];
  if (!check) return { allowed: true };
  if (check.used >= check.limit) return { allowed: false, used: check.used, limit: check.limit };
  return { allowed: true, used: check.used, limit: check.limit };
}

/* ── Razorpay helpers ───────────────────────────────────── */

export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export async function initiateRazorpayPayment({ planId, firebaseUid, email, name, onSuccess, onFailure }) {
  const loaded = await loadRazorpayScript();
  if (!loaded) { onFailure?.('Payment gateway unavailable. Please try again.'); return; }

  const plan = PLANS[planId];
  if (!plan || !plan.razorpayAmount) { onFailure?.('Invalid plan.'); return; }

  // Amount is resolved server-side (create-razorpay-order looks up plan_config,
  // falling back to its own hardcoded catalogue) — the client never dictates the
  // charge amount, and the resulting order_id pins it for Razorpay's own checks.
  let order;
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-razorpay-order`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ plan_id: planId, firebase_uid: firebaseUid }),
    });
    order = await res.json();
    if (!res.ok) throw new Error(order?.error || 'Could not start checkout');
  } catch (err) {
    onFailure?.(err.message || 'Could not start checkout. Please try again.');
    return;
  }

  const options = {
    key: import.meta.env.VITE_RAZORPAY_KEY_ID,
    amount: order.amount,
    order_id: order.order_id,
    currency: 'INR',
    name: 'EaseWithExam',
    description: plan.name,
    image: '/logo.png',
    prefill: { name, email },
    theme: { color: '#6366f1' },
    handler: async (response) => {
      try {
        const sub = await verifyAndActivateSubscription(firebaseUid, {
          plan: planId,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id:   response.razorpay_order_id,
          razorpay_signature:  response.razorpay_signature,
          amount_paid: order.amount,
        });
        onSuccess?.(sub);
      } catch (err) {
        onFailure?.(err.message);
      }
    },
    modal: {
      ondismiss: () => onFailure?.('Payment cancelled'),
    },
  };

  const rz = new window.Razorpay(options);
  rz.open();
}
