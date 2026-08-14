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
    description: 'Full AI power, generous daily limits',
    razorpayAmount: 39900,
    expiryDays: 30,
    badge: 'Most Popular',
    badgeColor: 'bg-primary-500',
    // Real enforced numbers, not Infinity. quota_config carries the same values
    // and is what actually gates; these drive the marketing copy, and the two
    // MUST agree — promising "unlimited" while enforcing a different number is
    // the failure this pattern exists to remove. Mock tests stay genuinely
    // unlimited (-1 in quota_config), so that claim is still true.
    // Raised 200->350 / 150->250 (2026-08-14, owner-approved) to make the paid
    // tier feel genuinely generous relative to free (20/15) while keeping a
    // real ceiling — not literally unlimited, same cost-safety principle as
    // the per-student grant caps.
    limits: {
      ai_questions_per_day: 350,
      veda_messages_per_day: 250,
      mock_tests_per_week: Infinity,
    },
    features: [
      // Led with the two genuinely distinctive, verified-live differentiators
      // (see Phase 0 audit) rather than generic claims every competing
      // exam-prep app also makes — those are kept below, not dropped.
      'Misconception Engine — spot your repeated wrong-answer patterns',
      'Smart flashcards that adapt to what you remember (SM-2)',
      '350 AI practice questions a day',
      'Unlimited mock tests',
      '250 EWE messages a day',
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
    description: 'Best per-month value',
    razorpayAmount: 399900,
    expiryDays: 365,
    // 12 × ₹399 = ₹4,788 vs ₹3,999 — recalculated to match the price change
    // above (was 'Save ₹1,789', correct only against the old ₹2,999 price).
    badge: 'Save ₹789',
    badgeColor: 'bg-emerald-500',
    // Same values as premium_monthly — same plan, longer term.
    limits: {
      ai_questions_per_day: 350,
      veda_messages_per_day: 250,
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
  // ₹1 superadmin-only live-mode verification plan — 2026-08-14. Deliberately
  // NOT in DISPLAY_PLANS (PricingPage/LandingPage/PaywallModal all map over
  // that array explicitly, never Object.keys(PLANS)), so it structurally
  // cannot appear in a normal plan grid regardless of who's looking. Real
  // GST still applies (18% of ₹1 = ₹1.18 total) — the whole point is
  // exercising the actual checkout -> GST -> confirmation -> receipt ->
  // webhook -> activation path with real money, not a fee-free shortcut
  // around it. Visibility AND purchase are both gated on
  // is_active_superadmin() — see PricingPage.jsx (UI) and
  // create-razorpay-order (server-side backstop, not just UI hiding).
  verification_1rs: {
    id: 'verification_1rs',
    name: 'Live Verification',
    priceLabel: '₹1 one-time',
    description: 'Superadmin-only — real end-to-end payment verification, not a real plan',
    razorpayAmount: 100,
    expiryDays: 1,
    features: [
      'Exercises the real checkout, GST, confirmation, receipt and webhook path',
      'Expires automatically in 1 day',
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
  base_amount_paise, gst_amount_paise, tax_rate_percent,
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

  // Everything the payment-confirmation page needs, so it doesn't need a
  // second fetch — the same values the receipt email is built from.
  // base/gst_amount_paise come from the ORDER (createRazorpayOrder's
  // response), not recomputed here — the exact numbers that were actually
  // charged, matching how razorpay-verify's own receipt send reads them
  // back from payment_orders rather than recomputing.
  return {
    plan,
    planName,
    amountPaise:     amount_paid,
    baseAmountPaise: base_amount_paise,
    gstAmountPaise:  gst_amount_paise,
    taxRatePercent:  tax_rate_percent,
    paymentId:       razorpay_payment_id,
    date:            new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
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

/**
 * ₹-prefixed display string from a paise amount — for the order-summary
 * review step and payment confirmation page. Frontend-only: unlike the
 * email receipt (which switched to plain "INR" after the ₹ glyph rendered
 * as "?" in one delivered email, a Resend/HTML-email encoding issue), the
 * browser renders this fine — React text content is UTF-8 throughout with
 * no email-transport hop to lose it in. PLANS' own priceLabel strings
 * already use ₹ the same way.
 */
export function formatRupees(paise) {
  return `₹${((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;
}

/**
 * GST display math — DISPLAY ONLY. The authoritative computation is
 * create-razorpay-order (server-side); this exists purely so the pricing
 * cards and OrderSummaryModal can show the same breakdown before an order
 * even exists yet (a card's price display has no order to read `amount`
 * from). Once a real order exists, OrderSummaryModal reads its actual
 * base_amount/gst_amount/amount straight from the server response instead
 * of calling this — never a second, independently-computed number that
 * could disagree with what was actually charged.
 *
 * Same rule as the server: round GST to the nearest paise, add to base for
 * the total — never multiply the total directly, so base + gst always sums
 * to EXACTLY what this reports as the total, with no float-drift gap.
 *
 * ratePercent falsy/non-finite/<=0 -> no tax, matching how an unset
 * platform_settings.tax_rate_percent has always been read everywhere else.
 */
export function computeGst(basePaise, ratePercent) {
  const rate = parseFloat(ratePercent);
  const hasTax = Number.isFinite(rate) && rate > 0;
  const gstPaise = hasTax ? Math.round(basePaise * (rate / 100)) : 0;
  return {
    hasTax,
    ratePercent: hasTax ? rate : 0,
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
  };
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

/**
 * Step 1 of 2 — creates the order server-side and returns it, WITHOUT
 * opening the Razorpay modal. Split out 2026-08-14 so the order-summary
 * review step (OrderSummaryModal) can show the real, server-confirmed
 * amount and order_id before the user ever sees Razorpay's own UI — the
 * summary reads the SAME order that checkout then opens, not a second,
 * separately-resolved price that could theoretically disagree with it.
 *
 * Throws on any failure (kill switch, invalid plan, network/timeout) —
 * callers show the message via their own error UI.
 */
export async function createRazorpayOrder({ planId, firebaseUid }) {
  // Kill switch, checked before anything else — before the Razorpay script is
  // even loaded, so a disabled site makes no third-party request and shows no
  // checkout chrome. This is the backstop, not the primary gate: PricingPage
  // and PaywallModal hide their CTAs, and this catches any path that reaches
  // checkout anyway (a stale tab, a direct call, a future caller).
  // Defaults to disabled if the flag is missing or unreadable — see paymentsGate.
  if (!(await arePaymentsEnabled())) throw new Error(PAYMENTS_CLOSED_ERROR);

  const plan = PLANS[planId];
  if (!plan || !plan.razorpayAmount) throw new Error('Invalid plan.');

  // Amount is resolved server-side (create-razorpay-order looks up plan_config,
  // falling back to its own hardcoded catalogue) — the client never dictates the
  // charge amount, and the resulting order_id pins it for Razorpay's own checks.
  //
  // AbortController timeout: without one, a request that hangs (rather than
  // erroring) never resolves or rejects, so the caller's loading state is
  // stuck until the user reloads. A slow/stuck order-creation call must fail
  // loudly, not hang the button forever.
  let order;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-razorpay-order`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ plan_id: planId, firebase_uid: firebaseUid }),
      signal: controller.signal,
    });
    order = await res.json();
    if (!res.ok) throw new Error(order?.error || 'Could not start checkout');
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'Checkout is taking too long to start. Please try again.'
      : (err.message || 'Could not start checkout. Please try again.');
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }

  return { order, plan };
}

