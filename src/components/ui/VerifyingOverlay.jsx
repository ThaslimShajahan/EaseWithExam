import { Loader2 } from 'lucide-react';

/**
 * Full-screen overlay shown for the gap between Razorpay's modal reporting
 * success and verifyAndActivateSubscription actually finishing (a real
 * network round-trip: signature check + activate_subscription RPC). Added
 * 2026-08-15 — without this the screen looked identical to "nothing
 * happening" right after a real payment, which invited a refresh or
 * back-nav mid-verification. z-[1100]: above OrderSummaryModal (z-[1000])
 * and PaywallModal's picker/summary steps, since this can follow either.
 */
export default function VerifyingOverlay() {
  return (
    <div className="fixed inset-0 z-[1100] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl px-8 py-10 max-w-sm w-full text-center shadow-2xl">
        <Loader2 size={40} className="animate-spin text-primary-400 mx-auto mb-5" />
        <h2 className="text-lg font-bold text-white mb-2">Verifying your payment…</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          This only takes a few seconds. Please don't close this page or press back —
          your subscription is being activated.
        </p>
      </div>
    </div>
  );
}
