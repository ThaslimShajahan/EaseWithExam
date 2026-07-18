import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Delete, Loader2, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const SESSION_KEY = 'edu_admin_v1';
export const ROLE_KEY = 'edu_admin_role';

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const PAD = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  [null,'0','del'],
];

/* ── Passcode verify (existing admins) ──────────────────────── */
function PasscodeScreen({ passcodeHash, onSuccess }) {
  const [digits, setDigits] = useState('');
  const [shake,  setShake]  = useState(false);
  const [wrong,  setWrong]  = useState(false);

  const press = async (k) => {
    if (shake) return;
    if (k === 'del') { setDigits((d) => d.slice(0, -1)); return; }
    if (digits.length >= 6) return;

    const next = digits + k;
    setDigits(next);

    if (next.length === 6) {
      const inputHash = await sha256hex(next);
      if (inputHash === passcodeHash) {
        sessionStorage.setItem(SESSION_KEY, '1');
        setTimeout(onSuccess, 250);
      } else {
        setShake(true); setWrong(true);
        setTimeout(() => { setDigits(''); setShake(false); setWrong(false); }, 900);
      }
    }
  };

  return <PinPad title="Admin Portal" subtitle="Enter your 6-digit passcode" digits={digits} shake={shake} wrong={wrong} wrongMsg="Incorrect passcode — try again" onPress={press} />;
}

