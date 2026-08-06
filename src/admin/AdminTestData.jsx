import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Trash2, Loader2, CheckCircle2, XCircle,
  Users, BookOpen, Brain, Building2, Bell, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* ── Test UID constants (all cleanup queries target this prefix) ── */
const TEST_PREFIX  = 'TEST_DUMMY_';
const TEST_UIDS    = ['TEST_DUMMY_001', 'TEST_DUMMY_002', 'TEST_DUMMY_003'];
const TEST_CENTRE  = 'Test Academy Demo';
const TODAY        = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/* ── Seed helpers ─────────────────────────────────────────── */

async function seedStudents() {
  const rows = TEST_UIDS.map((uid, i) => ({
    firebase_uid:         uid,
    display_name:         `Test Student ${i + 1}`,
    email:                `test.student${i + 1}@dummy.edu`,
    target_exam:          i === 2 ? 'JEE_MAIN' : 'NEET',
    class_level:          i === 0 ? '11' : '12',
    onboarding_completed: true,
    auth_method:          'google',
  }));
  const { error } = await supabase.rpc('admin_bulk_upsert_test_users', {
    p_caller: getCallerUid(), p_rows: rows,
  });
  if (error) throw new Error('users: ' + error.message);
  return `${rows.length} test students upserted`;
}

async function seedGameification() {
  const rows = TEST_UIDS.map((uid, i) => ({
    user_id:                  uid,
    xp:                       (i + 1) * 250,
    level:                    i + 1,
    streak_days:              (i + 1) * 3,
    total_questions_answered: (i + 1) * 40,
    total_tests_taken:        i + 2,
    last_activity_date:       TODAY,
  }));
  const { error } = await supabase.from('user_gamification').upsert(rows, { onConflict: 'user_id' });
  if (error) throw new Error('user_gamification: ' + error.message);
  return `${rows.length} gamification rows upserted`;
}

async function seedQuota() {
  const rows = TEST_UIDS.map((uid, i) => ({
    user_id:            uid,
    usage_date:         TODAY,
    ai_questions_used:  i * 5,
    veda_messages_used: i * 3,
    mock_tests_used:    i,
  }));
  const { error } = await supabase.from('daily_usage_quota').upsert(rows, { onConflict: 'user_id,usage_date' });
  if (error) throw new Error('daily_usage_quota: ' + error.message);
  return `${rows.length} quota rows upserted for today`;
}

const SUBJECTS   = ['Biology', 'Physics', 'Chemistry'];
const TOPICS     = ['Cell Biology', 'Optics', 'Chemical Bonding', 'Genetics', 'Motion', 'Acids & Bases'];
const QN_TYPES   = ['MCQ', 'Assertion-Reason'];
const SOURCES    = ['practice', 'mock_test'];

async function seedQuestionHistory() {
  const rows = [];
  TEST_UIDS.forEach(uid => {
    TOPICS.forEach((topic, ti) => {
      rows.push({
        user_id:       uid,
        question_id:   `dummy-${uid}-${ti}`,
        question_text: `Dummy question about ${topic} for testing purposes.`,
        subject:       SUBJECTS[ti % 3],
        topic,
        question_type: QN_TYPES[ti % 2],
        is_correct:    ti % 3 !== 0,
        source:        SOURCES[ti % 2],
        due_date:      TODAY,
        ease_factor:   2.5,
        interval_days: 1,
        repetitions:   0,
        is_mastered:   false,
      });
    });
  });
  const { error } = await supabase.rpc('admin_seed_question_history', {
    p_caller: getCallerUid(), p_uids: TEST_UIDS, p_rows: rows,
  });
  if (error) throw new Error('question_history: ' + error.message);
  return `${rows.length} question history rows inserted`;
}

async function seedWeakTopics() {
  const rows = [];
  TEST_UIDS.forEach(uid => {
    TOPICS.forEach((topic, ti) => {
      rows.push({
        user_id:        uid,
        subject:        SUBJECTS[ti % 3],
        topic,
        wrong_count:    ti + 1,
        total_attempts: ti + 3,
        accuracy_pct:   Math.round(((ti + 3 - (ti + 1)) / (ti + 3)) * 100),
        last_seen:      TODAY,
      });
    });
  });
  const { error } = await supabase.rpc('admin_seed_weak_topics', {
    p_caller: getCallerUid(), p_uids: TEST_UIDS, p_rows: rows,
  });
  if (error) throw new Error('user_weak_topics: ' + error.message);
  return `${rows.length} weak topic rows inserted`;
}

