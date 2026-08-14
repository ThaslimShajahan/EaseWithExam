import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, X, Crown, Zap, Star, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PLANS, initiateRazorpayPayment } from '../lib/subscription';
import { usePaymentsEnabled, PAYMENTS_CLOSED_TITLE, PAYMENTS_CLOSED_BODY } from '../lib/paymentsGate';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';

/* Feature comparison rows — the first 5 free-tier values are overridden with live
 * quota_config numbers once loaded (see buildCompare below); these are just the
 * fallback shown before that fetch resolves, matching quota.js's FREE_LIMITS.
 * Mock tests is a weekly cap (not daily) — see WEEKLY_FIELDS in lib/quota.js. */
const BASE_COMPARE = [
  { label: 'AI practice questions',   free: '20/day',   premium: 'Unlimited' },
  { label: 'Full question papers',    free: '2/day',    premium: 'Unlimited' },
  { label: 'Mock tests',              free: '2/week',   premium: 'Unlimited' },
  { label: 'EWE AI chat',             free: '15/day',   premium: 'Unlimited' },
  { label: 'AI paper evaluations',    free: '3/day',    premium: 'Unlimited' },
  { label: 'AI podcasts',             free: '3/day',    premium: 'Unlimited' },
  { label: 'Daily challenge',         free: true,       premium: true        },
  { label: 'Score predictor',         free: false,      premium: true        },
  { label: 'Deep chapter notes',      free: false,      premium: true        },
  { label: 'Progress certificates',   free: false,      premium: true        },
  { label: 'Priority support',        free: false,      premium: true        },
];

function buildCompare(freeQuota) {
  if (!freeQuota) return BASE_COMPARE;
  const [ai, paperGen, mock, veda, paperEval, podcasts] = BASE_COMPARE;
  return [
    { ...ai,        free: `${freeQuota.ai_questions}/day` },
    { ...paperGen,  free: `${freeQuota.paper_generations}/day` },
    { ...mock,      free: `${freeQuota.mock_tests}/week` },
    { ...veda,      free: `${freeQuota.veda_messages}/day` },
    { ...paperEval, free: `${freeQuota.paper_evaluations}/day` },
    { ...podcasts,  free: `${freeQuota.podcasts}/day` },
    ...BASE_COMPARE.slice(6),
  ];
}

const DISPLAY_PLANS = [
  { id: 'free',            highlight: false },
  { id: 'premium_monthly', highlight: true  },
  { id: 'premium_yearly',  highlight: false },
  { id: 'neet_complete',   highlight: false },
];

function FeatureCell({ value }) {
  if (value === true)  return <Check size={16} className="text-emerald-500 mx-auto" />;
  if (value === false) return <X    size={16} className="text-slate-300 mx-auto" />;
  return <span className="text-xs font-medium text-slate-700">{value}</span>;
}

