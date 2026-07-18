import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, RefreshCw, Pencil, X, Save, Check, Crown } from 'lucide-react';
import { adminGetAllUsers, adminGetAllTestSessions, adminGetAllSubscriptions, updateUser, adminGrantPremium } from '../lib/supabase';

// Must match categories.js keys exactly so target_exam reads back correctly
const ALL_EXAMS = [
  'NEET', 'JEE Main', 'JEE Advanced', 'BOTH',
  'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12',
  'CUET', 'UPSC', 'SSC CGL', 'Olympiad',
  'CBSE', 'ICSE', 'State Board',
];
const ALL_BOARDS   = ['CBSE', 'ICSE', 'Kerala State', 'Other State', 'NA'];
const ALL_CLASSES  = ['8', '9', '10', '11', '12', 'REPEATER'];

const EXAM_BADGE = {
  'NEET':         'bg-emerald-900 text-emerald-300',
  'JEE Main':     'bg-blue-900   text-blue-300',
  'JEE Advanced': 'bg-cyan-900   text-cyan-300',
  'BOTH':         'bg-violet-900 text-violet-300',
};

/* ── Edit drawer ─────────────────────────────────────────── */

function EditDrawer({ user, onClose, onSaved }) {
  const [form,         setForm]         = useState({
    display_name: user.display_name || '',
    target_exam:  user.target_exam  || 'NEET',
    syllabus:     user.syllabus     || 'CBSE',
    class_level:  user.class_level  || '12',
  });
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [grantingPrem, setGrantingPrem] = useState(false);
  const [premGranted,  setPremGranted]  = useState(false);
  const [grantPlan,    setGrantPlan]    = useState('premium_yearly');
  const [error,        setError]        = useState('');

  const set = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateUser(user.firebase_uid, {
        display_name: form.display_name.trim() || null,
        target_exam:  form.target_exam,
        syllabus:     form.syllabus,
        class_level:  form.class_level,
      });
      setSaved(true);
      onSaved({ ...user, ...form });
      setTimeout(() => { setSaved(false); onClose(); }, 1200);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const handleGrantPremium = async () => {
    setGrantingPrem(true);
    setError('');
    try {
      await adminGrantPremium(user.firebase_uid, grantPlan);
      setPremGranted(true);
      onSaved({ ...user }); // refresh parent list to show Crown badge
      setTimeout(() => { setPremGranted(false); onClose(); }, 2000);
    } catch (e) {
      setError(`Failed: ${e.message}. Make sure the subscriptions migration has been run in Supabase SQL Editor.`);
    } finally {
      setGrantingPrem(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <motion.div
        className="w-full max-w-sm bg-slate-900 border-l border-white/10 flex flex-col h-full"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h3 className="font-bold text-white">Edit Student</h3>
            <p className="text-slate-400 text-xs mt-0.5 truncate max-w-[200px]">
              {user.email}
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-white/10 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Avatar */}
          <div className="flex items-center gap-3">
            {user.photo_url ? (
              <img src={user.photo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-full bg-primary-800 flex items-center justify-center text-white font-bold">
                {(user.display_name || user.email || 'S')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-white text-sm font-medium">{user.display_name || '—'}</p>
              <p className="text-slate-400 text-xs">Firebase UID: {user.firebase_uid?.slice(0, 12)}…</p>
            </div>
          </div>

          <Field label="Display Name">
            <input
              value={form.display_name}
              onChange={(e) => set('display_name', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-primary-500"
              placeholder="Student's name"
            />
          </Field>

          <Field label="Target Exam">
            <select
              value={form.target_exam}
              onChange={(e) => set('target_exam', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-primary-500"
            >
              {ALL_EXAMS.map((e) => (
                <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>

          <Field label="Board / Syllabus">
            <select
              value={form.syllabus}
              onChange={(e) => set('syllabus', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-primary-500"
            >
              {ALL_BOARDS.map((b) => (
                <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>

          <Field label="Class / Year">
            <select
              value={form.class_level}
              onChange={(e) => set('class_level', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-primary-500"
            >
              {ALL_CLASSES.map((c) => (
                <option key={c} value={c}>{c === 'REPEATER' ? 'Repeater / Dropper' : `Class ${c}`}</option>
              ))}
            </select>
          </Field>

          {/* Grant Premium section */}
          <div className="border border-amber-500/30 bg-amber-950/30 rounded-xl p-4 space-y-2.5">
            <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
              <Crown size={12} /> Grant Premium Access
            </p>
            <select
              value={grantPlan}
              onChange={(e) => setGrantPlan(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
            >
              <option value="premium_monthly">Premium Monthly (30 days)</option>
              <option value="premium_yearly">Premium Yearly (365 days)</option>
              <option value="neet_complete">NEET Complete (365 days)</option>
            </select>
            <button
              onClick={handleGrantPremium}
              disabled={grantingPrem}
              className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
                premGranted
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-900'
              }`}
            >
              {premGranted ? <><Check size={12} /> Premium granted!</> : grantingPrem ? 'Granting…' : <><Crown size={12} /> Grant Premium (Free)</>}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-900/30 rounded-xl p-3">{error}</p>
          )}
        </div>

        {/* Save */}
        <div className="p-5 border-t border-white/10">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
              saved ? 'bg-emerald-600 text-white' : 'bg-primary-600 hover:bg-primary-500 text-white'
            }`}
          >
            {saved ? <><Check size={15} /> Saved!</> : saving ? 'Saving…' : <><Save size={15} /> Save Changes</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1.5">{label}</p>
      {children}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────── */

export default function AdminStudents() {
  const [users,    setUsers]    = useState([]);
  const [sessions, setSessions] = useState([]);
  const [subs,     setSubs]     = useState({});
  const [query,    setQuery]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([adminGetAllUsers(), adminGetAllTestSessions(), adminGetAllSubscriptions()])
      .then(([u, s, subscriptions]) => {
        setUsers(u || []);
        setSessions(s || []);
        const subMap = {};
        (subscriptions || []).forEach((sub) => { subMap[sub.user_id] = sub; });
        setSubs(subMap);
        setLoading(false);
      });
  };

  useEffect(load, []);

  const testCountMap = {};
  (sessions || []).forEach((s) => {
    testCountMap[s.firebase_uid] = (testCountMap[s.firebase_uid] || 0) + 1;
  });

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.display_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)        ||
      u.target_exam?.toLowerCase().includes(q)
    );
  });

  const handleSaved = (updated) => {
    setUsers((prev) => prev.map((u) => u.firebase_uid === updated.firebase_uid ? { ...u, ...updated } : u));
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Students</h1>
          <p className="text-slate-400 text-sm mt-1">{users.length} registered accounts</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-slate-800 border border-white/5 rounded-xl px-4">
        <Search size={15} className="text-slate-500 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or exam…"
          className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-slate-600 outline-none"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="h-4 w-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
          Loading students…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center gap-3">
          <Users size={36} className="text-slate-700" />
          <p className="text-slate-500">No students found</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-2xl border border-white/5 overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-x-4 px-5 py-3 border-b border-white/5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            <span>#</span>
            <span>Student</span>
            <span>Plan</span>
            <span>Exam</span>
            <span>Class</span>
            <span>Tests</span>
            <span>Edit</span>
          </div>
          <div className="divide-y divide-white/5">
            {filtered.map((u, idx) => {
              const avatar  = u.photo_url;
              const name    = u.display_name || u.email?.split('@')[0] || 'Unknown';
              const tests   = testCountMap[u.firebase_uid] || 0;
              const badge   = EXAM_BADGE[u.target_exam] || 'bg-slate-700 text-slate-400';
              const sub     = subs[u.firebase_uid];
              const isPrem  = sub?.isActive === true;

              return (
                <motion.div
                  key={u.firebase_uid}
                  className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-x-4 items-center px-5 py-3 hover:bg-white/5 transition-colors"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }}
                >
                  <span className="text-xs text-slate-600">{idx + 1}</span>

                  <div className="flex items-center gap-3 min-w-0">
                    {avatar ? (
                      <img src={avatar} alt={name} className="h-8 w-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-primary-800 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {name[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-white font-medium truncate">{name}</p>
                      <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
                    </div>
                  </div>

                  {/* Plan badge */}
                  {isPrem ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-600/30">
                      <Crown size={9} /> {sub.plan?.replace(/_/g, ' ') || 'Premium'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600 font-medium">Free</span>
                  )}

                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>
                    {u.target_exam === 'BOTH' ? 'NEET+JEE' : (u.target_exam?.replace(/_/g, ' ') || 'N/A')}
                  </span>

                  <span className="text-xs text-slate-400 text-center">
                    {u.class_level ? (u.class_level === 'REPEATER' ? 'Drop' : `Cl.${u.class_level}`) : '—'}
                  </span>

                  <span className="text-sm text-slate-300 text-right">{tests}</span>

                  <button
                    onClick={() => setEditing(u)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-primary-700 text-slate-400 hover:text-white transition-colors"
                    title="Edit / Grant Premium"
                  >
                    <Pencil size={12} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit drawer */}
      <AnimatePresence>
        {editing && (
          <EditDrawer
            user={editing}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