async function seedCoaching() {
  const callerUid = getCallerUid();

  // Delete old test centre first
  await supabase.rpc('admin_delete_test_rows', {
    p_caller: callerUid, p_table: 'coaching_centres', p_col: 'name', p_values: [TEST_CENTRE],
  });

  const { data: centre, error: cErr } = await supabase.rpc('admin_upsert_coaching_centre', {
    p_caller: callerUid, p_id: null,
    p_fields: {
      name:          TEST_CENTRE,
      city:          'Mumbai',
      contact_email: 'admin@testacademy.edu',
      contact_phone: '9000000001',
      plan:          'premium',
      max_students:  100,
      status:        'active',
      notes:         'Seeded for testing',
    },
  });
  if (cErr) throw new Error('coaching_centres: ' + cErr.message);

  const students = TEST_UIDS.slice(0, 2).map((uid, i) => ({
    firebase_uid: uid,
    name:         `Test Student ${i + 1}`,
    email:        `test.student${i + 1}@dummy.edu`,
    student_name: `Test Student ${i + 1}`,
    student_email:`test.student${i + 1}@dummy.edu`,
    batch:        'Batch A 2025',
    target_exam:  'NEET',
  }));
  for (const s of students) {
    const { error: sErr } = await supabase.rpc('admin_add_coaching_student', {
      p_caller: callerUid, p_centre_id: centre.id, p_fields: s,
    });
    if (sErr) throw new Error('coaching_students: ' + sErr.message);
  }

  const { error: aErr } = await supabase.rpc('admin_upsert_coaching_assignment', {
    p_caller: callerUid, p_centre_id: centre.id, p_id: null,
    p_fields: {
      title:       'Weekly Biology Test',
      exam_type:   'NEET',
      subject:     'Biology',
      due_date:    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      description: 'Seeded test assignment covering Cell Biology and Genetics',
      questions:   [],
    },
  });
  if (aErr) throw new Error('coaching_assignments: ' + aErr.message);
  return `1 centre, ${students.length} students, 1 assignment created`;
}

async function seedNotifications() {
  const rows = TEST_UIDS.map(uid => ({
    user_id:          uid,
    push_enabled:     false,
    whatsapp_enabled: false,
    daily_reminder:   '19:00:00',
  }));
  const { error } = await supabase.from('notification_prefs').upsert(rows, { onConflict: 'user_id' });
  if (error) throw new Error('notification_prefs: ' + error.message);

  // Fire a local notification if permission granted
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('EaseWithExam — Test Data Seeded', {
      body: `${TEST_UIDS.length} dummy students ready in the dashboard.`,
      icon: '/pwa-192x192.png',
    });
    setTimeout(() => n.close(), 5000);
    return `${rows.length} notification pref rows upserted + local notification sent`;
  }
  return `${rows.length} notification pref rows upserted (push not granted)`;
}

/* ── Remove all dummy data ────────────────────────────────── */

async function removeAllDummyData() {
  const tables = [
    { table: 'question_history',   col: 'user_id' },
    { table: 'user_weak_topics',   col: 'user_id' },
    { table: 'user_gamification',  col: 'user_id' },
    { table: 'daily_usage_quota',  col: 'user_id' },
    { table: 'flashcards',         col: 'firebase_uid' }, // was 'user_id' — not a real column, every cleanup run silently no-op'd on this table
    { table: 'notification_prefs', col: 'user_id' },
    { table: 'users',              col: 'firebase_uid' },
  ];

  const callerUid = getCallerUid();
  const errors = [];
  for (const { table, col } of tables) {
    const { error } = await supabase.rpc('admin_delete_test_rows', {
      p_caller: callerUid, p_table: table, p_col: col, p_values: TEST_UIDS,
    });
    if (error) errors.push(`${table}: ${error.message}`);
  }

  // Remove test coaching centre (cascades to students + assignments)
  const { error: cErr } = await supabase.rpc('admin_delete_test_rows', {
    p_caller: callerUid, p_table: 'coaching_centres', p_col: 'name', p_values: [TEST_CENTRE],
  });
  if (cErr) errors.push(`coaching_centres: ${cErr.message}`);

  if (errors.length) throw new Error(errors.join('\n'));
  return 'All dummy data removed';
}

/* ── Seed sections config ─────────────────────────────────── */

const SECTIONS = [
  { id: 'students',    icon: Users,      label: 'Test Students',      desc: '3 fake student profiles + onboarding',        fn: seedStudents },
  { id: 'gamif',       icon: Brain,      label: 'Gamification',       desc: 'XP, levels, streaks for test students',       fn: seedGameification },
  { id: 'quota',       icon: Database,   label: 'Quota Usage',        desc: "Today's usage rows for test students",        fn: seedQuota },
  { id: 'qhistory',    icon: BookOpen,   label: 'Question History',   desc: 'SRS entries (6 questions × 3 students)',      fn: seedQuestionHistory },
  { id: 'weak',        icon: Brain,      label: 'Weak Topics',        desc: 'Accuracy data across subjects',               fn: seedWeakTopics },
  { id: 'coaching',    icon: Building2,  label: 'Coaching Centre',    desc: '1 centre, 2 enrolled students, 1 assignment', fn: seedCoaching },
  { id: 'notifs',      icon: Bell,       label: 'Notifications',      desc: 'Prefs rows + local push test (if permitted)', fn: seedNotifications },
];

