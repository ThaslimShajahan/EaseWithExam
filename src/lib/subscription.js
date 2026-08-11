import { supabase } from './supabase';
import { createNotification } from './notifications';
import { sendTransactionalEmail } from './email';
import { arePaymentsEnabled, PAYMENTS_CLOSED_ERROR } from './paymentsGate';

/* ── Plan catalogue ─────────────────────────────────────── */

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceLabel: '₹0',
    description: 'Get started with daily practice',
    limits: {
      ai_questions_per_day: 20,
      veda_messages_per_day: 15,
      mock_tests_per_week: 2,
      paper_evaluations_per_day: 3,
      podcasts_per_day: 3,
      paper_generations_per_day: 2,
    },
    features: [
      '20 AI practice questions/day',
      '2 full question papers/day',
      '2 mock tests per week',
      '15 EWE messages/day',
      '3 AI paper evaluations/day',
      '3 AI podcasts/day',
      'Daily challenge',
      'Basic analytics',
    ],
    locked: [
      'Score predictor',
      'Deep chapter notes',
      'Unlimited EWE',
      'Progress certificates',
    ],
  },
  premium_monthly: {
    id: 'premium_monthly',
    name: 'Premium',
    priceLabel: '₹399/month',
    priceSuffix: '+ GST',
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
      // Led with the two genuinely distinctive, verified-live differentiators
      // (see Phase 0 audit) rather than generic claims every competing
      // exam-prep app also makes — those are kept below, not dropped.
      'Misconception Engine — spot your repeated wrong-answer patterns',
      'Smart flashcards that adapt to what you remember (SM-2)',
      'Unlimited AI practice questions',
      'Unlimited mock tests',
      'Unlimited EWE chat',
      'Score predictor (premium)',
      'Deep chapter notes + derivations',
      'Progress certificates',
      'Priority support',
    ],
  },
  premium_yearly: {
    id: 'premium_yearly',
    name: 'Premium Yearly',
    priceLabel: '₹3,999/year',
    priceSuffix: '+ GST',
    description: 'Best per-month value',
    razorpayAmount: 399900,
    expiryDays: 365,
    // 12 × ₹399 = ₹4,788 vs ₹3,999 — recalculated to match the price change
    // above (was 'Save ₹1,789', correct only against the old ₹2,999 price).
    badge: 'Save ₹789',
    badgeColor: 'bg-emerald-500',
    limits: {
      ai_questions_per_day: Infinity,
      veda_messages_per_day: Infinity,
      mock_tests_per_week: Infinity,
    },
    features: [
      'Misconception Engine — spot your repeated wrong-answer patterns',
      'Smart flashcards that adapt to what you remember (SM-2)',
      'Everything in Premium',
      '12 months access',
      'Early access to new features',
      'Priority support',
    ],
  },
  // Plan ID deliberately left as 'neet_complete' — it's the key live
  // subscriptions, quota_config and the edge functions' PLAN_DAYS all resolve
  // on. Only the presentation changed: this is shown to EVERY student
  // (including Class 8), and NEET/JEE students buy the same plans as everyone
  // else, so framing it as a NEET-only product was both wrong and off-putting
  // to the board students who see it.
  neet_complete: {
    id: 'neet_complete',
    name: '3-Year Plan',
    priceLabel: '₹4,999 one-time',
    priceSuffix: '+ GST',
    description: 'Best value — three full years, one payment',
    razorpayAmount: 499900,
    // Was 365 — matched what the checkout/grant paths actually enforced even
    // while the copy claimed "Lifetime (never expires)". Now the displayed
    // duration and the enforced duration genuinely agree: 3 × 365.
    expiryDays: 1095,
    badge: 'Best Value',
    badgeColor: 'bg-rose-500',
    // examChips removed: this plan is offered to every student, so NEET/JEE
    // chips made it read as a competitive-only product on a Class 8
    // student's pricing page.
    features: [
      'Everything in Premium, for three years',
      'Covers board exams and NEET / JEE prep alike',
      'Misconception Engine — spot your repeated wrong-answer patterns',
      'Smart flashcards that adapt to what you remember (SM-2)',
      // ScorePredictor.jsx has real NEET/JEE Main/JEE Advanced marks-band
      // configs — it estimates a performance band, not a rank/percentile.
      'Score predictor with NEET/JEE performance band estimate',
      'Live doubt resolution via EWE',
      'One payment — no yearly renewals',
    ],
  },
};

/* ── Subscription CRUD ──────────────────────────────────── */

// Reads via RPC: `subscriptions` now runs RLS with no client policy, so a
// direct select returns nothing. The RPC allows self — or a parent with an
// active link, which is what ParentDashboardPage relies on — and never returns
// the razorpay_* columns. The old select('*') would have exposed the payment
// signature to the browser.
export async function getUserSubscription(firebaseUid) {
  const { data } = await supabase.rpc('get_user_subscription', { p_uid: firebaseUid });

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
  sendTransactionalEmail(firebaseUid, 'subscription_active', { planName });

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
  // Kill switch, checked before anything else — before the Razorpay script is
  // even loaded, so a disabled site makes no third-party request and shows no
  // checkout chrome. This is the backstop, not the primary gate: PricingPage
  // and PaywallModal hide their CTAs, and this catches any path that reaches
  // checkout anyway (a stale tab, a direct call, a future caller).
  // Defaults to disabled if the flag is missing or unreadable — see paymentsGate.
  if (!(await arePaymentsEnabled())) { onFailure?.(PAYMENTS_CLOSED_ERROR); return; }

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
