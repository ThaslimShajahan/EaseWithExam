import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Check, Crown } from 'lucide-react';
import { PLANS, createRazorpayOrder, openRazorpayCheckout, computeGst, formatRupees } from '../../lib/subscription';
import { usePaymentsEnabled, PAYMENTS_CLOSED_TITLE, PAYMENTS_CLOSED_BODY } from '../../lib/paymentsGate';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';
import { useAuth } from '../../context/AuthContext';
import Button from './Button';
import OrderSummaryModal from './OrderSummaryModal';
import PaymentConfirmation from './PaymentConfirmation';

const DISPLAY_PLANS = ['premium_monthly', 'premium_yearly', 'neet_complete'];

export default function PaywallModal({ onClose, feature, firebaseUid, email, name, onSuccess }) {
  const { refreshSubscription } = useAuth();
  const [selectedPlan, setSelected] = useState('premium_monthly');
  const [paying, setPaying]         = useState(false);
  const [error,  setError]          = useState('');
  // 'picker' -> 'summary' -> 'confirmation', added 2026-08-14 for the same
  // order-review step PricingPage got. Stays in ONE modal shell throughout —
  // unlike PricingPage, the paywall can fire mid-task (mid mock-test, mid
  // practice generation), so a successful payment shows its confirmation
  // inline and closes back into whatever the student was doing, rather than
  // navigating to a full page and losing their place.
  const [step, setStep] = useState('picker');
  const [pendingOrder, setPendingOrder] = useState(null);
  const [transaction,  setTransaction]  = useState(null);

  // Loading counts as closed, so no live Pay button renders before the flag lands.
  const { enabled: paymentsEnabled, loading: paymentsLoading } = usePaymentsEnabled();
  const paymentsClosed = !paymentsEnabled || paymentsLoading;
  const { tax_rate_percent: taxRatePercent } = usePlatformSettings();

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      const { order, plan } = await createRazorpayOrder({ planId: selectedPlan, firebaseUid });
      setPendingOrder({ order, plan, planId: selectedPlan });
      setStep('summary');
    } catch (err) {
      setError(err.message === 'Payment cancelled' ? '' : err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleConfirmOrder = async () => {
    const { order, plan, planId } = pendingOrder;
    await openRazorpayCheckout({
      order, plan, planId, firebaseUid, email, name,
      onSuccess: async (tx) => {
        await refreshSubscription(); // flip isPremium immediately without reload
        setTransaction(tx);
        setStep('confirmation');
        onSuccess?.(tx);
      },
      onFailure: (msg) => {
        setStep('picker');
        if (msg !== 'Payment cancelled') setError(msg);
      },
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
        >
          {step === 'confirmation' ? (
            <div className="px-6 py-6">
              <PaymentConfirmation transaction={transaction} onContinue={onClose} continueLabel="Continue" />
            </div>
          ) : (
          <>
          {/* Header */}
          <div className="relative bg-gradient-to-br from-primary-500 to-primary-800 px-6 py-6 text-white text-center">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 h-7 w-7 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30"
            >
              <X size={14} />
            </button>
            <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
              <Crown size={24} className="text-amber-300" />
            </div>
            <h2 className="text-xl font-bold">Upgrade to Premium</h2>
            {feature && (
              <p className="text-primary-200 text-sm mt-1">
                <strong className="text-white">{feature}</strong> is a Premium feature
              </p>
            )}
          </div>

          {/* Plan selector */}
          <div className="px-5 py-4 space-y-2.5">
            {DISPLAY_PLANS.map((id) => {
              const plan = PLANS[id];
              const active = selectedPlan === id;
              return (
                <button
                  key={id}
                  onClick={() => setSelected(id)}
                  className={[
                    'w-full text-left rounded-2xl border-2 p-3.5 transition-all duration-150',
                    active ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:border-slate-300',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm">{plan.name}</span>
                        {plan.badge && (
                          <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full ${plan.badgeColor}`}>
                            {plan.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{plan.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-900 text-sm">{plan.priceLabel}</p>
                      {plan.priceSuffix && (
                        <p className="text-[10px] text-slate-400">{plan.priceSuffix}</p>
                      )}
                      {/* Same GST-inclusive display as PricingPage's cards —
                          computeGst is display-only, the real charge is
                          create-razorpay-order's own computation. */}
                      {plan.razorpayAmount > 0 && computeGst(plan.razorpayAmount, taxRatePercent).hasTax && (
                        <p className="text-[10px] text-slate-400">
                          + {computeGst(plan.razorpayAmount, taxRatePercent).ratePercent}% GST = {formatRupees(computeGst(plan.razorpayAmount, taxRatePercent).totalPaise)}
                        </p>
                      )}
                    </div>
                  </div>

                  {active && (
                    <div className="mt-2.5 grid grid-cols-1 gap-1">
                      {plan.features.slice(0, 4).map((f) => (
                        <div key={f} className="flex items-center gap-1.5 text-xs text-slate-600">
                          <Check size={11} className="text-emerald-500 shrink-0" /> {f}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* CTA — or the closed notice. The paywall is triggered by hitting a
              quota wall, so a student sees this at their most frustrated moment;
              it must explain, not just fail. The plan picker above stays visible
              so they can still see what they will get on the 14th. */}
          <div className="px-5 pb-5">
            {paymentsClosed ? (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-center">
                <p className="text-sm font-bold text-amber-900">{PAYMENTS_CLOSED_TITLE}</p>
                <p className="mt-1 text-xs text-amber-800/90 leading-relaxed">{PAYMENTS_CLOSED_BODY}</p>
                <Button variant="secondary" full size="md" className="mt-3" onClick={onClose}>
                  Keep using the free plan
                </Button>
              </div>
            ) : (
              <>
                {error && <p className="text-xs text-red-600 mb-2 text-center">{error}</p>}
                <Button
                  variant="primary"
                  full
                  size="lg"
                  loading={paying}
                  icon={<Zap size={16} />}
                  onClick={handlePay}
                >
                  {paying ? 'Opening payment...' : `Pay ${PLANS[selectedPlan]?.priceLabel}`}
                </Button>
                <p className="text-[10px] text-slate-400 text-center mt-2">
                  Secured by Razorpay · Cancel anytime · Money-back guarantee
                </p>
              </>
            )}
          </div>
          </>
          )}
        </motion.div>
      </motion.div>

      {step === 'summary' && pendingOrder && (
        <OrderSummaryModal
          plan={pendingOrder.plan}
          order={pendingOrder.order}
          onConfirm={handleConfirmOrder}
          onCancel={() => { setStep('picker'); setPendingOrder(null); }}
        />
      )}
    </AnimatePresence>
  );
}
