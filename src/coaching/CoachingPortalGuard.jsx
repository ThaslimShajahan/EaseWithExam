import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import { Building2, AlertTriangle, LogOut, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';

export const CoachingContext = createContext(null);
export const useCoaching = () => useContext(CoachingContext);

const SESSION_KEY    = (uid) => `edu_coaching_rec_${uid}`;
const PIN_AUTH_KEY   = (uid) => `edu_coaching_pin_${uid}`;

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── PIN setup screen (first login — no passcode set yet) ── */
function SetupPinScreen({ onSet, loading }) {
  const [pin, setPin]   = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr]   = useState('');
  const [show, setShow] = useState(false);

  async function handleSet() {
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { setErr('PIN must be exactly 6 digits'); return; }
    if (pin !== pin2) { setErr('PINs do not match'); return; }
    setErr('');
    await onSet(pin);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full space-y-5">
        <div className="text-center">
          <div className="h-14 w-14 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={24} className="text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Set Your Portal PIN</h2>
          <p className="text-sm text-slate-500 mt-1">
            Create a 6-digit PIN to secure your coaching portal. You'll need it each session.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">New PIN (6 digits)</label>
            <div className="relative">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                type={show ? 'text' : 'password'}
                placeholder="••••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400 text-center tracking-[0.5em] text-lg font-mono"
              />
              <button
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Confirm PIN</label>
            <input
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="password"
              placeholder="••••••"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400 text-center tracking-[0.5em] text-lg font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleSet()}
            />
          </div>
          {err && <p className="text-xs text-red-500 text-center">{err}</p>}
        </div>

        <button
          onClick={handleSet}
          disabled={loading || pin.length < 6}
          className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <><div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</> : 'Set PIN & Enter'}
        </button>
      </div>
    </div>
  );
}

/* ── PIN entry screen ── */
function EnterPinScreen({ onSubmit, loading, brandColor }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [show, setShow]     = useState(false);
  const [err, setErr]       = useState('');
  const refs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  function handleDigit(i, val) {
    const d = val.replace(/\D/g, '').slice(-1);
    const next = [...digits]; next[i] = d; setDigits(next);
    if (d && i < 5) refs[i + 1].current?.focus();
    if (next.every(x => x !== '') && !d) return;
    if (next.filter(x => x !== '').length === 6 && d) {
      handleSubmit(next.join(''));
    }
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs[i - 1].current?.focus();
  }

  async function handleSubmit(pin) {
    setErr('');
    const ok = await onSubmit(pin || digits.join(''));
    if (!ok) {
      setErr('Incorrect PIN. Try again.');
      setDigits(['', '', '', '', '', '']);
      refs[0].current?.focus();
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full space-y-6">
        <div className="text-center">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: brandColor ? `${brandColor}20` : '#eef2ff' }}
          >
            <ShieldCheck size={24} style={{ color: brandColor || '#6366f1' }} />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Enter Your PIN</h2>
          <p className="text-sm text-slate-500 mt-1">Enter your 6-digit portal PIN to continue</p>
        </div>

        <div className="flex justify-center gap-2">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              value={show ? d : (d ? '•' : '')}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              maxLength={1}
              className="h-12 w-10 rounded-xl border-2 border-slate-200 text-center text-xl font-bold focus:outline-none focus:border-primary-400 transition-colors"
              style={{ borderColor: err ? '#ef4444' : undefined }}
              inputMode="numeric"
              autoFocus={i === 0}
            />
          ))}
        </div>

        <button onClick={() => setShow(v => !v)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto">
          {show ? <><EyeOff size={12} /> Hide digits</> : <><Eye size={12} /> Show digits</>}
        </button>

        {err && <p className="text-xs text-red-500 text-center -mt-2">{err}</p>}

        <button
          onClick={() => handleSubmit(digits.join(''))}
          disabled={loading || digits.some(d => d === '')}
          className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          style={{ background: brandColor || '#6366f1' }}
        >
          {loading ? <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'Unlock Portal'}
        </button>
      </div>
    </div>
  );
}

