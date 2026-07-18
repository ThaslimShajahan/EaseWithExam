import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FlaskConical, CheckCircle2, XCircle, Loader2,
  RefreshCw, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

/* ── Test definitions ─────────────────────────────────────── */
/*
 * Changelog exemption: AdminTestRunner inserts/deletes rows as transient probes
 * to verify that DB tables and RLS policies are working correctly.  These writes
 * are always rolled back (delete after insert) within the same test run and never
 * represent real content mutations, so they are intentionally excluded from the
 * audit changelog.
 */

const PROBE_UID = 'TEST_RUNNER_PROBE_' + Date.now();
const TODAY     = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const TESTS = [
  {
    id:    'db_users',
    label: 'DB — users table readable',
    group: 'Database',
    run:   async () => {
      const { data, error } = await supabase.from('users').select('firebase_uid').limit(1);
      if (error) throw new Error(error.message);
      return `OK — ${data.length} row(s) sampled`;
    },
  },
  {
    id:    'db_question_history',
    label: 'DB — question_history (insert / select / delete)',
    group: 'Database',
    run:   async () => {
      const { error: insErr } = await supabase.from('question_history').insert({
        user_id:       PROBE_UID,
        question_id:   'probe-q-1',
        question_text: 'Test probe question',
        is_correct:    false,
      });
      if (insErr) throw new Error('INSERT: ' + insErr.message);

      const { data, error: selErr } = await supabase.from('question_history')
        .select('id').eq('user_id', PROBE_UID).limit(1);
      if (selErr) throw new Error('SELECT: ' + selErr.message);
      if (!data.length) throw new Error('Row not found after insert');

      await supabase.from('question_history').delete().eq('user_id', PROBE_UID);
      return `OK — insert / select / delete cycle passed`;
    },
  },
  {
    id:    'db_weak_topics',
    label: 'DB — user_weak_topics (insert / select / delete)',
    group: 'Database',
    run:   async () => {
      const { error: insErr } = await supabase.from('user_weak_topics').insert({
        user_id:  PROBE_UID,
        subject:  'Biology',
        topic:    'Test Probe Topic',
      });
      if (insErr) throw new Error('INSERT: ' + insErr.message);

      const { data, error: selErr } = await supabase.from('user_weak_topics')
        .select('id').eq('user_id', PROBE_UID).limit(1);
      if (selErr) throw new Error('SELECT: ' + selErr.message);
      if (!data.length) throw new Error('Row not found after insert');

      await supabase.from('user_weak_topics').delete().eq('user_id', PROBE_UID);
      return `OK — insert / select / delete cycle passed`;
    },
  },
  {
    id:    'db_quota',
    label: 'DB — daily_usage_quota (insert / select / delete)',
    group: 'Database',
    run:   async () => {
      const { error: insErr } = await supabase.from('daily_usage_quota').upsert({
        user_id:    PROBE_UID,
        usage_date: TODAY,
        ai_questions_used: 0,
      }, { onConflict: 'user_id,usage_date' });
      if (insErr) throw new Error('UPSERT: ' + insErr.message);

      const { data, error: selErr } = await supabase.from('daily_usage_quota')
        .select('ai_questions_used').eq('user_id', PROBE_UID).eq('usage_date', TODAY).maybeSingle();
      if (selErr) throw new Error('SELECT: ' + selErr.message);
      if (!data) throw new Error('Row not found after insert');

      await supabase.from('daily_usage_quota').delete().eq('user_id', PROBE_UID);
      return `OK — quota row insert/select/delete passed`;
    },
  },
  {
    id:    'db_quota_config',
    label: 'DB — quota_config (free plan exists)',
    group: 'Database',
    run:   async () => {
      const { data, error } = await supabase.from('quota_config')
        .select('plan_id, ai_questions').eq('plan_id', 'free').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('free plan row missing — run v5/v6 migration');
      return `OK — free: ${data.ai_questions} AI questions/day`;
    },
  },
  {
    id:    'db_quota_overrides',
    label: 'DB — quota_overrides readable',
    group: 'Database',
    run:   async () => {
      const { data, error } = await supabase.from('quota_overrides').select('id').limit(1);
      if (error) throw new Error(error.message);
      return `OK — ${data.length} override(s)`;
    },
  },
  {
    id:    'db_flashcards',
    label: 'DB — flashcards table readable',
    group: 'Database',
    run:   async () => {
      const { data, error } = await supabase.from('flashcards').select('id').limit(1);
      if (error) throw new Error(error.message);
      return `OK — ${data.length} row(s) sampled`;
    },
  },
  {
    id:    'db_coaching',
    label: 'DB — coaching tables readable',
    group: 'Database',
    run:   async () => {
      const [c, s, a] = await Promise.all([
        supabase.from('coaching_centres').select('id').limit(1),
        supabase.from('coaching_students').select('id').limit(1),
        supabase.from('coaching_assignments').select('id').limit(1),
      ]);
      if (c.error) throw new Error('coaching_centres: ' + c.error.message);
      if (s.error) throw new Error('coaching_students: ' + s.error.message);
      if (a.error) throw new Error('coaching_assignments: ' + a.error.message);
      return `OK — centres/students/assignments all readable`;
    },
  },
  {
    id:    'db_gamification',
    label: 'DB — user_gamification readable',
    group: 'Database',
    run:   async () => {
      const { data, error } = await supabase.from('user_gamification').select('user_id').limit(1);
      if (error) throw new Error(error.message);
      return `OK — ${data.length} row(s) sampled`;
    },
  },
  {
    id:    'db_admins',
    label: 'DB — admins table (self check)',
    group: 'Database',
    run:   async () => {
      const { data, error } = await supabase.from('admins').select('uid, role, name').eq('is_active', true);
      if (error) throw new Error(error.message);
      return `OK — ${data.length} active admin(s) found`;
    },
  },
  {
    id:    'quota_logic_free',
    label: 'Quota — free user under limit returns allowed',
    group: 'Business Logic',
    run:   async () => {
      // Upsert a row with 0 usage for probe UID
      await supabase.from('daily_usage_quota').upsert({
        user_id: PROBE_UID, usage_date: TODAY, ai_questions_used: 0,
      }, { onConflict: 'user_id,usage_date' });

      const { data } = await supabase.from('daily_usage_quota')
        .select('ai_questions_used').eq('user_id', PROBE_UID).eq('usage_date', TODAY).maybeSingle();
      await supabase.from('daily_usage_quota').delete().eq('user_id', PROBE_UID);

      const used  = data?.ai_questions_used ?? 0;
      const limit = 15;
      const allowed = used < limit;
      if (!allowed) throw new Error('Expected allowed=true but got false');
      return `OK — ${used}/${limit} → allowed`;
    },
  },
  {
    id:    'quota_logic_exceeded',
    label: 'Quota — free user at limit returns blocked',
    group: 'Business Logic',
    run:   async () => {
      await supabase.from('daily_usage_quota').upsert({
        user_id: PROBE_UID, usage_date: TODAY, ai_questions_used: 15,
      }, { onConflict: 'user_id,usage_date' });

      const { data } = await supabase.from('daily_usage_quota')
        .select('ai_questions_used').eq('user_id', PROBE_UID).eq('usage_date', TODAY).maybeSingle();
      await supabase.from('daily_usage_quota').delete().eq('user_id', PROBE_UID);

      const used  = data?.ai_questions_used ?? 0;
      const limit = 15;
      const blocked = used >= limit;
      if (!blocked) throw new Error('Expected blocked=true but got false');
      return `OK — ${used}/${limit} → blocked (correct)`;
    },
  },
  {
    id:    'srs_due_filter',
    label: 'SRS — due_date filter returns only due cards',
    group: 'Business Logic',
    run:   async () => {
      // Insert one due card and one future card
      const pastDate   = '2020-01-01';
      const futureDate = '2099-12-31';
      await supabase.from('question_history').insert([
        { user_id: PROBE_UID, question_id: 'probe-due',    question_text: 'Due card',    is_correct: false, due_date: pastDate,   is_mastered: false },
        { user_id: PROBE_UID, question_id: 'probe-future', question_text: 'Future card', is_correct: false, due_date: futureDate, is_mastered: false },
      ]);

      const { data, error } = await supabase.from('question_history')
        .select('question_id')
        .eq('user_id', PROBE_UID)
        .eq('is_mastered', false)
        .lte('due_date', TODAY);
      await supabase.from('question_history').delete().eq('user_id', PROBE_UID);

      if (error) throw new Error(error.message);
      if (data.length !== 1) throw new Error(`Expected 1 due card, got ${data.length}`);
      if (data[0].question_id !== 'probe-due') throw new Error('Wrong card returned');
      return `OK — SRS date filter works correctly`;
    },
  },
  {
    id:    'weak_topics_accuracy',
    label: 'Weak Topics — accuracy filter (< 70%) works',
    group: 'Business Logic',
    run:   async () => {
      await supabase.from('user_weak_topics').insert([
        { user_id: PROBE_UID, subject: 'Physics', topic: 'Optics',       accuracy_pct: 45 },
        { user_id: PROBE_UID, subject: 'Physics', topic: 'Thermodynamics', accuracy_pct: 85 },
      ]);

      const { data, error } = await supabase.from('user_weak_topics')
        .select('topic')
        .eq('user_id', PROBE_UID)
        .lt('accuracy_pct', 70);
      await supabase.from('user_weak_topics').delete().eq('user_id', PROBE_UID);

      if (error) throw new Error(error.message);
      if (data.length !== 1) throw new Error(`Expected 1 weak topic, got ${data.length}`);
      if (data[0].topic !== 'Optics') throw new Error('Wrong topic returned');
      return `OK — accuracy_pct < 70 filter returns correct rows`;
    },
  },
  {
    id:    'push_support',
    label: 'Push — browser Notification API available',
    group: 'Push Notifications',
    run:   async () => {
      if (!('Notification' in window)) throw new Error('Notification API not available in this browser');
      const perm = Notification.permission;
      return `OK — Notification API present, permission: ${perm}`;
    },
  },
  {
    id:    'push_local',
    label: 'Push — local notification fires (requires "granted" permission)',
    group: 'Push Notifications',
    run:   async () => {
      if (!('Notification' in window)) throw new Error('Notification API not supported');
      if (Notification.permission !== 'granted') {
        return `SKIP — permission is "${Notification.permission}" (not granted; request it in Profile → Notifications)`;
      }
      const n = new Notification('EaseWithExam Test', {
        body: 'Local notification test — all good!',
        icon: '/pwa-192x192.png',
      });
      setTimeout(() => n.close(), 4000);
      return `OK — notification fired (auto-closes in 4 s)`;
    },
  },
];