function PlanCard({ planId, plan: planProp, highlight, onSelect, loading, isCurrent, paymentsClosed }) {
  const plan = planProp ?? PLANS[planId];
  const isFree = planId === 'free';
  // isCurrent is already a boolean computed correctly by the caller for both
  // the free and paid cases — this used to compare it against the string
  // 'free' (`isCurrent === 'free'`), which is never true for a boolean, so
  // free-tier users never saw the "Current Plan" badge/disabled state.
  const isOwned = isCurrent;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={[
        'relative rounded-3xl p-6 border-2 transition-colors flex flex-col',
        highlight
          ? 'border-primary-500 bg-gradient-to-b from-primary-500 to-primary-800 text-white shadow-xl shadow-primary-200'
          : 'border-slate-200 bg-white text-slate-900',
      ].join(' ')}
    >
      {plan.badge && (
        <div className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold text-white px-3 py-1 rounded-full ${plan.badgeColor ?? 'bg-primary-500'}`}>
          {plan.badge}
        </div>
      )}
      {isOwned && (
        <div className="absolute -top-3 right-4 text-[11px] font-bold bg-emerald-500 text-white px-3 py-1 rounded-full">
          ✓ Active
        </div>
      )}

      <div className="mb-4">
        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-3 ${highlight ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
          {isFree ? <Zap size={12} /> : <Crown size={12} />}
          {plan.name}
        </div>
        {/* Exam coverage chips — Competitive Exams plan only (see examChips
            in lib/subscription.js). Reuses the app's existing .badge pill
            utility rather than a one-off chip style. */}
        {plan.examChips?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {plan.examChips.map((exam) => (
              <span
                key={exam}
                className={`badge ${highlight ? 'bg-white/15 text-white' : 'bg-primary-50 text-primary-700 border border-primary-100'}`}
              >
                {exam}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1">
          <span className={`text-3xl font-extrabold ${highlight ? 'text-white' : 'text-slate-900'}`}>
            {plan.priceLabel.split('/')[0]}
          </span>
          {plan.priceLabel.includes('/') && (
            <span className={`text-sm pb-1 ${highlight ? 'text-primary-200' : 'text-slate-400'}`}>
              /{plan.priceLabel.split('/')[1]}
            </span>
          )}
        </div>
        {/* Secondary fine print, deliberately not competing with the price
            number above (task requirement) — Free has no priceSuffix. */}
        {plan.priceSuffix && (
          <p className={`text-[11px] mt-0.5 ${highlight ? 'text-primary-200' : 'text-slate-400'}`}>
            {plan.priceSuffix}
          </p>
        )}
        <p className={`text-sm mt-1 ${highlight ? 'text-primary-200' : 'text-slate-500'}`}>
          {plan.description}
        </p>
      </div>

      {/* Tighter row spacing/line-height (was space-y-2 + text-sm default
          leading, no size step-down) — with 8-10 features per paid plan,
          that default spacing was the main driver of card height, not the
          outer padding. */}
      <div className={`space-y-1.5 mb-5 flex-1 border-t pt-3.5 ${highlight ? 'border-white/20' : 'border-slate-100'}`}>
        {plan.features.map((f) => (
          <div key={f} className="flex items-start gap-1.5 text-[13px] leading-snug">
            <Check size={12} className={`mt-0.5 shrink-0 ${highlight ? 'text-primary-200' : 'text-emerald-500'}`} />
            <span className={highlight ? 'text-primary-100' : 'text-slate-600'}>{f}</span>
          </div>
        ))}
        {plan.locked?.map((f) => (
          <div key={f} className="flex items-start gap-1.5 text-[13px] leading-snug opacity-50">
            <X size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="text-slate-400 line-through">{f}</span>
          </div>
        ))}
      </div>

      {/* `paymentsClosed` covers the loading state too, so a live "Get Premium"
          never flashes on screen before the flag resolves and withdraws it. The
          free plan keeps its normal control — nothing about it is purchased. */}
      <Button
        variant={isOwned ? 'secondary' : 'primary'}
        full
        size="md"
        loading={loading}
        disabled={isOwned || (paymentsClosed && !isFree)}
        onClick={() => !isOwned && !(paymentsClosed && !isFree) && onSelect(planId)}
        // `!` on every one of these, not just text: className here is
        // concatenated onto the base Button's own `primary` variant classes
        // (bg-primary-600 hover:bg-primary-700 text-white), and plain
        // Tailwind utilities of equal specificity don't reliably let a
        // later class in the string win — Tailwind's generated stylesheet
        // orders rules by its own internal scan order, not JSX source
        // order. This fixes resting/hover contrast on the highlighted card.
        // It does NOT fix the loading/disabled state on its own — that was
        // a separate bug (Button.jsx's disabled:opacity-* alpha-blending
        // against this card's gradient background) fixed at the component
        // level so it holds here and everywhere else Button is used.
        className={highlight && !isOwned ? '!bg-white !text-primary-700 hover:!bg-primary-50 !border-white' : ''}
      >
        {isOwned
          ? 'Current Plan ✓'
          : paymentsClosed && !isFree
            ? 'Opens 14 August'
            : `Get ${plan.name}`}
      </Button>
    </motion.div>
  );
}

export default function PricingPage() {
  const { currentUser, userProfile, subscription, isPremium, refreshSubscription } = useAuth();
  const navigate = useNavigate();
  const [activePlan, setActivePlan] = useState('');
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [planData, setPlanData]     = useState(PLANS);
  const [compare,  setCompare]       = useState(BASE_COMPARE);

  // Treat "still loading" as closed — see paymentsGate. A false-then-true flip
  // would render a live purchase button for a frame before withdrawing it.
  const { enabled: paymentsEnabled, loading: paymentsLoading } = usePaymentsEnabled();
  const paymentsClosed = !paymentsEnabled || paymentsLoading;

  useEffect(() => {
    supabase.from('plan_config').select('*').then(({ data }) => {
      if (!data?.length) return;
      const merged = { ...PLANS };
      data.forEach((row) => {
        if (!merged[row.plan_id]) return;
        merged[row.plan_id] = {
          ...merged[row.plan_id],
          ...(row.name        && { name: row.name }),
          ...(row.price_label && { priceLabel: row.price_label }),
          ...(row.description && { description: row.description }),
          ...(row.badge       && { badge: row.badge }),
          ...(row.features?.length && { features: row.features }),
          ...(row.locked?.length   && { locked: row.locked }),
        };
      });
      setPlanData(merged);
    });

    supabase.from('quota_config').select('ai_questions, mock_tests, veda_messages, paper_evaluations, podcasts').eq('plan_id', 'free').maybeSingle()
      .then(({ data }) => { if (data) setCompare(buildCompare(data)); });
  }, []);

  const handleSelect = (planId) => {
    setError('');
    setActivePlan(planId);
    initiateRazorpayPayment({
      planId,
      firebaseUid: currentUser.uid,
      email: userProfile?.email || currentUser.email,
      name:  userProfile?.display_name || currentUser.displayName || 'Student',
      onSuccess: async () => {
        setActivePlan('');
        setSuccess('Payment successful! Activating your plan…');
        // The banner renders at the top of the page (above the plan cards),
        // but the Razorpay modal that just closed covers the whole viewport
        // while it's open — whatever the page was scrolled to underneath it
        // is wherever the user lands the instant it closes, which for a
        // clicked plan card is usually NOT the top. Found 2026-08-14: a real
        // successful payment left the student with no visible confirmation
        // at all, because the confirmation existed but was scrolled out of
        // view for the ~1s it was on screen before navigating away.
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await refreshSubscription(); // re-fetch subscription so isPremium flips immediately
        // A deliberate pause, not just however long refreshSubscription()
        // happens to take — that could resolve fast enough to navigate away
        // before the scroll animation above even finishes.
        await new Promise((r) => setTimeout(r, 1200));
        setSuccess('');
        navigate('/dashboard');
      },
      onFailure: (msg) => {
        setActivePlan('');
        if (msg !== 'Payment cancelled') setError(msg);
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-8 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>

        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4 border border-primary-100">
            <Star size={14} className="text-amber-500" /> Unlock full AI power
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 mb-3">
            Plans for every aspirant
          </h1>
          <p className="text-slate-500 max-w-xl mx-auto text-lg">
            Start free, upgrade when you're ready. Cancel anytime. No hidden charges.
          </p>
        </div>

        {/* Payments kill switch — replaces the retry-me checkout error with an
            honest date. Rendered above the cards so it is read before any CTA. */}
        {paymentsClosed && !paymentsLoading && (
          <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-5 text-center">
            <p className="font-bold text-[15px]">{PAYMENTS_CLOSED_TITLE}</p>
            <p className="mt-1.5 text-sm text-amber-800/90 max-w-xl mx-auto leading-relaxed">
              {PAYMENTS_CLOSED_BODY}
            </p>
          </div>
        )}

        {/* Success / Error */}
        {success && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 text-center text-sm font-medium">
            {success}
          </div>
        )}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-center text-sm">
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {DISPLAY_PLANS.map(({ id, highlight }) => (
            <PlanCard
              key={id}
              planId={id}
              plan={planData[id]}
              highlight={highlight}
              loading={activePlan === id}
              onSelect={handleSelect}
              isCurrent={id === 'free' ? !isPremium : subscription?.plan === id && isPremium}
              paymentsClosed={paymentsClosed}
            />
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-900 text-lg">Full feature comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 font-semibold text-slate-600 w-1/2">Feature</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600">Free</th>
                  <th className="text-center px-4 py-3 font-semibold text-primary-600">Premium</th>
                </tr>
              </thead>
              <tbody>
                {compare.map(({ label, free, premium }, i) => (
                  <tr key={label} className={i % 2 === 0 ? 'bg-slate-50/50' : ''}>
                    <td className="px-6 py-3 text-slate-700">{label}</td>
                    <td className="px-4 py-3 text-center"><FeatureCell value={free} /></td>
                    <td className="px-4 py-3 text-center"><FeatureCell value={premium} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-12 text-center text-slate-500 text-sm">
          <p>Questions? Email us at <a href="mailto:info@acenzos.com" className="text-primary-600 hover:underline">info@acenzos.com</a></p>
          {/* "Prices exclude GST" removed: Razorpay is charged exactly the
              listed amount with nothing added, so the line described a charge
              that never happened. See ACTION_ITEMS — the tax treatment is
              unresolved, and no GST claim belongs here until it is settled. */}
          <p className="mt-1">Payments secured by Razorpay · Refund within 7 days if unhappy.</p>
        </div>
      </div>
    </div>
  );
}