/**
 * Step 2 of 2 — opens the Razorpay modal for an order `createRazorpayOrder`
 * already created (e.g. after the user confirms the order-summary review
 * step), and drives verification through to onSuccess/onFailure exactly as
 * before. Does NOT re-create the order — reuses order.order_id, so what the
 * user reviewed in the summary is exactly what gets charged.
 */
export async function openRazorpayCheckout({ order, plan, planId, firebaseUid, email, name, onSuccess, onFailure }) {
  const loaded = await loadRazorpayScript();
  if (!loaded) { onFailure?.('Payment gateway unavailable. Please try again.'); return; }

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
          base_amount_paise: order.base_amount,
          gst_amount_paise:  order.gst_amount,
          tax_rate_percent:  order.tax_rate_percent,
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

/**
 * One-shot convenience wrapper — creates the order AND opens checkout
 * immediately, skipping the review step. Kept for any caller that
 * legitimately wants the old direct behaviour (and for the existing kill-
 * switch test, which asserts on this exact function); PricingPage and
 * PaywallModal no longer use it directly — see createRazorpayOrder/
 * openRazorpayCheckout above, called with an OrderSummaryModal in between.
 */
export async function initiateRazorpayPayment({ planId, firebaseUid, email, name, onSuccess, onFailure }) {
  let order, plan;
  try {
    ({ order, plan } = await createRazorpayOrder({ planId, firebaseUid }));
  } catch (err) {
    onFailure?.(err.message);
    return;
  }
  await openRazorpayCheckout({ order, plan, planId, firebaseUid, email, name, onSuccess, onFailure });
}
