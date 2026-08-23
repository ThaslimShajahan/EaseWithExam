import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, LogOut, Pencil, Save, X,
  Lock, Mail, Flame, Zap, Trophy, Gift, Copy, Gauge,
  ShieldCheck, Phone, Chrome, Link2, AlertTriangle, Share2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { mapAuthError } from '../lib/authErrors';
import { updateUser } from '../lib/supabase';
import { getUserGamification, getLevelProgress, LEVEL_TITLES } from '../lib/gamification';
import { PLANS } from '../lib/subscription';
import { getQuotaSnapshot, FIELD_LABELS, getExpiryInfo } from '../lib/quota';
import { usePlatformSettings } from '../hooks/usePlatformSettings';
import { formatExamLabel, getCompetitiveExamType, resolveBoard } from '../lib/categories';
import { getOrCreateReferral, redeemReferral, referralShareText, REFERRAL_BONUS_DAYS } from '../lib/referral';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import NotificationSettings from '../components/ui/NotificationSettings';
import PhoneOTP from '../components/auth/PhoneOTP';
import ExpiryBadge from '../components/dashboard/ExpiryBadge';
import { AtomDoodle, StarDoodle, FormulaText, WaveDoodle } from '../components/ui/Illustrations';

/**
 * Google and phone are separate Firebase Auth identities unless explicitly
 * linked (see AuthContext.jsx's sendOTP/verifyOTP `wasLinking` path and
 * linkGoogleAccount) — without linking, a Google-signup student who later
 * logs in via phone gets a brand-new, empty duplicate account. This reads
 * link state straight from Firebase's own currentUser.providerData (the
 * real source of truth for which credentials are attached to this uid)
 * rather than userProfile.auth_method, which only ever stores one string.
 */