/* ── First-time passcode setup ──────────────────────────────── */
function SetPasscodeScreen({ uid, onSuccess, onAlreadySet }) {
  const [step,   setStep]   = useState('set');    // 'set' | 'confirm'
  const [first,  setFirst]  = useState('');
  const [digits, setDigits] = useState('');
  const [shake,  setShake]  = useState(false);
  const [wrong,  setWrong]  = useState(false);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const press = async (k) => {
    if (shake || saving) return;
    if (k === 'del') { setDigits((d) => d.slice(0, -1)); return; }
    if (digits.length >= 6) return;

    const next = digits + k;
    setDigits(next);

    if (next.length < 6) return;

    if (step === 'set') {
      setFirst(next);
      setTimeout(() => { setDigits(''); setStep('confirm'); }, 200);
      return;
    }

    // Confirm step
    if (next !== first) {
      setShake(true); setWrong(true);
      setTimeout(() => { setDigits(''); setShake(false); setWrong(false); setStep('set'); setFirst(''); }, 1000);
      return;
    }

    setSaving(true);
    try {
      const hash = await sha256hex(next);
      const { data: ok, error } = await supabase.rpc('admin_set_passcode', { p_uid: uid, p_hash: hash });
      if (error) { setErr('Could not save passcode. Run the latest migration in Supabase.'); setSaving(false); return; }
      if (ok === false) {
        // admin_set_passcode returns false both when the uid isn't an admin AND when a
        // passcode already exists (e.g. an earlier attempt succeeded but this session's
        // cached record was stale). Re-check the real record before showing a dead-end error.
        const { data: rec } = await supabase.rpc('get_admin_record', { p_uid: uid });
        if (rec?.passcode_hash) { onAlreadySet(rec.passcode_hash); return; }
        setErr('Could not save passcode. Run the latest migration in Supabase.');
        setSaving(false);
        return;
      }
      sessionStorage.setItem(SESSION_KEY, '1');
      onSuccess(hash);
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  return (
    <PinPad
      icon={<KeyRound size={30} className="text-white" />}
      title={step === 'set' ? 'Set your passcode' : 'Confirm passcode'}
      subtitle={step === 'set' ? 'Choose a 6-digit admin passcode' : 'Enter the same passcode again'}
      digits={digits}
      shake={shake}
      wrong={wrong}
      wrongMsg="Passcodes don't match — try again"
      onPress={press}
      saving={saving}
      err={err}
    />
  );
}

/* ── Shared pin-pad UI ──────────────────────────────────────── */
function PinPad({ icon, title, subtitle, digits, shake, wrong, wrongMsg, onPress, saving, err }) {
  const handleKey = useCallback((e) => {
    if (/^[0-9]$/.test(e.key) || /^Numpad[0-9]$/.test(e.code)) {
      onPress(e.key.slice(-1));
    } else if (e.key === 'Backspace') {
      onPress('del');
    }
  }, [onPress]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-8 p-6 select-none">
      <motion.div
        className="h-16 w-16 rounded-[22px] bg-gradient-to-br from-primary-500 to-violet-600 flex items-center justify-center shadow-xl"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        {icon ?? <Shield size={30} className="text-white" />}
      </motion.div>

      <div className="text-center">
        <p className="text-white font-bold text-2xl tracking-tight">{title}</p>
        <p className="text-slate-500 text-sm mt-1.5">{subtitle}</p>
      </div>

      <motion.div
        className="flex gap-3.5"
        animate={shake ? { x: [0, -12, 12, -10, 10, -6, 6, 0] } : {}}
        transition={{ duration: 0.5 }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={[
            'h-3.5 w-3.5 rounded-full border-2 transition-all duration-200',
            i < digits.length
              ? wrong ? 'border-red-500 bg-red-500 scale-110' : 'border-white bg-white scale-110'
              : 'border-slate-600 bg-transparent',
          ].join(' ')} />
        ))}
      </motion.div>

      <AnimatePresence>
        {(wrong || err) && (
          <motion.p key="err" className="text-red-400 text-sm -mt-4 text-center max-w-xs"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {err || wrongMsg}
          </motion.p>
        )}
      </AnimatePresence>

      {saving && (
        <div className="flex items-center gap-2 text-slate-400 text-sm -mt-4">
          <Loader2 size={14} className="animate-spin" /> Saving…
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {PAD.flat().map((k, idx) => {
          if (k === null) return <div key={idx} />;
          return (
            <motion.button key={k} whileTap={{ scale: 0.88 }} onClick={() => onPress(k)}
              className={[
                'h-[72px] w-[72px] rounded-full flex items-center justify-center transition-colors font-semibold',
                k === 'del'
                  ? 'bg-transparent text-slate-400 hover:text-white text-lg'
                  : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white text-2xl',
              ].join(' ')}>
              {k === 'del' ? <Delete size={22} /> : k}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main guard ─────────────────────────────────────────────── */
export default function AdminGuard({ children }) {
  const { currentUser, loading } = useAuth();
  const [adminRecord, setAdminRecord] = useState(null);
  const [checking,    setChecking]    = useState(true);
  const [authed,      setAuthed]      = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');

  useEffect(() => {
    if (loading) return;
    if (!currentUser) { setChecking(false); return; }

    const cacheKey = `edu_admin_rec_${currentUser.uid}`;
    const cached   = sessionStorage.getItem(cacheKey);
    if (cached) {
      const rec = JSON.parse(cached);
      // Entries written before passcode_hash was cached lack the key entirely (distinct
      // from a genuine first-time admin, whose cached value is `null`) — treat as stale
      // and re-fetch rather than getting stuck showing first-time setup forever.
      if ('passcode_hash' in rec) {
        sessionStorage.setItem(ROLE_KEY, rec.role);
        setAdminRecord(rec);
        setChecking(false);
        return;
      }
      sessionStorage.removeItem(cacheKey);
    }

    supabase.rpc('get_admin_record', { p_uid: currentUser.uid })
      .then(({ data }) => {
        if (data) {
          const rec = { uid: data.uid, role: data.role, name: data.name, passcode_hash: data.passcode_hash };
          sessionStorage.setItem(cacheKey, JSON.stringify(rec));
          sessionStorage.setItem(ROLE_KEY, rec.role);
          setAdminRecord(rec);
        }
        setChecking(false);
      });
  }, [currentUser, loading]);

  if (loading || checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 size={28} className="text-primary-400 animate-spin" />
      </div>
    );
  }

  // Not signed in → admin login (NOT student dashboard)
  if (!currentUser) return <Navigate to="/admin/login" replace />;

  // Signed in but not an admin
  if (!adminRecord) return <Navigate to="/admin/login" replace />;

  // First-time: no passcode set yet → setup screen
  if (!adminRecord.passcode_hash) {
    const applyHash = (hash) => {
      const rec = { ...adminRecord, passcode_hash: hash };
      sessionStorage.setItem(`edu_admin_rec_${adminRecord.uid}`, JSON.stringify(rec));
      setAdminRecord(rec);
    };
    return (
      <SetPasscodeScreen
        uid={adminRecord.uid}
        onSuccess={applyHash}
        onAlreadySet={applyHash}
      />
    );
  }

  // Passcode verify
  if (!authed) {
    return (
      <PasscodeScreen
        passcodeHash={adminRecord.passcode_hash}
        onSuccess={() => setAuthed(true)}
      />
    );
  }

  return children;
}
