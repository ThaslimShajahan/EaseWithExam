import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Loader2, Check, MessageCircle, Phone, Mail, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  requestPushPermission, disablePush,
  getNotificationPrefs, updateNotificationPrefs,
} from '../../lib/notifications';
import { requestEmailConnect, confirmEmailConnect } from '../../lib/email';

/**
 * Switch used by the push and email rows.
 *
 * The knob is a normal flex child moved with translate-x, not an absolutely
 * positioned span. The previous version positioned it with `absolute top-0.5`
 * and no `left`, so it started from its static position — which sits after the
 * <button>'s UA default horizontal padding. That pushed the "on" knob past the
 * track's right edge, leaving the switch looking like a plain green pill with
 * the knob hanging off the side. `p-0` kills that default outright, and laying
 * the knob out in flow means its travel no longer depends on UA padding at all.
 */
function Toggle({ on, busy, disabled, onClick, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled || busy}
      className={`relative shrink-0 inline-flex items-center h-6 w-11 p-0 border-0 rounded-full
                  cursor-pointer transition-colors outline-none
                  focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  ${on ? 'bg-primary-600' : 'bg-slate-300'}`}
    >
      <span
        className={`inline-flex items-center justify-center h-5 w-5 rounded-full bg-white shadow-sm
                    transition-transform duration-200 ease-out
                    ${on ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
      >
        {busy && <Loader2 size={11} className="animate-spin text-primary-600" />}
      </span>
    </button>
  );
}

function Field({ label, hint, icon: Icon, iconClass, value, onChange, placeholder, onSave, saving, saved }) {
  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${iconClass}`}>
          <Icon size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          type="tel"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-primary-400 transition-colors"
        />
        <button
          onClick={onSave}
          disabled={saving}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            saved
              ? 'bg-emerald-500 text-white'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          {saved ? <><Check size={13} /> Saved</> : saving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
      </div>
      {value && saved && (
        <p className="text-xs text-emerald-600 font-medium">✓ Active for {value}</p>
      )}
    </div>
  );
}

/* ── No email on file (phone-signup accounts) — request + verify a code
 * instead of the read-only display/toggle. Stored-field + verification, not
 * Firebase account linking: this email is only ever used for notification
 * delivery, never as a second login method, so there's no reason to make
 * the user set a password or handle a Firebase email-link redirect for it. ── */
