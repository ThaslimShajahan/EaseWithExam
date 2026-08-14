import { useLocation, useNavigate } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PLANS } from '../lib/subscription';
import PaymentConfirmation from '../components/ui/PaymentConfirmation';
import Button from '../components/ui/Button';

/**
 * /payment-success — added 2026-08-14, see PaymentConfirmation.jsx's own
 * header for why this exists.
 *
 * Data comes via router state (navigate(path, { state })) from
 * PricingPage's handleSelect, set from verifyAndActivateSubscription's
 * return value — no extra fetch needed for the common case, the student
 * just paid and landed here directly.
 *
 * Refresh/direct-nav fallback: router state does not survive a reload, and
 * intentionally isn't the only path here — falling back to an error would
 * make revisiting this URL (or a slow reload right after paying) look
 * broken for a page that did its job. Falls back to the account's current
 * subscription from AuthContext instead: less specific (no payment ID —
 * subscriptions.razorpay_payment_id, though present, is the LATEST
 * payment's, which is only reliably "the one that just happened" via the
 * state path), but never blank or erroring for an actual subscriber.
 * A visitor with no active subscription at all (this URL with nothing to
 * confirm) gets routed back to pricing rather than a confusing empty page.
 */
export default function PaymentSuccessPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { subscription, isPremium } = useAuth();

  const stateTransaction = location.state?.transaction;

  const fallbackTransaction = isPremium && subscription ? {
    planName:    PLANS[subscription.plan]?.name ?? subscription.plan,
    amountPaise: subscription.amount_paid ?? null,
    paymentId:   subscription.razorpay_payment_id ?? null,
    date: subscription.starts_at
      ? new Date(subscription.starts_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : null,
  } : null;

  const transaction = stateTransaction ?? fallbackTransaction;

  if (!transaction) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <CreditCard size={24} className="text-slate-400" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">No payment to confirm</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            There's no recent payment on this account to show. If you just paid, check your email for the receipt.
          </p>
          <Button variant="primary" full size="md" className="mt-5" onClick={() => navigate('/pricing')}>
            View Plans
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white rounded-3xl shadow-xl p-6">
        <PaymentConfirmation transaction={transaction} onContinue={() => navigate('/dashboard')} />
      </div>
    </div>
  );
}