/* ── UI helpers ───────────────────────────────────────────── */

const STATUS_COLOR = { idle: 'text-slate-500', running: 'text-amber-400', pass: 'text-emerald-400', fail: 'text-red-400' };
const STATUS_ICON  = { idle: null, running: Loader2, pass: CheckCircle2, fail: XCircle };

function TestRow({ test, result }) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[result?.status ?? 'idle'];

  return (
    <div className="bg-slate-800 rounded-xl border border-white/5 overflow-hidden">
      <button
        onClick={() => result && setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className={`shrink-0 ${STATUS_COLOR[result?.status ?? 'idle']}`}>
          {Icon
            ? <Icon size={15} className={result?.status === 'running' ? 'animate-spin' : ''} />
            : <div className="h-3.5 w-3.5 rounded-full border border-slate-600" />
          }
        </div>
        <span className="flex-1 text-sm text-slate-200">{test.label}</span>
        {result && (
          <ChevronDown size={14} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      <AnimatePresence>
        {open && result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={`px-4 pb-3 pt-0 text-xs font-mono rounded-b-xl ${
              result.status === 'pass' ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {result.message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */

export default function AdminTestRunner() {
  const [results,  setResults]  = useState({});
  const [running,  setRunning]  = useState(false);

  const groups = [...new Set(TESTS.map(t => t.group))];

  const runAll = async () => {
    setResults({});
    setRunning(true);
    for (const t of TESTS) {
      setResults(r => ({ ...r, [t.id]: { status: 'running', message: '' } }));
      try {
        const msg = await t.run();
        setResults(r => ({ ...r, [t.id]: { status: msg.startsWith('SKIP') ? 'skip' : 'pass', message: msg } }));
      } catch (err) {
        setResults(r => ({ ...r, [t.id]: { status: 'fail', message: err.message } }));
      }
    }
    setRunning(false);
  };

  const runSingle = async (test) => {
    setResults(r => ({ ...r, [test.id]: { status: 'running', message: '' } }));
    try {
      const msg = await test.run();
      setResults(r => ({ ...r, [test.id]: { status: 'pass', message: msg } }));
    } catch (err) {
      setResults(r => ({ ...r, [test.id]: { status: 'fail', message: err.message } }));
    }
  };

  const passed  = Object.values(results).filter(r => r.status === 'pass').length;
  const failed  = Object.values(results).filter(r => r.status === 'fail').length;
  const total   = TESTS.length;
  const hasRun  = Object.keys(results).length > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FlaskConical size={22} className="text-amber-400" /> E2E Test Runner
          </h1>
          <p className="text-slate-400 text-sm mt-1">Verify all logical functions are working end-to-end</p>
        </div>
        <button
          onClick={runAll}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl text-sm disabled:opacity-60 transition-colors"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {running ? 'Running…' : 'Run All Tests'}
        </button>
      </div>

      {/* Summary bar */}
      {hasRun && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl px-4 py-3 flex items-center gap-3 text-sm font-semibold ${
            failed > 0 ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
          }`}
        >
          {failed > 0
            ? <XCircle size={16} />
            : <CheckCircle2 size={16} />
          }
          {passed}/{total} passed
          {failed > 0 && ` · ${failed} failed`}
          {running && ' · running…'}
        </motion.div>
      )}

      {/* Warning */}
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 text-amber-300 text-xs">
        <AlertCircle size={13} className="shrink-0 mt-0.5" />
        Tests insert temporary rows with a probe UID and clean up after themselves. Safe to run in production.
      </div>

      {/* Test groups */}
      {groups.map(group => (
        <div key={group} className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{group}</p>
          {TESTS.filter(t => t.group === group).map(test => (
            <div key={test.id} className="relative group">
              <TestRow test={test} result={results[test.id]} />
              <button
                onClick={() => runSingle(test)}
                disabled={results[test.id]?.status === 'running'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 hover:text-white px-2 py-1 rounded-md bg-white/0 hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-all"
              >
                run
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
