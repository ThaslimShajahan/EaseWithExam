import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, Building2, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getInvitePreview, redeemCentreInvite } from '../lib/invites';

const PENDING_KEY = 'edu_pending_invite';

/* ─── Typed error messages (spec requirement) ──────────────── */
const ERROR_MESSAGES = {
  not_found:     "This invite link doesn't exist. Double-check the URL and try again.",
  expired:       "This invite link has expired. Ask your coaching centre for a new one.",
  full:          "This invite link has reached its maximum number of uses. Contact your centre for a new link.",
  inactive:      "This invite link has been deactivated. Ask your coaching centre for a new one.",
  user_not_found:"Your profile wasn't found. Please complete onboarding before joining.",
  default:       "Something went wrong. Please try again or contact your coaching centre.",
};

function errorMessage(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.default;
}

/* ─── Branded centre card ──────────────────────────────────── */
function CentreCard({ preview }) {
  const brandColor = preview.brand_color || '#6366f1';
  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-100 max-w-sm w-full">
      <div className="h-2" style={{ background: brandColor }} />
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          {preview.centre_logo_url ? (
            <img
              src={preview.centre_logo_url}
              alt={preview.centre_name}
              className="h-12 w-12 rounded-xl object-contain border border-slate-100"
            />
          ) : (
            <div
              className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ background: brandColor }}
            >
              {(preview.centre_name || 'C')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-base leading-tight">{preview.centre_name}</p>
            {preview.city && <p className="text-xs text-slate-400 mt-0.5">{preview.city}</p>}
          </div>
        </div>

        {preview.batch && (
          <div
            className="text-xs font-semibold px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5"
            style={{ background: `${brandColor}15`, color: brandColor }}
          >
            Batch: {preview.batch}
          </div>
        )}

        <p className="text-sm text-slate-600">
          You've been invited to join <strong>{preview.centre_name}</strong> on EaseWithExam.
          {preview.batch ? ` You'll be placed in the <strong>${preview.batch}</strong> batch.` : ''}
        </p>
      </div>
    </div>
  );
}

/* ─── Main page ────────────────────────────────────────────── */
export default function JoinCentrePage() {
  const { code }       = useParams();
  const navigate       = useNavigate();
  const { currentUser, userProfile } = useAuth();

  const [phase,   setPhase]   = useState('loading');  // loading|preview|redeeming|success|error
  const [preview, setPreview] = useState(null);
  const [result,  setResult]  = useState(null);
  const [errCode, setErrCode] = useState(null);

  /* Step 1: Fetch invite preview (anon-safe) */
  useEffect(() => {
    if (!code) { setErrCode('not_found'); setPhase('error'); return; }

    getInvitePreview(code)
      .then((data) => {
        if (!data.ok) { setErrCode(data.error); setPhase('error'); return; }
        setPreview(data);
        setPhase('preview');
      })
      .catch(() => { setErrCode('default'); setPhase('error'); });
  }, [code]);

  /* Step 2: If already logged in + onboarded → auto-redeem */
  useEffect(() => {
    if (phase !== 'preview' || !preview) return;
    if (!currentUser || !userProfile?.onboarding_completed) return;

    setPhase('redeeming');
    redeemCentreInvite(code, currentUser.uid)
      .then((data) => {
        if (!data.ok) { setErrCode(data.error); setPhase('error'); return; }
        setResult(data);
        setPhase('success');
        localStorage.removeItem(PENDING_KEY);
      })
      .catch(() => { setErrCode('default'); setPhase('error'); });
  }, [phase, preview, currentUser, userProfile, code]);

  function handleJoin() {
    if (!currentUser) {
      localStorage.setItem(PENDING_KEY, code);
      navigate('/auth', { replace: false });
      return;
    }
    if (!userProfile?.onboarding_completed) {
      localStorage.setItem(PENDING_KEY, code);
      navigate('/onboarding', { replace: false });
      return;
    }
    // Already logged in — auto-redeem effect will fire
  }

  const brandColor = preview?.brand_color || '#6366f1';

  /* ── Loading ── */
  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={28} className="animate-spin text-primary-500" />
      </div>
    );
  }

  /* ── Error ── */
  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-6 text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Invite link problem</p>
            <p className="text-sm text-slate-500 mt-1">{errorMessage(errCode)}</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Success ── */
  if (phase === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden max-w-sm w-full">
          <div className="h-2" style={{ background: brandColor }} />
          <div className="p-6 text-center space-y-4">
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center mx-auto"
              style={{ background: `${brandColor}15` }}
            >
              <CheckCircle2 size={28} style={{ color: brandColor }} />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-lg">
                {result?.already_member ? 'Already a member!' : "You're in!"}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {result?.already_member
                  ? `You're already enrolled at ${result.centre_name}.`
                  : `Welcome to ${result?.centre_name}${result?.batch ? ` · ${result.batch}` : ''}.`}
              </p>
            </div>
            <button
              onClick={() => navigate('/dashboard', { replace: true })}
              className="w-full py-3 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-colors"
              style={{ background: brandColor }}
            >
              Go to Dashboard <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Redeeming ── */
  if (phase === 'redeeming') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center space-y-3">
          <Loader2 size={28} className="animate-spin mx-auto" style={{ color: brandColor }} />
          <p className="text-sm text-slate-500">Joining {preview?.centre_name}…</p>
        </div>
      </div>
    );
  }

  /* ── Preview (default) ── */
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 gap-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <Building2 size={20} className="text-slate-300" />
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Coaching centre invite</p>
      </div>

      {preview && <CentreCard preview={preview} />}

      <button
        onClick={handleJoin}
        className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-white flex items-center justify-center gap-2 text-sm shadow-lg transition-opacity hover:opacity-90"
        style={{ background: brandColor }}
      >
        {currentUser ? 'Join now' : 'Sign in & Join'} <ArrowRight size={15} />
      </button>

      {!currentUser && (
        <p className="text-[11px] text-slate-400 text-center max-w-xs">
          You'll be asked to sign in or create an account. After that you'll be automatically added to the centre.
        </p>
      )}
    </div>
  );
}
