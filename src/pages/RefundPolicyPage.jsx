import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';
import { useSeo } from '../lib/seo';

const LAST_UPDATED = 'August 15, 2026';

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="text-sm text-slate-600 leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

/**
 * Plain-language refund policy — a starting point for the business to
 * review/adapt, not a substitute for actual legal review. Processing time is
 * an industry-standard default (5-7 business days), not a confirmed
 * commitment; flagged for owner sign-off before this is treated as final.
 */
export default function RefundPolicyPage() {
  useSeo('/refund');
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PublicNavBar />
      <div className="flex-1 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-primary-50 flex items-center justify-center shrink-0">
            <RotateCcw size={20} className="text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Refund Policy</h1>
            <p className="text-xs text-slate-400 mt-0.5">Last updated: {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="card space-y-6">
          <Section title="7-day refund window">
            <p>If you're not satisfied with a Premium subscription, you can request a full refund within
              7 days of your payment date. This applies to your first payment on a plan — see "Renewals"
              below for subscriptions that have already renewed.</p>
          </Section>

          <Section title="What's eligible">
            <p>Any Premium plan purchase (monthly or yearly) is eligible for a refund if the request is
              made within 7 days of the charge, and the account has not made substantial use of the
              plan's premium features during that window. We look at this in good faith on a
              case-by-case basis, not against a fixed usage cutoff.</p>
          </Section>

          <Section title="Renewals">
            <p>The 7-day window applies to each individual charge, including renewals — a renewal payment
              is refundable within 7 days of that renewal, the same as a first payment. It does not
              extend backwards to charges from more than 7 days ago.</p>
          </Section>

          <Section title="How to request a refund">
            <p>Email{' '}
              <a href="mailto:info@acenzos.com" className="text-primary-600 hover:underline font-semibold">
                info@acenzos.com
              </a>{' '}
              with your registered email address and the payment ID or date of the charge (visible in
              Profile → Billing). We'll confirm eligibility and next steps by email.</p>
          </Section>

          <Section title="Processing time">
            <p>Approved refunds are processed back to your original payment method within 5–7 business
              days via Razorpay. The exact time your bank or card issuer takes to reflect the credit can
              vary beyond that.</p>
          </Section>

          <Section title="Not covered">
            <p>Requests made more than 7 days after the relevant charge, and accounts suspended or
              terminated for violating our{' '}
              <a href="/terms/" className="text-primary-600 hover:underline font-semibold">Terms of Service</a>.</p>
          </Section>

          <Section title="Questions">
            <p>Contact{' '}
              <a href="mailto:info@acenzos.com" className="text-primary-600 hover:underline font-semibold">
                info@acenzos.com
              </a>{' '}
              before purchasing if you want to confirm eligibility for your specific situation.</p>
          </Section>
        </div>
      </div>
      </div>
      <PublicFooter />
    </div>
  );
}
