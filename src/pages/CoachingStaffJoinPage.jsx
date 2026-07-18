import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, Building2, ArrowRight, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCoachingAdminInvitePreview, redeemCoachingAdminInvite } from '../lib/coachingAdminInvites';

const PENDING_KEY = 'edu_pending_staff_invite';

const ERROR_MESSAGES = {
  invite_not_found: "This invite link doesn't exist. Double-check the URL and ask for a new one.",
  already_redeemed: 'This invite has already been used.',
  expired:           'This invite link has expired. Ask your centre admin for a new one.',
  email_mismatch:    null, // handled specially below (shows the expected email + a sign-out option)
  default:           'Something went wrong. Please try again or contact your centre admin.',
};

function errorMessage(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.default;
}

export default function CoachingStaffJoinPage() {
  const { code }        = useParams();
  const navigate        = useNavigate();
  const { currentUser, signOut } = useAuth();

  const [phase,   setPhase]   = useState('loading'); // loading|preview|redeeming|success|error
  const [preview, setPreview] = useState(null);
  const [errCode, setErrCode] = useState(null);

  useEffect(() => {
    if (!code) { setErrCode('invite_not_found'); setPhase('error'); return; }
    getCoachingAdminInvitePreview(code)
      .then((data) => {
        if (data?.error) { setErrCode(data.error); setPhase('error'); return; }
        setPreview(data);
        setPhase('preview');
      })
      .catch(() => { setErrCode('default'); setPhase('error'); });
  }, [code]);

  useEffect(() => {
    if (phase !== 'preview' || !preview || !currentUser) return;
    setPhase('redeeming');
    redeemCoachingAdminInvite(code, currentUser.uid, currentUser.email)
      .then((data) => {
        if (data?.error) { setErrCode(data.error); setPhase('error'); return; }
        setPhase('success');
        localStorage.removeItem(PENDING_KEY);
      })
      .catch(() => { setErrCode('default'); setPhase('error'); });
  }, [phase, preview, currentUser, code]);

  function handleAccept() {
    if (!currentUser) {
      localStorage.setItem(PENDING_KEY, code);
      navigate('/auth', { replace: false });
    }
    // Already logged in — the redeem effect above fires automatically.
  }

  const brandColor = preview?.centre_brand_color || '#6366f1';

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={28} className="animate-spin text-primary-500" />
      </div>
    );
  }

  if (phase === 'error') {
    const mismatch = errCode === 'email_mismatch';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-6 text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <div>
            <p className="font-bold text-slate-900">{mismatch ? 'Wrong account' : 'Invite link problem'}</p>
            <p className="text-sm text-slate-500 mt-1">
              {mismatch
                ? `This invite is for ${preview?.email}, but you're signed in as ${currentUser?.email}. Sign out and use the invited account instead.`
                : errorMessage(errCode)}
            </p>
          </div>
          {mismatch && (
            <button
              onClick={() => signOut().then(() => navigate('/auth'))}
              className="w-full py-3 rounded-xl font-bold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden max-w-sm w-full">
          <div className="h-2" style={{ background: brandColor }} />
          <div className="p-6 text-center space-y-4">
            <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto" style={{ background: `${brandColor}15` }}>
              <CheckCircle2 size={28} style={{ color: brandColor }} />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-lg">You're in!</p>
              <p className="text-sm text-slate-500 mt-1">Welcome to {preview?.centre_name}'s coaching portal.</p>
            </div>
            <button
              onClick={() => navigate('/coaching/dashboard', { replace: true })}
              className="w-full py-3 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-colors"
              style={{ background: brandColor }}
            >
              Go to Portal <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'redeeming') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center space-y-3">
          <Loader2 size={28} className="animate-spin mx-auto" style={{ color: brandColor }} />
          <p className="text-sm text-slate-500">Setting up your access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 gap-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <Building2 size={20} className="text-slate-300" />
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Coaching staff invite</p>
      </div>

      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-100 max-w-sm w-full">
        <div className="h-2" style={{ background: brandColor }} />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            {preview?.centre_logo_url ? (
              <img src={preview.centre_logo_url} alt={preview.centre_name} className="h-12 w-12 rounded-xl object-contain border border-slate-100" />
            ) : (
              <div className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ background: brandColor }}>
                {(preview?.centre_name || 'C')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-slate-900 text-base leading-tight">{preview?.centre_name}</p>
              <p className="text-xs text-slate-400 mt-0.5 capitalize">{preview?.role?.replace('_', ' ')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2">
            <Mail size={12} /> Invited: <strong className="text-slate-700">{preview?.email}</strong>
          </div>
          <p className="text-sm text-slate-600">
            You've been invited to join <strong>{preview?.centre_name}</strong>'s coaching portal on EaseWithExam.
            Sign in with Google using <strong>{preview?.email}</strong> to accept.
          </p>
        </div>
      </div>

      <button
        onClick={handleAccept}
        className="w-full max-w-sm py-3.5 rounded-2xl font-bold text-white flex items-center justify-center gap-2 text-sm shadow-lg transition-opacity hover:opacity-90"
        style={{ background: brandColor }}
      >
        {currentUser ? 'Accept invite' : 'Sign in & Accept'} <ArrowRight size={15} />
      </button>
    </div>
  );
}
