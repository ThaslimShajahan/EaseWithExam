import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, RefreshCw, Pencil, X, Save, Check, Crown, Trash2, AlertTriangle } from 'lucide-react';
import { adminGetAllUsers, adminGetAllTestSessions, adminGetAllSubscriptions, adminUpdateUser, adminGrantPremium, adminDeleteStudent, adminSetQuotaOverride, adminClearQuotaOverride, adminGetQuotaOverride } from '../lib/supabase';
import { formatExamLabel, resolveBoard } from '../lib/categories';
import { supabase } from '../lib/supabase';
// The onboarding wizard's own rules — same functions, so an admin-set profile
// has an identical shape to a student-set one.
import { classTierFor, flattenSubjects, buildAcademicTrack } from '../lib/streamSelection';
import { EXAM_OPTIONS, BOARD_OPTIONS, CLASS_OPTIONS } from '../lib/onboardingOptions';
import { toLocalInputValue } from '../lib/dateInput';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

// Built from the SAME option source the student onboarding flow writes from,
// not from categories.js. Those are different vocabularies — categories holds
// display keys ('JEE Main', 'Class 8', 'CBSE') while a profile stores the
// onboarding option_key ('JEE_MAIN', 'NONE', 'KERALA_STATE'). Feeding the
// former into these selects meant a board-only student (target_exam='NONE')
// matched no <option> at all, so the select rendered its first entry —
// "NEET UG" — over a value that was actually NONE, and any interaction with
// the dropdown silently retargeted the student.
const getAllExams   = () => EXAM_OPTIONS.map((o) => o.key);
const getAllBoards  = () => BOARD_OPTIONS.map((o) => o.key);
const getAllClasses = () => CLASS_OPTIONS.map((o) => o.key);

const OPTION_TITLE = (opts, key) => opts.find((o) => o.key === key)?.title ?? key;

// Keyed on the stored option_key ('JEE_MAIN'), not the display label
// ('JEE Main') — the old keys never matched a real target_exam value, so
// JEE students silently fell through to the default badge colour.
const EXAM_BADGE = {
  'NEET':         'bg-emerald-900 text-emerald-300',
  'JEE_MAIN':     'bg-blue-900   text-blue-300',
  'JEE_ADVANCED': 'bg-cyan-900   text-cyan-300',
  'BOTH':         'bg-violet-900 text-violet-300',
};

/**
 * Stream + subjects, for repairing a student's profile.
 *
 * Tonight's scoping made users.subjects authoritative for six student screens,
 * and strict: any subject that does not match the board list shows the "complete
 * your subject setup" prompt instead of a picker. Without this editor a student
 * with bad profile data was stuck — they could not fix it and neither could an
 * admin, because admin_update_user whitelisted four fields and neither of these
 * was one of them.
 *
 * Reuses the ONBOARDING RULES rather than restating them: flattenSubjects() and
 * buildAcademicTrack() from lib/streamSelection.js are the same functions the
 * onboarding wizard calls, so an admin-set profile is byte-identical in shape to
 * a student-set one. Only the presentation differs — the wizard's picker is
 * inline JSX bound to its own multi-step state, not a component that can be
 * lifted without refactoring the signup flow. Extracting it is logged as
 * follow-up work rather than done an hour before a deploy.
 */