export default function CoachingPortalGuard({ children }) {
  const { currentUser, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [status,     setStatus]  = useState('checking'); // checking|ok|denied|error|pin|setup
  const [record,     setRecord]  = useState(null);
  const [errMsg,     setErrMsg]  = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) { navigate('/auth', { replace: true }); return; }

    const cached = sessionStorage.getItem(SESSION_KEY(currentUser.uid));
    const pinAuthed = sessionStorage.getItem(PIN_AUTH_KEY(currentUser.uid));

    if (cached && pinAuthed) {
      try { setRecord(JSON.parse(cached)); setStatus('ok'); return; } catch {}
    }

    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_coaching_admin_record', { p_uid: currentUser.uid });
        if (error) throw error;
        if (!data) { setStatus('denied'); return; }
        sessionStorage.setItem(SESSION_KEY(currentUser.uid), JSON.stringify(data));
        setRecord(data);

        // If no passcode set yet → setup screen
        if (!data.passcode_hash) {
          setStatus('setup');
        } else if (!pinAuthed) {
          setStatus('pin');
        } else {
          setStatus('ok');
        }
      } catch (e) {
        setErrMsg(e.message || 'Could not verify access');
        setStatus('error');
      }
    })();
  }, [currentUser, authLoading, navigate]);

  async function handleSetPin(pin) {
    setPinLoading(true);
    try {
      const { data, error } = await supabase.rpc('coaching_admin_set_passcode', {
        p_uid: currentUser.uid, p_passcode: pin,
      });
      if (error) throw error;
      // Refresh record
      const { data: rec } = await supabase.rpc('get_coaching_admin_record', { p_uid: currentUser.uid });
      sessionStorage.setItem(SESSION_KEY(currentUser.uid), JSON.stringify(rec));
      sessionStorage.setItem(PIN_AUTH_KEY(currentUser.uid), '1');
      setRecord(rec);
      setStatus('ok');
    } catch (e) {
      setErrMsg(e.message);
    } finally {
      setPinLoading(false);
    }
  }

  async function handlePinSubmit(pin) {
    setPinLoading(true);
    try {
      const hash = await hashPin(pin);
      if (hash === record?.passcode_hash) {
        sessionStorage.setItem(PIN_AUTH_KEY(currentUser.uid), '1');
        setStatus('ok');
        setPinLoading(false);
        return true;
      }
      setPinLoading(false);
      return false;
    } catch {
      setPinLoading(false);
      return false;
    }
  }

  if (authLoading || status === 'checking') return <SkeletonLoader type="page" />;
  if (!currentUser) return <Navigate to="/auth" replace />;

  if (status === 'denied') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center space-y-4">
          <div className="h-16 w-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
            <p className="text-sm text-slate-500 mt-1">
              This portal is for registered coaching centre staff only.
              Contact your platform administrator to request access.
            </p>
          </div>
          <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-2 font-mono">{currentUser.email}</p>
          <a href="mailto:support@easewithexam.in" className="block text-sm text-primary-600 hover:underline font-medium">
            Request access → support@easewithexam.in
          </a>
          <button
            onClick={signOut}
            className="flex items-center gap-2 mx-auto text-sm text-slate-500 hover:text-red-600 transition-colors"
          >
            <LogOut size={14} /> Sign out and try another account
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center space-y-4">
          <Building2 size={28} className="text-slate-400 mx-auto" />
          <p className="text-slate-500 text-sm">Failed to load portal: {errMsg}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold">Retry</button>
        </div>
      </div>
    );
  }

  if (status === 'setup') return <SetupPinScreen onSet={handleSetPin} loading={pinLoading} />;

  if (status === 'pin') {
    return <EnterPinScreen onSubmit={handlePinSubmit} loading={pinLoading} brandColor={record?.centre_brand_color} />;
  }

  const updateRecord = (patch) => {
    setRecord((prev) => {
      const next = { ...prev, ...patch };
      sessionStorage.setItem(SESSION_KEY(currentUser.uid), JSON.stringify(next));
      return next;
    });
  };

  return (
    <CoachingContext.Provider value={{ record, updateRecord }}>
      {children}
    </CoachingContext.Provider>
  );
}
