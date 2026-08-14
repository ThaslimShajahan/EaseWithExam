import { CheckCircle2, Calendar, Hash, Wallet, ArrowRight } from 'lucide-react';
import { formatRupees } from '../../lib/subscription';
import { BUSINESS_DETAILS } from '../../lib/businessDetails';
import Button from './Button';

/**
 * The actual, first-party payment confirmation — added 2026-08-14. Before
 * this, a successful payment closed Razorpay's own modal and redirected
 * straight to the generic dashboard with no confirmation of its own; the
 * only feedback was a transient banner on PricingPage, easy to miss (see
 * that fix's own history). This is the real confirmation moment.
 *
 * Pure presentational component, reused in two containers:
 *   - PaymentSuccessPage.jsx — full page, PricingPage's purchase flow.
 *   - PaywallModal.jsx — rendered inline in the SAME modal shell, since the
 *     paywall can fire mid-task (mid mock-test, mid practice generation)
 *     and navigating away would lose the student's place.
 *
 * `transaction` is `{ planName, amountPaise, paymentId, date }` — the exact
 * shape verifyAndActivateSubscription() returns, so no separate fetch is
 * needed at the call site. Any field can be missing (see PaymentSuccessPage's
 * refresh-fallback) and this renders sensibly without it.
 */
export default function PaymentConfirmation({ transaction, onContinue, continueLabel = 'Go to Dashboard' }) {
  const { planName, amountPaise, baseAmountPaise, gstAmountPaise, taxRatePercent, paymentId, date } = transaction ?? {};
  const hasGstBreakdown = gstAmountPaise > 0 && baseAmountPaise != null;

  return (
    <div className="text-center px-2 py-2">
      <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
        <CheckCircle2 size={32} className="text-emerald-500" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Payment successful</h2>
      <p className="text-sm text-slate-500 mt-1.5">
        {planName ? <>Your <span className="font-semibold text-slate-700">{planName}</span> plan is active.</> : 'Your plan is active.'}
        {' '}The full toolkit is unlocked.
      </p>

      {(amountPaise != null || paymentId || date) && (
        <div className="mt-5 rounded-2xl border border-slate-200 divide-y divide-slate-100 text-left">
          {hasGstBreakdown ? (
            <>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-slate-500 flex items-center gap-2"><Wallet size={13} /> Amount</span>
                <span className="text-slate-900 font-semibold">{formatRupees(baseAmountPaise)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-slate-500">GST ({taxRatePercent}%)</span>
                <span className="text-slate-900 font-semibold">{formatRupees(gstAmountPaise)}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-slate-500">Total paid</span>
                <span className="text-slate-900 font-bold">{formatRupees(amountPaise)}</span>
              </div>
            </>
          ) : amountPaise != null && (
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-slate-500 flex items-center gap-2"><Wallet size={13} /> Amount paid</span>
              <span className="text-slate-900 font-semibold">{formatRupees(amountPaise)}</span>
            </div>
          )}
          {paymentId && (
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-slate-500 flex items-center gap-2"><Hash size={13} /> Payment ID</span>
              <span className="text-slate-900 font-mono text-xs">{paymentId}</span>
            </div>
          )}
          {date && (
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-slate-500 flex items-center gap-2"><Calendar size={13} /> Date</span>
              <span className="text-slate-900 font-semibold">{date}</span>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-4">
        A receipt has been emailed to you. Billed by {BUSINESS_DETAILS.name} · GSTIN {BUSINESS_DETAILS.gstin}
      </p>

      <Button variant="primary" full size="md" className="mt-5" onClick={onContinue} iconRight={<ArrowRight size={15} />}>
        {continueLabel}
      </Button>
    </div>
  );
}
