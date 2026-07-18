import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, LogOut, Pencil, Save, X,
  Lock, Mail, Flame, Zap, Trophy, Gift, Copy,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { updateUser, supabase } from '../lib/supabase';
import { getUserGamification, getLevelProgress, LEVEL_TITLES } from '../lib/gamification';
import { PLANS } from '../lib/subscription';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import NotificationSettings from '../components/ui/NotificationSettings';
import { AtomDoodle, StarDoodle, FormulaText, WaveDoodle } from '../components/ui/Illustrations';

function Section({ title, children }) {
  return (
    <div className="card space-y-4">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={13} className="text-slate-300" />}
        <span className="text-sm font-medium text-slate-800">{value || '—'}</span>
      </div>
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
            <div className="p-[3px] rounded-full bg-gradient-to-br from-primary-800 to-violet-900">
              {avatar ? (
                <img src={avatar} alt={name} className="h-[84px] w-[84px] rounded-full object-cover" />
              ) : (
                <div className="h-[84px] w-[84px] rounded-full bg-gradient-to-br from-primary-500 to-violet-600 flex items-center justify-center text-3xl font-bold text-white">
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
                <button onClick={() => setEditName(true)} className="text-white/50 hover:text-white transition-colors">
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

export default function ProfilePage() {
  const { currentUser, userProfile, subscription, signOut } = useAuth();
  const navigate = useNavigate();

  const [editName,     setEditName]     = useState(false);
  const [name,         setName]         = useState(userProfile?.display_name || currentUser?.displayName || '');
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [signOutModal, setSignOutModal] = useState(false);
  const [gam,          setGam]          = useState(null);
  const [referral,     setReferral]     = useState(null);
  const [copied,       setCopied]       = useState(false);

  const avatar = userProfile?.photo_url || currentUser?.photoURL;
  const email  = userProfile?.email     || currentUser?.email;

  useEffect(() => {
    if (!currentUser) return;
    getUserGamification(currentUser.uid).then(setGam).catch(() => {});
    supabase.rpc('get_user_referral', { p_uid: currentUser.uid })
      .then(({ data }) => { if (data?.[0]) setReferral(data[0]); })
      .catch(() => {});
  }, [currentUser]);

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

  const handleCopyReferral = async () => {
    if (!referral?.code) return;
    try {
      await navigator.clipboard.writeText(referral.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  const levelInfo = gam ? getLevelProgress(gam.xp ?? 0) : null;
  const levelTitle = levelInfo ? (LEVEL_TITLES[Math.min(levelInfo.level, LEVEL_TITLES.length - 1)] || 'Zenith') : '';
  const planName = subscription?.isActive ? (PLANS[subscription.plan]?.name ?? 'Premium') : 'Free';

  const formatExam = (e) => {
    if (!e || e === 'NONE') return '—';
    if (e === 'BOTH') return 'NEET + JEE';
    return e.replace(/_/g, ' ');
  };

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
                    className="h-full bg-gradient-to-r from-violet-500 to-primary-500 rounded-full"
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
          <ReadOnlyField label="Target Exam"  value={formatExam(userProfile?.target_exam)} />
          <ReadOnlyField label="Board / Syllabus" value={userProfile?.syllabus?.replace(/_/g, ' ') || '—'} />
          <ReadOnlyField label="Class / Year" value={userProfile?.class_level ? `Class ${userProfile.class_level}` : '—'} />
          <ReadOnlyField label="Plan"         value={planName} />

          {/* Contact admin message */}
          <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <Lock size={13} className="text-slate-400 mt-0.5 shrink-0" />
            <div className="text-xs text-slate-500 leading-relaxed">
              Academic settings can only be changed by an admin.{' '}
              <a
                href="mailto:support@acenzos.com?subject=Profile change request"
                className="text-primary-600 hover:underline font-semibold"
              >
                Contact admin
              </a>{' '}
              to update your exam type, board, or class.
            </div>
          </div>
        </Section>
      </motion.div>

      {/* Referral card */}
      {referral && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <Section title="Refer &amp; Earn">
            <div className="bg-gradient-to-br from-violet-50 to-primary-50 border border-violet-100 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                  <Gift size={18} className="text-violet-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Your referral code</p>
                  <p className="text-xs text-slate-500">Share with friends — earn premium days when they join</p>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-white border border-violet-200 rounded-xl px-4 py-3">
                <span className="flex-1 text-lg font-extrabold text-violet-700 tracking-widest font-mono">
                  {referral.code}
                </span>
                <button
                  onClick={handleCopyReferral}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    copied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                  }`}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <div className="flex items-center gap-4 text-center">
                <div className="flex-1 bg-white/70 rounded-xl py-2">
                  <p className="text-lg font-extrabold text-primary-700">{referral.uses ?? 0}</p>
                  <p className="text-[10px] text-slate-500">Friends joined</p>
                </div>
                <div className="flex-1 bg-white/70 rounded-xl py-2">
                  <p className="text-lg font-extrabold text-emerald-600">{referral.credits_earned ?? 0}</p>
                  <p className="text-[10px] text-slate-500">Days earned</p>
                </div>
              </div>
            </div>
          </Section>
        </motion.div>
      )}

      {/* Notifications */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}>
        <Section title="Notifications">
          <NotificationSettings />
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