function SignInMethods() {
  const { currentUser, linkGoogleAccount } = useAuth();
  const [phoneModal, setPhoneModal] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error,      setError]      = useState('');
  const [linked,     setLinked]     = useState('');

  const providers  = (currentUser?.providerData || []).map((p) => p.providerId);
  const hasGoogle  = providers.includes('google.com');
  const hasPhone   = providers.includes('phone');
  const phoneNumber = currentUser?.providerData?.find((p) => p.providerId === 'phone')?.phoneNumber;

  const handleLinkGoogle = async () => {
    setGoogleBusy(true); setError(''); setLinked('');
    try {
      await linkGoogleAccount();
      setLinked('google');
      setTimeout(() => setLinked(''), 3000);
    } catch (e) {
      const msg = mapAuthError(e);
      if (msg) setError(msg);
    } finally {
      setGoogleBusy(false);
    }
  };

  const handlePhoneLinked = () => {
    setPhoneModal(false);
    setError('');
    setLinked('phone');
    setTimeout(() => setLinked(''), 3000);
  };

  const Row = ({ icon: Icon, label, connected, detail, onConnect, busy }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${connected ? 'bg-emerald-50' : 'bg-slate-100'}`}>
          <Icon size={16} className={connected ? 'text-emerald-600' : 'text-slate-400'} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-800">{label}</p>
          <p className="text-xs text-slate-400">{connected ? (detail || 'Connected') : 'Not linked'}</p>
        </div>
      </div>
      {connected ? (
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><ShieldCheck size={13} /> Active</span>
      ) : (
        <button onClick={onConnect} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50 transition-colors">
          <Link2 size={12} /> {busy ? 'Connecting…' : 'Link'}
        </button>
      )}
    </div>
  );

  return (
    <div>
      <Row icon={Chrome} label="Google" connected={hasGoogle} detail={currentUser?.email} onConnect={handleLinkGoogle} busy={googleBusy} />
      <Row icon={Phone} label="Phone" connected={hasPhone} detail={phoneNumber} onConnect={() => setPhoneModal(true)} />

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">
          <AlertTriangle size={13} className="text-red-500 shrink-0" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}
      {linked && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mt-3">
          <ShieldCheck size={13} className="text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 font-medium">{linked === 'google' ? 'Google' : 'Phone number'} linked successfully.</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
        Linking both means you can sign in with either — losing access to one (lost phone, old Google
        account) never locks you out, and logging in with a linked method always resumes this same
        account instead of creating a new one.
      </p>

      <Modal open={phoneModal} onClose={() => setPhoneModal(false)} title="Link Phone Number" size="sm">
        <PhoneOTP
          onError={setError}
          onStepChange={() => {}}
          onSuccess={handlePhoneLinked}
        />
      </Modal>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card space-y-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value, icon: Icon, hint }) {
  return (
    <div className="py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={13} className="text-slate-300" />}
          <span className="text-sm font-medium text-slate-800">{value || '—'}</span>
        </div>
      </div>
      {hint && <p className="text-[11px] text-slate-400 text-right mt-0.5">{hint}</p>}
    </div>
  );
}

function ProfileHero({ avatar, name, email, editName, setEditName, nameVal, setNameVal, onSave }) {
  const initials = (nameVal || name || 'S')[0].toUpperCase();

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-900 via-primary-800 to-violet-800 text-white p-6">
      <div className="absolute inset-0 pointer-events-none select-none">
        <div className="absolute top-3 right-6">  <AtomDoodle size={56} opacity={0.08} /></div>
        <div className="absolute top-2 right-28"> <StarDoodle size={14} opacity={0.12} /></div>
        <div className="absolute bottom-4 left-8"><FormulaText size={11} opacity={0.10}>E = mc²</FormulaText></div>
        <div className="absolute bottom-0 right-0 left-0"><WaveDoodle width={400} opacity={0.06} /></div>
      </div>

      <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end gap-5">
        <div className="shrink-0 relative">
          <div className="p-[3px] rounded-full bg-gradient-to-br from-amber-300 via-primary-300 to-violet-400 shadow-xl">
            <div className="p-[3px] rounded-full bg-gradient-to-br from-primary-700 to-primary-900">
              {avatar ? (
                <img src={avatar} alt={name} className="h-[84px] w-[84px] rounded-full object-cover" />
              ) : (
                <div className="h-[84px] w-[84px] rounded-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center text-3xl font-bold text-white">
                  {initials}
                </div>
              )}
            </div>
          </div>
          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-emerald-400 border-2 border-white" />
        </div>

        <div className="text-center sm:text-left flex-1 min-w-0">
          <AnimatePresence mode="wait">
            {editName ? (
              <motion.div key="edit" className="flex items-center gap-2 justify-center sm:justify-start"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <input
                  autoFocus
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSave()}
                  className="h-9 px-3 rounded-xl text-sm bg-white/15 border border-white/30 text-white placeholder:text-white/40 outline-none w-44"
                  placeholder="Your name"
                />
                <button onClick={onSave} className="text-emerald-300 hover:text-white">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditName(false)} className="text-white/60 hover:text-white">
                  <X size={16} />
                </button>
              </motion.div>
            ) : (
              <motion.div key="view" className="flex items-center gap-2 justify-center sm:justify-start"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-xl font-bold truncate">{nameVal || name || 'Set your name'}</p>
                <button onClick={() => setEditName(true)} className="p-4 -m-4 text-white/50 hover:text-white transition-colors">
                  <Pencil size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="text-primary-300 text-sm mt-0.5 truncate">{email}</p>
          <div className="flex items-center gap-2 justify-center sm:justify-start mt-2">
            <span className="px-2 py-0.5 rounded-full bg-white/15 text-[11px] font-medium">Google account</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Refer & Earn.
 *
 * Self-contained because it owns three independent async states (code, share,
 * redeem) that nothing else on the page cares about. The code is fetched with
 * get_or_create_referral_code, so the card renders for every student — the
 * previous read-only get_user_referral returned nothing until a row existed,
 * and no code path ever created one, so this card never appeared at all.
 */
function ReferralCard() {
  const { currentUser } = useAuth();
  const [referral, setReferral] = useState(null);
  const [copied,   setCopied]   = useState('');   // '' | 'code' | 'link'
  const [showRedeem, setShowRedeem] = useState(false);
  const [entry,    setEntry]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [result,   setResult]   = useState(null); // { ok, message }

  useEffect(() => {
    if (!currentUser) return;
    getOrCreateReferral(currentUser.uid).then(setReferral).catch(() => {});
  }, [currentUser]);

  const flash = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* clipboard blocked */ }
  };

  // navigator.share is the one that matters on mobile (WhatsApp is how these
  // actually spread); desktop browsers mostly lack it, so it falls back to
  // putting the same message on the clipboard.
  const handleShare = async () => {
    const text = referralShareText(referral.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'EaseWithExam', text });
        return;
      } catch { /* user dismissed the sheet */ }
    }
    flash('link', text);
  };

  const handleRedeem = async () => {
    if (!entry.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await redeemReferral(currentUser.uid, entry);
      setResult(res);
      // No reload on success any more: redeeming only records a pending claim,
      // so there is no new subscription state for AuthContext to pick up. The
      // days arrive when the student subscribes.
      if (res.ok) setEntry('');
    } catch {
      setResult({ ok: false, message: 'Something went wrong. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  };

  if (!referral) return null;

  return (
    <Section title="Refer &amp; Earn">
      <div className="bg-primary-50 border border-primary-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Gift size={18} className="text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Your referral code</p>
            <p className="text-xs text-slate-500">
              You each get {REFERRAL_BONUS_DAYS} days of premium once a friend subscribes with it
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white border border-violet-200 rounded-xl px-4 py-3">
          <span className="flex-1 text-lg font-extrabold text-violet-700 tracking-widest font-mono truncate">
            {referral.code}
          </span>
          <button
            onClick={() => flash('code', referral.code)}
            className={`flex items-center gap-1.5 px-3 py-3.5 rounded-lg text-xs font-semibold transition-all ${
              copied === 'code' ? 'bg-emerald-500 text-white' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'
            }`}
          >
            {copied === 'code' ? <Check size={12} /> : <Copy size={12} />}
            {copied === 'code' ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <button
          onClick={handleShare}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold transition-colors"
        >
          <Share2 size={14} />
          {copied === 'link' ? 'Invite copied to clipboard' : 'Share your invite'}
        </button>

        {/* "Pending" is its own number rather than folded into "subscribed" —
            a friend who has signed up but not paid yet is real progress, and
            hiding it would make the card read as zero for weeks. */}
        <div className="flex items-center gap-3 text-center">
          <div className="flex-1 bg-white rounded-xl py-2 border border-primary-100">
            <p className="text-lg font-extrabold text-primary-700">{referral.uses ?? 0}</p>
            <p className="text-[10px] text-slate-500">Subscribed</p>
          </div>
          <div className="flex-1 bg-white rounded-xl py-2 border border-primary-100">
            <p className="text-lg font-extrabold text-amber-600">{referral.pending ?? 0}</p>
            <p className="text-[10px] text-slate-500">Joined, not yet</p>
          </div>
          <div className="flex-1 bg-white rounded-xl py-2 border border-primary-100">
            <p className="text-lg font-extrabold text-emerald-600">{referral.credits_earned ?? 0}</p>
            <p className="text-[10px] text-slate-500">Days earned</p>
          </div>
        </div>

        <div className="pt-1 border-t border-primary-200">
          {!showRedeem ? (
            <button
              onClick={() => setShowRedeem(true)}
              className="w-full text-xs font-semibold text-primary-700 hover:text-primary-800 pt-2 transition-colors"
            >
              Have a friend&apos;s code? Apply it →
            </button>
          ) : (
            <div className="pt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={entry}
                  onChange={(e) => setEntry(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
                  placeholder="EWEXXXXXX"
                  maxLength={16}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-primary-300"
                />
                <button
                  onClick={handleRedeem}
                  disabled={busy || !entry.trim()}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-40 transition-opacity"
                >
                  {busy ? 'Applying…' : 'Apply'}
                </button>
              </div>
              {result && (
                <p className={`text-xs ${result.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {result.message}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

export default function ProfilePage() {
  const { currentUser, userProfile, subscription, isPremium, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [editName,     setEditName]     = useState(false);
  const [name,         setName]         = useState(userProfile?.display_name || currentUser?.displayName || '');
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [signOutModal, setSignOutModal] = useState(false);
  const [gam,          setGam]          = useState(null);
  const [quotaUsage,   setQuotaUsage]   = useState(null); // { field: {used, limit, unlimited} }

  const avatar = userProfile?.photo_url || currentUser?.photoURL;
  const email  = userProfile?.email     || currentUser?.email;

  useEffect(() => {
    if (!currentUser) return;
    getUserGamification(currentUser.uid).then(setGam).catch(() => {});
  }, [currentUser]);

  // Usage & Limits panel — same quota fields every metered feature checks
  // against (Practice, Mock Tests, EWE Chat, Paper Mode), shown for both
  // free and premium students so "Premium" isn't just a label with no
  // visible numbers behind it. Refreshes live off the same 'ewe:quota-updated'
  // event the Sidebar listens for (fired by incrementQuota in lib/quota.js),
  // instead of only ever reflecting numbers from page load.
  useEffect(() => {
    if (!currentUser) return;
    const fields = Object.keys(FIELD_LABELS);
    const refresh = () => {
      Promise.all(fields.map((f) => getQuotaSnapshot(currentUser.uid, f, isPremium, subscription?.plan)))
        .then((results) => {
          const byField = {};
          fields.forEach((f, i) => { byField[f] = results[i]; });
          setQuotaUsage(byField);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('ewe:quota-updated', refresh);
    return () => window.removeEventListener('ewe:quota-updated', refresh);
  }, [currentUser, isPremium, subscription?.plan]);

  // Sidebar's "Notifications" shortcut links here as /profile#notifications —
  // React Router doesn't auto-scroll to a hash on SPA navigation, so this
  // section needs to bring itself into view once its content (and therefore
  // its real position on the page) has actually rendered.
  useEffect(() => {
    if (location.hash !== '#notifications') return;
    const el = document.getElementById('notifications');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, quotaUsage]);

  const handleSaveName = async () => {
    if (!currentUser || !name.trim()) return;
    setSaving(true);
    try {
      await updateUser(currentUser.uid, { display_name: name.trim() });
      setSaved(true);
      setEditName(false);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const levelInfo = gam ? getLevelProgress(gam.xp ?? 0) : null;
  const levelTitle = levelInfo ? (LEVEL_TITLES[Math.min(levelInfo.level, LEVEL_TITLES.length - 1)] || 'Zenith') : '';
  const basePlanName = subscription?.isActive ? (PLANS[subscription.plan]?.name ?? 'Premium') : 'Free';

  // Found live (2026-08-14): a free student with an active quota grant saw
  // "Plan: Free" here with nothing pointing at the ExpiryBadge just below it —
  // the grant was real and working, this field just didn't know about it.
  // getExpiryInfo() is the same call ExpiryBadge makes, reused rather than
  // re-implementing the grant-precedence rule a second time in this file.
  const [hasActiveGrant, setHasActiveGrant] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.uid) { setHasActiveGrant(false); return; }
    getExpiryInfo(currentUser.uid, subscription).then((info) => {
      if (!cancelled) setHasActiveGrant(info.kind === 'grant');
    });
    return () => { cancelled = true; };
  }, [currentUser?.uid, subscription]);

  // Same admin-editable label ExpiryBadge shows, not a second hardcoded
  // string — a campaign renamed to "Independence Day Special" must read the
  // same way here as it does on the badge two sections down.
  const { quota_grant_badge_label: grantLabel } = usePlatformSettings();
  const planName = hasActiveGrant ? `${basePlanName} (${grantLabel} active)` : basePlanName;

  // formatExamLabel (lib/categories.js) is THE canonical exam-label
  // formatter, shared across every render site (Sidebar, Dashboard,
  // AdminStudents, ParentDashboardPage, here) — not reimplemented locally,
  // which is exactly how the "CLASS 8 9" bug slipped back in via other
  // components after being fixed here once already.
  const formatExam = (e) => formatExamLabel(e, '—');

  // target_exam is now the OPTIONAL competitive add-on, so a board-only
  // student stores 'NONE' — which rendered here as a bare "Target Exam —",
  // an empty row telling them nothing. Show it only when there's a real
  // competitive target; Board/Syllabus and Class/Year below already cover
  // everything a board-only student has.
  //
  // This also subsumes the old "Class 8-9 vs Class 8 says the same thing
  // twice" de-duplication: target_exam can no longer hold a class at all
  // (legacy CLASS_* rows still resolve via normalizeExamType, and
  // getCompetitiveExamType correctly reports them as non-competitive).
  const competitiveExam   = getCompetitiveExamType(userProfile);
  const showTargetExamRow = !!competitiveExam;

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-lg">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-xl font-bold text-slate-900">My Profile</h2>
        <p className="text-sm text-slate-500 mt-0.5">Your identity and academic settings</p>
      </motion.div>

      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <ProfileHero
          avatar={avatar} name={name} email={email}
          editName={editName} setEditName={setEditName}
          nameVal={name} setNameVal={setName}
          onSave={handleSaveName}
        />
      </motion.div>

      {/* Save name button when editing */}
      {editName && (
        <Button
          variant="primary" size="sm" loading={saving}
          icon={saved ? <Check size={14} /> : <Save size={14} />}
          className={saved ? '!bg-emerald-500' : ''}
          onClick={handleSaveName}
        >
          {saved ? 'Name saved!' : 'Save name'}
        </Button>
      )}

      {/* Gamification */}
      {gam && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Section title="Progress">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <Flame size={16} className="text-amber-500 mx-auto mb-1" />
                <p className="text-lg font-extrabold text-amber-600">{gam.streak_days ?? 0}</p>
                <p className="text-[10px] text-amber-500">Day streak</p>
              </div>
              <div className="bg-violet-50 rounded-xl p-3 text-center">
                <Zap size={16} className="text-violet-500 mx-auto mb-1" />
                <p className="text-lg font-extrabold text-violet-600">{(gam.xp ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-violet-500">XP earned</p>
              </div>
              <div className="bg-primary-50 rounded-xl p-3 text-center">
                <Trophy size={16} className="text-primary-500 mx-auto mb-1" />
                <p className="text-lg font-extrabold text-primary-600">{levelInfo?.level ?? 1}</p>
                <p className="text-[10px] text-primary-500">{levelTitle}</p>
              </div>
            </div>

            {levelInfo && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Level {levelInfo.level} — {levelTitle}</span>
                  <span>{levelInfo.pct}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full"
                    initial={{ width: 0 }} animate={{ width: `${levelInfo.pct}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </div>
              </div>
            )}
          </Section>
        </motion.div>
      )}

      {/* Academic profile — READ ONLY */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10 }}>
        <Section title="Academic Profile">
          {showTargetExamRow && <ReadOnlyField label="Target Exam" value={formatExam(userProfile?.target_exam)} />}
          {/* resolveBoard() rather than a raw underscore-strip: 'KERALA_STATE'
              rendered as the shouty "KERALA STATE" instead of "Kerala State". */}
          <ReadOnlyField label="Board / Syllabus" value={resolveBoard(userProfile?.syllabus) || '—'} />
          <ReadOnlyField
            label="Class / Year"
            value={
              !userProfile?.class_level ? '—'
                : userProfile.class_level === 'REPEATER' ? 'Repeater / Dropper'
                : `Class ${userProfile.class_level}`
            }
          />
          <ReadOnlyField label="Plan"         value={planName} />

          {/* Contact admin message */}
          <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <Lock size={13} className="text-slate-400 mt-0.5 shrink-0" />
            <div className="text-xs text-slate-500 leading-relaxed">
              Academic settings can only be changed by an admin.{' '}
              <a
                href="mailto:info@acenzos.com?subject=Profile change request"
                className="text-primary-600 hover:underline font-semibold"
              >
                Contact admin
              </a>{' '}
              to update your exam type, board, or class.
            </div>
          </div>
        </Section>
      </motion.div>

      {/* Usage & Limits — shown for free AND premium so the plan isn't just a label */}
      {quotaUsage && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}>
          <Section title="Usage & Limits">
            <div className="flex items-center justify-between gap-2 -mt-1 mb-1">
              <div className="flex items-center gap-2">
                <Gauge size={13} className="text-slate-400" />
                <span className="text-xs text-slate-500">Resets daily at midnight IST · {planName} plan</span>
              </div>
              <ExpiryBadge />
            </div>
            <div className="space-y-3">
              {Object.entries(FIELD_LABELS).map(([field, label]) => {
                const q = quotaUsage[field];
                if (!q) return null;
                const pct = q.unlimited ? 0 : Math.min(100, Math.round((q.used / Math.max(q.limit, 1)) * 100));
                return (
                  <div key={field}>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="capitalize">{label}</span>
                      <span className="font-medium text-slate-700">
                        {q.unlimited ? `${q.used} used · Unlimited` : `${q.used} / ${q.limit}`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${q.unlimited ? 'bg-emerald-400' : pct >= 100 ? 'bg-red-400' : 'bg-primary-500'}`}
                        style={{ width: q.unlimited ? '100%' : `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {!isPremium && (
              <button
                onClick={() => navigate('/pricing')}
                className="w-full mt-1 py-2.5 rounded-xl bg-primary-50 hover:bg-primary-100 text-primary-700 text-xs font-bold transition-colors"
              >
                Upgrade for unlimited access →
              </button>
            )}
          </Section>
        </motion.div>
      )}

      {/* Referral card */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <ReferralCard />
      </motion.div>

      {/* Notifications */}
      <motion.div id="notifications" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}>
        <Section title="Notifications">
          <NotificationSettings />
        </Section>
      </motion.div>

      {/* Sign-in Methods */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
        <Section title="Sign-in Methods">
          <SignInMethods />
        </Section>
      </motion.div>

      {/* Account */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Section title="Account">
          <button
            onClick={() => navigate('/pricing')}
            className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-primary-50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-primary-50 group-hover:bg-primary-100 flex items-center justify-center transition-colors">
                <Mail size={14} className="text-primary-500" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-slate-700">Subscription</p>
                <p className="text-xs text-slate-400">{planName} plan</p>
              </div>
            </div>
            <ChevronRight size={15} className="text-primary-300" />
          </button>

          <button
            onClick={() => setSignOutModal(true)}
            className="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-red-50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-red-50 group-hover:bg-red-100 flex items-center justify-center transition-colors">
                <LogOut size={15} className="text-red-500" />
              </div>
              <span className="text-sm font-medium text-red-600">Sign out</span>
            </div>
            <ChevronRight size={15} className="text-red-300" />
          </button>
        </Section>
      </motion.div>

      <Modal open={signOutModal} onClose={() => setSignOutModal(false)} title="Sign out?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">You will be returned to the login screen.</p>
          <div className="flex gap-3">
            <Button variant="secondary" full onClick={() => setSignOutModal(false)}>Cancel</Button>
            <Button variant="danger"    full onClick={handleSignOut}>Sign out</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