function StreamSubjectsEditor({ classLevel, syllabus, subjects, academicTrack, onChange }) {
  const [configs, setConfigs] = useState([]);
  const tier = classTierFor(classLevel);

  useEffect(() => {
    if (!tier) { setConfigs([]); return; }
    supabase.from('stream_configs').select('*').eq('is_active', true)
      .then(({ data }) => setConfigs(data ?? []));
  }, [tier]);

  const boardKey = resolveBoard(syllabus) ?? syllabus;
  const forBoard = configs.filter((c) => c.board_key === boardKey && c.class_tier === tier);
  const streamKey = academicTrack?.stream ?? '';
  const streamConfig = forBoard.find((c) => c.stream_key === streamKey) ?? null;

  // Classes 8-10 have no streams; saying so is more useful than an empty picker.
  if (!tier) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-800/40 p-4">
        <p className="text-xs font-semibold text-slate-300 mb-1">Stream &amp; subjects</p>
        <p className="text-[11px] text-slate-500">
          Class {classLevel || '—'} has no stream selection — students see their full board subject
          list. Nothing to set here.
        </p>
      </div>
    );
  }

  const applyStream = (key) => {
    const cfg = forBoard.find((c) => c.stream_key === key) ?? null;
    const track = buildAcademicTrack({
      boardKey, streamKey: key,
      languageChoice: academicTrack?.language_choice ?? null,
      chosenSlotSubjects: [], optional6th: null,
    });
    onChange({
      academic_track: track,
      subjects: cfg ? flattenSubjects({ streamConfig: cfg, chosenSlotSubjects: [], optional6th: null }) : null,
    });
  };

  const toggleSlotSubject = (subject) => {
    const chosen = academicTrack?.chosen_slot_subjects ?? [];
    const slot = streamConfig?.choice_slots?.[0];
    const next = chosen.includes(subject)
      ? chosen.filter((s) => s !== subject)
      : (slot && chosen.length >= slot.count ? chosen : [...chosen, subject]);

    const track = buildAcademicTrack({
      boardKey, streamKey,
      languageChoice: academicTrack?.language_choice ?? null,
      chosenSlotSubjects: next, optional6th: academicTrack?.optional_6th ?? null,
    });
    onChange({
      academic_track: track,
      subjects: flattenSubjects({
        streamConfig, chosenSlotSubjects: next, optional6th: academicTrack?.optional_6th ?? null,
      }),
    });
  };

  const slot = streamConfig?.choice_slots?.[0];
  const chosen = academicTrack?.chosen_slot_subjects ?? [];

  return (
    <div className="rounded-xl border border-white/10 bg-slate-800/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-300">Stream &amp; subjects</p>
        {subjects?.length
          ? <span className="text-[10px] text-emerald-400">{subjects.length} subject{subjects.length === 1 ? '' : 's'} set</span>
          : <span className="text-[10px] text-amber-400">none set — student sees the setup prompt</span>}
      </div>

      <div>
        <label className="text-[11px] text-slate-500 block mb-1">Stream</label>
        <select value={streamKey} onChange={(e) => applyStream(e.target.value)}
          className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-primary-500">
          <option value="">— not set —</option>
          {forBoard.map((c) => <option key={c.stream_key} value={c.stream_key}>{c.label ?? c.stream_key}</option>)}
        </select>
        {!forBoard.length && (
          <p className="text-[11px] text-slate-500 mt-1">No stream configs for {boardKey} {tier}.</p>
        )}
      </div>

      {streamConfig && (
        <>
          {streamConfig.stream_mandatory?.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Locked by this stream</p>
              <div className="flex flex-wrap gap-1.5">
                {streamConfig.stream_mandatory.map((s) => (
                  <span key={s} className="text-[11px] px-2 py-1 rounded-lg bg-slate-700 text-slate-300">{s}</span>
                ))}
              </div>
            </div>
          )}

          {slot && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">
                {slot.label ?? 'Choose'} ({chosen.length}/{slot.count})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(slot.choose_from ?? []).map((s) => {
                  const on = chosen.includes(s);
                  const full = !on && chosen.length >= slot.count;
                  return (
                    <button key={s} onClick={() => toggleSlotSubject(s)} disabled={full}
                      className={`text-[11px] px-2 py-1 rounded-lg transition-colors ${
                        on ? 'bg-primary-600 text-white'
                          : full ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                 : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <p className="text-[11px] text-slate-500 mb-1">Resolved subjects (what the student will see)</p>
        <div className="flex flex-wrap gap-1.5">
          {subjects?.length
            ? subjects.map((s) => <span key={s} className="text-[11px] px-2 py-1 rounded-lg bg-emerald-900/40 text-emerald-300">{s}</span>)
            : <span className="text-[11px] text-slate-500">—</span>}
        </div>
        {subjects?.length > 0 && (
          <button onClick={() => onChange({ subjects: null, academic_track: null })}
            className="mt-2 text-[11px] text-slate-500 hover:text-red-400">Clear subjects</button>
        )}
      </div>
    </div>
  );
}

/**
 * Grant preset — replaces the removed global campaign. High enough that no
 * real student ever notices it as a limit; capped, not Infinity, so a leaked
 * credential or a runaway loop still has a ceiling. ~2.5x premium on every
 * field except mock_tests, left NULL: premium already grants -1 (unlimited)
 * there, and writing a number would DOWNGRADE a student meant to be rewarded.
 */
const GRANT_PRESET = {
  ai_questions: 500, veda_messages: 300, mock_tests: null,
  paper_evaluations: 50, podcasts: 50, paper_generations: 25,
};

const GRANT_FIELDS = [
  ['ai_questions', 'AI questions/day'], ['veda_messages', 'EWE messages/day'],
  ['mock_tests', 'Mock tests/week'], ['paper_evaluations', 'Evaluations/day'],
  ['podcasts', 'Podcasts/day'], ['paper_generations', 'Full papers/day'],
];

const DURATION_PRESETS = [3, 5, 7, 14]; // days

/**
 * Per-student "unlimited until [date]" grant. Reads/writes quota_overrides
 * through the three RPCs added in 20260814080000 — this component owns no
 * quota logic of its own, only the form around it.
 */
function QuotaGrantEditor({ firebaseUid }) {
  const [existing, setExisting] = useState(null); // current grant, or null
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState({ ...GRANT_PRESET, expiresAt: '', reason: '' });
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminGetQuotaOverride(getCallerUid(), firebaseUid).then((row) => {
      if (cancelled) return;
      if (row?.id) {
        setExisting(row);
        setForm({
          ai_questions: row.ai_questions, veda_messages: row.veda_messages,
          mock_tests: row.mock_tests, paper_evaluations: row.paper_evaluations,
          podcasts: row.podcasts, paper_generations: row.paper_generations,
          expiresAt: row.expires_at ? toLocalInputValue(new Date(row.expires_at)) : '',
          reason: row.reason || '',
        });
      } else {
        setExisting(null);
        setForm({ ...GRANT_PRESET, expiresAt: '', reason: '' });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [firebaseUid]);

  const daysLeft = existing?.expires_at
    ? Math.max(0, Math.ceil((new Date(existing.expires_at) - new Date()) / 86_400_000))
    : null;
  const isExpired = existing?.expires_at && new Date(existing.expires_at) <= new Date();

  const set = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const handleGrant = async () => {
    setSaving(true); setError('');
    try {
      if (!form.expiresAt) throw new Error('An end date is required.');
      const isoExpiry = new Date(form.expiresAt).toISOString();
      const row = await adminSetQuotaOverride(getCallerUid(), firebaseUid, {
        ai_questions: form.ai_questions, veda_messages: form.veda_messages,
        mock_tests: form.mock_tests, paper_evaluations: form.paper_evaluations,
        podcasts: form.podcasts, paper_generations: form.paper_generations,
      }, isoExpiry, form.reason || null);
      setExisting(row);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true); setError('');
    try {
      await adminClearQuotaOverride(getCallerUid(), firebaseUid);
      setExisting(null);
      setForm({ ...GRANT_PRESET, expiresAt: '', reason: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-emerald-300">Quota grant</p>
        {existing && !isExpired
          ? <span className="text-[10px] text-emerald-400">active — {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>
          : existing && isExpired
            ? <span className="text-[10px] text-slate-500">expired — reverted to plan limits</span>
            : <span className="text-[10px] text-slate-500">none</span>}
      </div>

      {existing && !isExpired && (
        <p className="text-[11px] text-slate-400">
          Ends {new Date(existing.expires_at).toLocaleString()}
          {existing.reason ? ` — "${existing.reason}"` : ''}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {GRANT_FIELDS.map(([key, label]) => (
          <div key={key}>
            <label className="text-[10px] text-slate-500 block mb-0.5">{label}</label>
            <input type="number" min="0"
              value={form[key] ?? ''}
              placeholder={key === 'mock_tests' ? 'plan default' : '0'}
              onChange={(e) => set(key, e.target.value === '' ? null : Number(e.target.value))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500" />
          </div>
        ))}
      </div>

      <div>
        <label className="text-[10px] text-slate-500 block mb-0.5">Ends at (required)</label>
        <div className="flex gap-1.5 mb-1.5">
          {DURATION_PRESETS.map((days) => (
            <button key={days} type="button"
              onClick={() => set('expiresAt', toLocalInputValue(new Date(Date.now() + days * 86_400_000)))}
              className="flex-1 py-1 rounded-lg text-[10px] font-semibold bg-slate-800 hover:bg-emerald-900/40 hover:text-emerald-300 text-slate-400 border border-white/10 transition-colors">
              {days}d
            </button>
          ))}
        </div>
        <input type="datetime-local" value={form.expiresAt}
          onChange={(e) => set('expiresAt', e.target.value)}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500" />
      </div>

      <div>
        <label className="text-[10px] text-slate-500 block mb-0.5">Reason (optional, shown in changelog)</label>
        <input value={form.reason} onChange={(e) => set('reason', e.target.value)}
          placeholder="e.g. beta tester, support case #123"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-slate-600 outline-none focus:border-emerald-500" />
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button onClick={handleGrant} disabled={saving}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${
            saved ? 'bg-emerald-600 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900'} disabled:opacity-50`}>
          {saved ? 'Granted!' : saving ? 'Saving…' : existing ? 'Update grant' : 'Grant quota'}
        </button>
        {existing && (
          <button onClick={handleClear} disabled={saving}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-50">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Edit drawer ─────────────────────────────────────────── */

function EditDrawer({ user, onClose, onSaved }) {
  const [form,         setForm]         = useState({
    display_name: user.display_name || '',
    // 'NONE' (board exams only), not 'NEET' — defaulting a student with no
    // stored target to NEET is exactly how an admin could save one in by accident.
    target_exam:  user.target_exam  || 'NONE',
    syllabus:     user.syllabus     || 'CBSE',
    class_level:  user.class_level  || '12',
    // Both already arrive from admin_list_users (it returns whole rows); they
    // were simply never shown. Writable since 20260814070000.
    subjects:       user.subjects       ?? null,
    academic_track: user.academic_track ?? null,
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
      await adminUpdateUser(getCallerUid(), user.firebase_uid, {
        display_name: form.display_name.trim() || null,
        target_exam:  form.target_exam,
        syllabus:     form.syllabus,
        class_level:  form.class_level,
        // Sent explicitly, including as null — the RPC distinguishes "key
        // absent, leave alone" from "key present and null, clear it", and
        // clearing is a state an admin must be able to restore (it is what
        // every Class 8-10 student looks like).
        subjects:       form.subjects,
        academic_track: form.academic_track,
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
      await adminGrantPremium(user.firebase_uid, grantPlan, getCallerUid());
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
              {getAllExams().map((e) => (
                <option key={e} value={e}>{OPTION_TITLE(EXAM_OPTIONS, e)}</option>
              ))}
            </select>
          </Field>

          <Field label="Board / Syllabus">
            <select
              value={form.syllabus}
              onChange={(e) => set('syllabus', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-primary-500"
            >
              {getAllBoards().map((b) => (
                <option key={b} value={b}>{OPTION_TITLE(BOARD_OPTIONS, b)}</option>
              ))}
            </select>
          </Field>

          <Field label="Class / Year">
            <select
              value={form.class_level}
              onChange={(e) => set('class_level', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-primary-500"
            >
              {getAllClasses().map((c) => (
                <option key={c} value={c}>{OPTION_TITLE(CLASS_OPTIONS, c)}</option>
              ))}
            </select>
          </Field>

          <QuotaGrantEditor firebaseUid={user.firebase_uid} />

          <StreamSubjectsEditor
            classLevel={form.class_level}
            syllabus={form.syllabus}
            subjects={form.subjects}
            academicTrack={form.academic_track}
            onChange={(next) => setForm((f) => ({ ...f, ...next }))}
          />

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
              {/* 1095, not 365 — this label was wrong. adminGrantPremium()
                  (lib/supabase.js) has always granted 3 years for this plan. */}
              <option value="neet_complete">3-Year Plan (1095 days)</option>
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

/* ── Delete confirm — type the student's name to confirm, since this ── */
/* ── permanently deletes their account and all history everywhere.   ── */
function DeleteConfirmModal({ user, onClose, onDeleted }) {
  const [typed,   setTyped]   = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error,   setError]   = useState('');
  const name = user.display_name || user.email || user.firebase_uid;

  const handleDelete = async () => {
    setDeleting(true); setError('');
    try {
      await adminDeleteStudent(getCallerUid(), user.firebase_uid);
      onDeleted(user.firebase_uid);
      onClose();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-slate-900 border border-red-500/30 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4"
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-red-400" />
          </div>
          <h3 className="font-bold text-white">Delete "{name}"?</h3>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          This permanently deletes this student's account, subscription, test history, progress, flashcards,
          and every other record tied to them. <strong className="text-red-400">This cannot be undone.</strong>
        </p>
        <div>
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">
            Type <span className="text-white">{name}</span> to confirm
          </label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-red-500"
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-red-400 bg-red-900/30 rounded-xl p-3">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={typed !== name || deleting}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
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
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([adminGetAllUsers(getCallerUid()), adminGetAllTestSessions(), adminGetAllSubscriptions(getCallerUid())])
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

  const handleDeleted = (firebaseUid) => {
    setUsers((prev) => prev.filter((u) => u.firebase_uid !== firebaseUid));
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
            <span>Actions</span>
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
                    {formatExamLabel(u.target_exam, 'N/A')}
                  </span>

                  <span className="text-xs text-slate-400 text-center">
                    {u.class_level ? (u.class_level === 'REPEATER' ? 'Drop' : `Cl.${u.class_level}`) : '—'}
                  </span>

                  <span className="text-sm text-slate-300 text-right">{tests}</span>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditing(u)}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-primary-700 text-slate-400 hover:text-white transition-colors"
                      title="Edit / Grant Premium"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => setDeleting(u)}
                      className="h-7 w-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-red-700 text-slate-400 hover:text-white transition-colors"
                      title="Delete student"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
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

      {/* Delete confirm */}
      <AnimatePresence>
        {deleting && (
          <DeleteConfirmModal
            user={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={handleDeleted}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