function ConnectEmailCard({ uid, onConnected }) {
  const [step,     setStep]     = useState('idle'); // idle | sent
  const [emailVal, setEmailVal] = useState('');
  const [code,     setCode]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const ERROR_MESSAGES = {
    invalid_email:      'Enter a valid email address.',
    already_has_email:  'This account already has an email on file.',
    email_taken:         'That email is already connected to a different account.',
    account_not_found:  'Could not find your account — try reloading the page.',
    no_pending_email:   'No verification in progress — request a new code.',
    code_expired:       'That code expired — request a new one.',
    wrong_code:          "That code doesn't match — check and try again.",
  };

  const send = async () => {
    const trimmed = emailVal.trim();
    if (!trimmed) return;
    setBusy(true); setError('');
    try {
      await requestEmailConnect(uid, trimmed);
      setStep('sent');
    } catch (e) {
      setError(ERROR_MESSAGES[e.message] || 'Could not send verification email — try again.');
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (code.trim().length !== 6) return;
    setBusy(true); setError('');
    try {
      const result = await confirmEmailConnect(uid, code.trim());
      if (result?.ok) {
        onConnected(emailVal.trim());
      } else {
        setError(ERROR_MESSAGES[result?.error] || 'Could not verify — try again.');
      }
    } catch {
      setError('Could not verify — try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-slate-100">
          <Mail size={16} className="text-slate-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Email Notifications</p>
          <p className="text-xs text-slate-500">
            {step === 'idle' ? 'No email on file — connect one to receive email notifications' : `Enter the code sent to ${emailVal.trim()}`}
          </p>
        </div>
      </div>

      {step === 'idle' ? (
        <div className="flex gap-2">
          <input
            type="email"
            value={emailVal}
            onChange={(e) => setEmailVal(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-primary-400 transition-colors"
          />
          <button
            onClick={send}
            disabled={busy || !emailVal.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-all"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : 'Connect email'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-primary-400 transition-colors tracking-widest font-mono"
            />
            <button
              onClick={verify}
              disabled={busy || code.trim().length !== 6}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-all"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <><ShieldCheck size={13} /> Verify</>}
            </button>
          </div>
          <button
            onClick={() => { setStep('idle'); setCode(''); setError(''); }}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Use a different email
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  );
}

export default function NotificationSettings() {
  const { currentUser, userProfile } = useAuth();
  const uid   = currentUser?.uid;
  const [connectedEmail, setConnectedEmail] = useState(null);
  // Deliberately DB-sourced only (userProfile.email), not a Firebase
  // currentUser.email fallback — send-email/connect-email's eligibility
  // checks only ever read the users.email column, so showing anything else
  // here (e.g. a Firebase Google-OAuth email not yet synced to the profile
  // row) could tell a student they're covered when the backend would
  // actually skip them for having "no email on file".
  const email = connectedEmail || userProfile?.email || '';

  const [prefs,    setPrefs]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [toggling, setToggling] = useState(false);
  const [emailToggling, setEmailToggling] = useState(false);
  const [waNum,    setWaNum]    = useState('');
  const [phoneNum, setPhoneNum] = useState('');
  const [waSaved,  setWaSaved]  = useState(false);
  const [phSaved,  setPhSaved]  = useState(false);
  // Notification.permission is read into real state (not just inline off
  // `window.Notification`) so the UI actually re-renders after a permission
  // change — reading it inline worked for the happy path (a successful
  // request always triggers a setPrefs re-render anyway), but a DENIED
  // request never called setPrefs, so the status text and toggle position
  // silently never updated even though the browser's real permission had
  // changed.
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [pushError,  setPushError]  = useState('');
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    if (!uid) return;
    getNotificationPrefs(uid).then((p) => {
      setPrefs(p);
      setWaNum(p?.whatsapp_number || '');
      setPhoneNum(p?.phone_number  || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [uid]);

  // Browser permission can become 'granted' through paths this app never
  // drives (the site-settings padlock, a previous device/session, permission
  // granted before this account's notification_prefs row existed) — in all
  // of those, push_enabled in the DB was never set, because it's only ever
  // written inside requestPushPermission()'s own subscribe step. Without
  // this, the toggle stayed off forever with no explanation even though the
  // browser had already granted permission, since nothing ever re-attempted
  // the missing subscribe step on the app's side. Runs once per mount only —
  // calling Notification.requestPermission() when already 'granted' shows no
  // browser prompt, so this is safe to do without a user gesture. Must NOT
  // re-run after a user explicitly disables push (permission stays 'granted'
  // at the browser level even after disablePush(), so re-firing on every
  // prefs change would silently re-enable a toggle the user just turned off).
  const autoReconcileAttempted = useRef(false);
  useEffect(() => {
    if (!uid || loading || autoReconcileAttempted.current) return;
    // Marked done as soon as the first fully-loaded state is evaluated,
    // regardless of whether a mismatch was actually found here — NOT only
    // when a reconcile attempt is made. Otherwise a user who already had
    // push properly enabled (no mismatch on mount, ref never set) and later
    // clicks disable would flip prefs.push_enabled back to false, this
    // effect would re-run, see permission still 'granted' + push_enabled now
    // false, and treat it as a fresh mismatch — silently re-subscribing them
    // right after they turned it off.
    autoReconcileAttempted.current = true;
    if (permission !== 'granted' || prefs?.push_enabled) return;
    setReconciling(true);
    requestPushPermission(uid)
      .then((result) => {
        if (result.granted) {
          setPrefs((p) => ({ ...p, push_enabled: true }));
        } else {
          setPushError('Permission granted, but push setup failed — tap to retry.');
        }
      })
      .catch(() => setPushError('Permission granted, but push setup failed — tap to retry.'))
      .finally(() => setReconciling(false));
  }, [uid, loading, permission, prefs?.push_enabled]);

  const supported = 'Notification' in window;
  const pushOn    = prefs?.push_enabled && permission === 'granted';
  // No prefs row yet means the user has never touched this — matches
  // send-email's own default (opted in unless explicitly turned off).
  const emailOn   = prefs?.email_enabled !== false;

  // Once a user has actively denied the browser's notification prompt,
  // Notification.requestPermission() re-resolves to 'denied' immediately
  // with NO dialog shown at all — the app cannot re-prompt, full stop. Only
  // the browser's own site-settings UI can undo that. Previously the toggle
  // just silently did nothing in this state with zero explanation.
  const pushStatusText = !supported
    ? 'Not supported in this browser'
    : permission === 'denied'
      ? "Blocked — enable notifications in your browser's site settings"
      : reconciling
        ? 'Finishing setup…'
        : pushOn
          ? 'Active — study reminders enabled'
          : 'Enable to get daily study reminders';

  const handleEmailToggle = async () => {
    if (!uid) return;
    setEmailToggling(true);
    try {
      const next = !emailOn;
      await updateNotificationPrefs(uid, { email_enabled: next });
      setPrefs(p => ({ ...p, email_enabled: next }));
    } finally { setEmailToggling(false); }
  };

  const handlePushToggle = async () => {
    if (!uid) return;
    setToggling(true); setPushError('');
    try {
      if (pushOn) {
        await disablePush(uid);
        setPrefs(p => ({ ...p, push_enabled: false, push_endpoint: null }));
        return;
      }
      if (permission === 'denied') {
        // No point calling requestPermission() here — the browser won't
        // show a dialog for an already-denied origin, so the click would
        // otherwise appear to do nothing at all.
        setPushError("Notifications are blocked for this site. Enable them in your browser's site settings, then try again.");
        return;
      }
      const result = await requestPushPermission(uid);
      setPermission('Notification' in window ? Notification.permission : 'unsupported');
      if (result.granted) {
        setPrefs(p => ({ ...p, push_enabled: true }));
      } else if (result.reason === 'denied') {
        setPushError("Notifications are blocked for this site. Enable them in your browser's site settings, then try again.");
      } else {
        setPushError('Could not enable push notifications — try again.');
      }
    } finally { setToggling(false); }
  };

  const saveWhatsApp = async () => {
    if (!uid) return;
    setToggling(true);
    try {
      await updateNotificationPrefs(uid, {
        whatsapp_number:  waNum.trim(),
        whatsapp_enabled: !!waNum.trim(),
      });
      setPrefs(p => ({ ...p, whatsapp_number: waNum.trim(), whatsapp_enabled: !!waNum.trim() }));
      setWaSaved(true);
      setTimeout(() => setWaSaved(false), 2000);
    } finally { setToggling(false); }
  };

  const savePhone = async () => {
    if (!uid) return;
    setToggling(true);
    try {
      await updateNotificationPrefs(uid, {
        phone_number:  phoneNum.trim(),
        call_enabled:  !!phoneNum.trim(),
      });
      setPrefs(p => ({ ...p, phone_number: phoneNum.trim(), call_enabled: !!phoneNum.trim() }));
      setPhSaved(true);
      setTimeout(() => setPhSaved(false), 2000);
    } finally { setToggling(false); }
  };

  if (loading) return <div className="h-20 animate-pulse bg-slate-50 rounded-2xl" />;

  return (
    <div className="space-y-4">
      {/* Push toggle */}
      <div className="p-4 rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${pushOn ? 'bg-primary-50' : 'bg-slate-100'}`}>
              {pushOn ? <Bell size={16} className="text-primary-600" /> : <BellOff size={16} className="text-slate-400" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Push Notifications</p>
              <p className="text-xs text-slate-500 truncate">{pushStatusText}</p>
            </div>
          </div>
          {supported && (
            <Toggle
              on={pushOn}
              busy={toggling || reconciling}
              onClick={handlePushToggle}
              label="Push notifications"
            />
          )}
        </div>
        {pushError && (
          <div className="flex items-start gap-1.5 mt-3 pt-3 border-t border-slate-100">
            <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{pushError}</p>
          </div>
        )}
      </div>

      {/* Email — read-only toggle if the account already has one (Google
          signup, or a phone account that already connected one), otherwise
          the connect-a-new-email flow. Never both — an account with an
          email is never re-prompted to add one. */}
      {email ? (
        <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${emailOn ? 'bg-primary-50' : 'bg-slate-100'}`}>
              <Mail size={16} className={emailOn ? 'text-primary-600' : 'text-slate-400'} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Email Notifications</p>
              <p className="text-xs text-slate-500 truncate">{emailOn ? 'Active' : 'Off'} — sent to {email}</p>
            </div>
          </div>
          <Toggle
            on={emailOn}
            busy={emailToggling}
            onClick={handleEmailToggle}
            label="Email notifications"
          />
        </div>
      ) : (
        <ConnectEmailCard uid={uid} onConnected={setConnectedEmail} />
      )}

      {/* WhatsApp — hidden 2026-08-14 on owner's request (Profile, live and
          dev both). Not deleted: state/save logic (waNum, saveWhatsApp,
          waSaved) is untouched, so this is a one-line change to bring back
          if it's re-enabled later, not a rebuild. */}
      {false && (
        <Field
          label="WhatsApp Alerts"
          hint="Weekly reports, exam alerts, announcements"
          icon={MessageCircle}
          iconClass="bg-emerald-50 text-emerald-600"
          value={waNum}
          onChange={e => setWaNum(e.target.value)}
          placeholder="+91 9876543210"
          onSave={saveWhatsApp}
          saving={toggling}
          saved={waSaved}
        />
      )}

      {/* Call number */}
      <Field
        label="Phone / Call Number"
        hint="Preferred number for important calls"
        icon={Phone}
        iconClass="bg-blue-50 text-blue-600"
        value={phoneNum}
        onChange={e => setPhoneNum(e.target.value)}
        placeholder="+91 9876543210"
        onSave={savePhone}
        saving={toggling}
        saved={phSaved}
      />
    </div>
  );
}