/* ── UI ───────────────────────────────────────────────────── */

function SeedRow({ section, result, onRun }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;
  const st   = result?.status ?? 'idle';

  return (
    <div className="bg-slate-800 rounded-xl border border-white/5 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 rounded-xl bg-slate-700 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{section.label}</p>
          <p className="text-xs text-slate-500 truncate">{section.desc}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {st === 'running' && <Loader2 size={14} className="text-amber-400 animate-spin" />}
          {st === 'pass'    && <CheckCircle2 size={14} className="text-emerald-400" />}
          {st === 'fail'    && <XCircle size={14} className="text-red-400" />}
          <button
            onClick={() => onRun(section)}
            disabled={st === 'running'}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            Seed
          </button>
          {result && (
            <button onClick={() => setOpen(o => !o)} className="text-slate-600 hover:text-slate-400">
              <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>
      <AnimatePresence>
        {open && result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className={`px-4 pb-3 text-xs font-mono ${st === 'pass' ? 'text-emerald-400' : 'text-red-400'}`}>
              {result.message}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminTestData() {
  const [results,  setResults]  = useState({});
  const [seeding,  setSeeding]  = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeMsg, setRemoveMsg] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const runSection = async (section) => {
    setResults(r => ({ ...r, [section.id]: { status: 'running', message: '' } }));
    try {
      const msg = await section.fn();
      setResults(r => ({ ...r, [section.id]: { status: 'pass', message: msg } }));
      logChange(ENTITY.SYSTEM, 'test_data', ACTION.SEED,
        { section: section.id, uids: TEST_UIDS },
        `Test data seeded: ${section.label} — ${msg}`);
    } catch (err) {
      setResults(r => ({ ...r, [section.id]: { status: 'fail', message: err.message } }));
    }
  };

  const seedAll = async () => {
    setSeeding(true);
    for (const s of SECTIONS) await runSection(s);
    setSeeding(false);
  };

  const removeAll = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setRemoving(true);
    setConfirmRemove(false);
    try {
      const msg = await removeAllDummyData();
      logChange(ENTITY.SYSTEM, 'test_data', ACTION.WIPE,
        { uids: TEST_UIDS, tables: ['users','user_gamification','daily_usage_quota','question_history','user_weak_topics','coaching_centres','notification_prefs','flashcards'] },
        'All dummy test data wiped from platform');
      setRemoveMsg('✓ ' + msg);
      setResults({});
    } catch (err) {
      setRemoveMsg('✗ ' + err.message);
    }
    setRemoving(false);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database size={22} className="text-primary-400" /> Test Data Manager
          </h1>
          <p className="text-slate-400 text-sm mt-1">Seed realistic dummy data or wipe it clean</p>
        </div>
        <button
          onClick={seedAll}
          disabled={seeding}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl text-sm disabled:opacity-60 transition-colors"
        >
          {seeding ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />}
          {seeding ? 'Seeding…' : 'Seed All'}
        </button>
      </div>

      {/* Info callout */}
      <div className="bg-slate-800/60 border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-400 space-y-1">
        <p>All test data uses UIDs: <code className="text-primary-300 text-xs">{TEST_UIDS.join(', ')}</code></p>
        <p>Coaching centre name: <code className="text-primary-300 text-xs">{TEST_CENTRE}</code></p>
        <p>The Remove button deletes exactly these rows — no real data is touched.</p>
      </div>

      {/* Seed sections */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Seed Sections</p>
        {SECTIONS.map(s => (
          <SeedRow key={s.id} section={s} result={results[s.id]} onRun={runSection} />
        ))}
      </div>

      {/* Remove dummy data */}
      <div className="border border-red-500/20 rounded-2xl p-5 space-y-3 bg-red-500/5">
        <p className="text-white font-semibold flex items-center gap-2">
          <Trash2 size={16} className="text-red-400" /> Remove All Dummy Data
        </p>
        <p className="text-slate-400 text-sm">
          Deletes all rows inserted by the seeder above across every table. Real student data is unaffected.
        </p>
        {removeMsg && (
          <p className={`text-sm font-mono ${removeMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
            {removeMsg}
          </p>
        )}
        <AnimatePresence>
          {confirmRemove && (
            <motion.p
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              className="text-amber-400 text-sm font-semibold"
            >
              Click again to confirm deletion…
            </motion.p>
          )}
        </AnimatePresence>
        <button
          onClick={removeAll}
          disabled={removing}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60 ${
            confirmRemove
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
          }`}
        >
          {removing
            ? <><Loader2 size={14} className="animate-spin" /> Removing…</>
            : <><Trash2 size={14} /> {confirmRemove ? 'Confirm Remove All' : 'Remove Dummy Data'}</>
          }
        </button>
      </div>
    </div>
  );
}
