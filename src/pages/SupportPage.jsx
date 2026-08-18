import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { PublicNavBar } from '../components/layout/PublicChrome';

// Redber's own hosted chat page for this bot — confirmed live (200) as a
// genuine standalone page, not just a fragment meant for their iframe
// widget. Embedding it full-page here, rather than their widget.js's
// floating panel, is what avoids the floating-bubble problems (hardcoded
// bottom-right position colliding with real page content, a generic icon
// we can't restyle, and an unconditional 5-second auto-open) — see
// docs/CHANGELOG.md 2026-08-19 for the full reasoning.
const REDBER_EMBED_URL = 'https://redber.in/embed/ewe-support-vo3wl';

export default function SupportPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PublicNavBar />
      <div className="px-4 py-6 lg:py-10">
        <div className="max-w-2xl w-full mx-auto flex flex-col gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors self-start"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary-50 flex items-center justify-center shrink-0">
              <MessageCircle size={20} className="text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">Chat with us</h1>
              <p className="text-xs text-slate-400 mt-0.5">EWE Support · Student Support Assistant</p>
            </div>
          </div>

          {/* rounded + overflow-hidden is what keeps Redber's own black chat
              background from reading as a bare, unstyled void against the
              rest of this page — it's clipped into a proper card frame like
              every other surface in this app, instead of going edge-to-edge.
              An explicit height (not min-h inside a flex-1 chain) — Redber's
              own page needs a definite, already-resolved iframe height on
              first layout or its message list renders blank; confirmed by
              testing a plain fixed-height iframe against the same URL. */}
          <div className="bg-white rounded-3xl shadow-card border border-slate-100 overflow-hidden" style={{ height: '70vh' }}>
            <iframe
              title="Support chat"
              src={REDBER_EMBED_URL}
              allow="microphone"
              className="w-full h-full border-0 block"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
