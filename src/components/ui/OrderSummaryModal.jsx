import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ShieldCheck, Loader2, Check, Repeat, Zap } from 'lucide-react';
import { formatRupees } from '../../lib/subscription';
import { BUSINESS_DETAILS } from '../../lib/businessDetails';
import Button from './Button';

/**
 * Review step between clicking a plan's CTA and Razorpay's own checkout
 * modal opening — added 2026-08-14 on the owner's explicit call that
 * transparency before payment matters more than shaving one click, real
 * money being involved. Shown for BOTH purchase entry points (PricingPage,
 * PaywallModal) with the SAME already-created order (see
 * createRazorpayOrder in lib/subscription.js) — this never independently
 * resolves a price; it displays exactly what create-razorpay-order
 * actually computed and will charge, base/gst/total straight from its
 * response, never recomputed here.
 *
 * GST breakdown, 2026-08-14: owner confirmed with their CA that GST applies
 * EXCLUSIVE of the listed price (added on top, not extracted from an
 * unchanged total — an earlier version of this file did the latter, before
 * that confirmation). `order.gst_amount`/`order.base_amount` are always
 * present now (create-razorpay-order always computes them), so the
 * no-tax-line fallback below only matters for a theoretical order created
 * before that server change.
 */
export default function OrderSummaryModal({ plan, order, onConfirm, onCancel }) {
  const [confirming, setConfirming] = useState(false);

  const hasTax = (order.gst_amount ?? 0) > 0;
  const basePaise = order.base_amount ?? order.amount;
  const gstPaise   = order.gst_amount ?? 0;
  const ratePercent = order.tax_rate_percent ?? 0;

  const billingCycle = plan.priceLabel?.includes('/')
    ? `Recurring — billed every ${plan.priceLabel.split('/')[1]}`
    : 'One-time payment, no renewal';

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      // Only resets if still mounted after a failure — a success path
      // navigates/closes before this would run, which is fine either way.
      setConfirming(false);
    }
  };

  return (
    // z-[1000], one above PaywallModal's z-[999] — PaywallModal renders this
    // stacked on top of itself for its own purchase flow rather than
    // duplicating this UI inline; see that file.
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-slate-900">Order Summary</h2>
          <button onClick={onCancel} disabled={confirming}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="font-semibold text-slate-900 text-sm">{plan.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">{plan.description}</p>
            <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1.5">
              <Repeat size={11} /> {billingCycle}
            </p>
          </div>

          {/* What's included — the same features shown on the pricing card,
              so the review step doesn't ask a student to trust a bare price
              with no reminder of what it buys. */}
          {plan.features?.length > 0 && (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">What's included</p>
              <div className="space-y-1.5">
                {plan.features.slice(0, 5).map((f) => (
                  <div key={f} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-slate-500">Amount</span>
              <span className="text-slate-900 font-medium">{formatRupees(basePaise)}</span>
            </div>
            {hasTax && (
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-slate-500">GST ({ratePercent}%)</span>
                <span className="text-slate-900 font-medium">{formatRupees(gstPaise)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-slate-900">Total</span>
              <span className="text-lg font-extrabold text-slate-900">{formatRupees(order.amount)}</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 leading-relaxed">
            Billed by <span className="text-slate-500 font-medium">{BUSINESS_DETAILS.name}</span>
            {' '}· GSTIN {BUSINESS_DETAILS.gstin}
          </div>

          <div className="flex items-center gap-2 text-xs text-primary-700 bg-primary-50 rounded-xl px-3 py-2.5">
            <Zap size={13} className="shrink-0" />
            Your plan activates immediately after payment — no waiting.
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck size={13} className="text-primary-500 shrink-0" />
            Secured by Razorpay · Nothing is charged until you complete checkout
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <Button variant="secondary" full size="md" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button variant="primary" full size="md" onClick={handleConfirm} disabled={confirming}>
            {confirming ? <Loader2 size={15} className="animate-spin" /> : 'Continue to Payment'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
