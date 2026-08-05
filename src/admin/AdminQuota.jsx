import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gauge, Zap, MessageSquare, ClipboardList, FileCheck, Headphones,
  Edit3, Save, X, Trash2, RotateCcw, Search, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { IST_WEEK_START } from '../lib/quota';
import StudentPicker from '../components/admin/StudentPicker';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const IST_DATE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const FIELDS = [
  { key: 'ai_questions',      label: 'AI Questions',      icon: Zap,           color: 'text-violet-400' },
  { key: 'veda_messages',     label: 'EWE Messages',      icon: MessageSquare, color: 'text-emerald-400' },
  { key: 'mock_tests',        label: 'Mock Tests / wk',   icon: ClipboardList, color: 'text-blue-400'   },
  { key: 'paper_evaluations', label: 'Paper Evaluations', icon: FileCheck,     color: 'text-amber-400'  },
  { key: 'podcasts',          label: 'Podcasts',          icon: Headphones,   color: 'text-pink-400'   },
];

// Map quota_config key → daily_usage_quota column
const USAGE_KEY = {
  ai_questions:      'ai_questions_used',
  veda_messages:     'veda_messages_used',
  mock_tests:        'mock_tests_used',
  paper_evaluations: 'paper_evaluations_used',
  podcasts:          'podcasts_used',
};

function pctColor(pct) {
  if (pct >= 100) return 'bg-red-500';
  if (pct >= 75)  return 'bg-amber-500';
  return 'bg-emerald-500';
}

/* ── Plan limits editor ────────────────────────────────────── */
function PlanLimitsSection() {
  const callerUid  = getCallerUid();
  const [config,   setConfig]   = useState([]);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  useEffect(() => {
    supabase.from('quota_config').select('*').order('plan_id')
      .then(({ data }) => setConfig(data ?? []));
  }, []);

  function startEdit(row) {
    setEditing(row.plan_id);
    // Was hardcoded to only 3 of the 4 fields actually rendered in the edit
    // form below (paper_evaluations was displayed as an editable input that
    // silently did nothing — its value was never captured here or sent to
    // the RPC). Now driven off the same FIELDS list the inputs render from,
    // so a field can't be added to one without the other again.
    setForm(Object.fromEntries(FIELDS.map(f => [f.key, row[f.key]])));
    setErr('');
  }

  async function save(planId) {
    setSaving(true); setErr('');
    const values = Object.fromEntries(FIELDS.map(f => [f.key, Number(form[f.key])]));
    const { error } = await supabase.rpc('admin_set_quota_config', {
      p_caller:            callerUid,
      p_plan_id:           planId,
      p_ai:                values.ai_questions,
      p_veda:              values.veda_messages,
      p_mock:              values.mock_tests,
      p_paper_evaluations: values.paper_evaluations,
      p_podcasts:          values.podcasts,
    });
    if (error) { setErr(error.message); setSaving(false); return; }
    setConfig(c => c.map(r => r.plan_id === planId ? { ...r, ...values } : r));
    setEditing(null);
    setSaving(false);
  }

  return (
    <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5">
        <h2 className="font-bold text-white text-sm">Per-Plan Daily Limits</h2>
        <p className="text-slate-400 text-xs mt-0.5">-1 = unlimited. Changes take effect on the next request.</p>
      </div>
      <div className="divide-y divide-white/5">
        {config.map(row => (
          <div key={row.plan_id} className="px-5 py-4 flex items-center gap-4">
            <div className="w-32 shrink-0">
              <p className="text-white font-semibold text-sm capitalize">{row.plan_id.replace('_', ' ')}</p>
            </div>
            {editing === row.plan_id ? (
              <div className="flex items-center gap-2 flex-1">
                {FIELDS.map(f => (
                  <div key={f.key} className="flex-1">
                    <label className="block text-[10px] text-slate-400 mb-1">{f.label}</label>
                    <input
                      type="number"
                      value={form[f.key]}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:outline-none focus:border-primary-500"
                    />
                  </div>
                ))}
                <div className="flex items-end gap-1 pb-0.5">
                  <button onClick={() => save(row.plan_id)} disabled={saving}
                    className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center hover:bg-emerald-700 transition-colors">
                    <Save size={13} className="text-white" />
                  </button>
                  <button onClick={() => setEditing(null)}
                    className="h-8 w-8 rounded-lg bg-slate-700 flex items-center justify-center hover:bg-slate-600 transition-colors">
                    <X size={13} className="text-slate-400" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4 flex-1">
                {FIELDS.map(f => {
                  const v = row[f.key];
                  return (
                    <div key={f.key} className="flex-1 text-center">
                      <p className={`font-bold text-lg ${v === -1 ? 'text-violet-400' : 'text-white'}`}>
                        {v === -1 ? '∞' : v}
                      </p>
                      <p className="text-slate-500 text-[10px]">{f.label}</p>
                    </div>
                  );
                })}
                <button onClick={() => startEdit(row)}
                  className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                  <Edit3 size={13} className="text-slate-400" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {err && <p className="px-5 py-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

/* ── Today's usage table ────────────────────────────────────── */
function TodayUsageSection({ planLimits }) {
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [sortField,  setSortField]  = useState('ai_questions_used');
  const [sortAsc,    setSortAsc]    = useState(false);
  const [resetting,  setResetting]  = useState(null);

  const today     = IST_DATE();
  const weekStart = IST_WEEK_START();

  useEffect(() => {
    setLoading(true);
    // mock_tests is a weekly cap (see WEEKLY_FIELDS in lib/quota.js) — a single
    // day's row would show e.g. "0/1" for a student who already used their
    // week's test on an earlier day, which looks like they have allowance left
    // when they don't. Fetch the whole week and sum mock_tests_used per user;
    // every other field still reflects just today, same as before.
    Promise.all([
      supabase.from('daily_usage_quota').select('*').eq('usage_date', today),
      supabase.from('daily_usage_quota').select('user_id, mock_tests_used').gte('usage_date', weekStart).lte('usage_date', today),
    ]).then(([todayRes, weekRes]) => {
      const weekTotals = {};
      for (const r of (weekRes.data ?? [])) {
        weekTotals[r.user_id] = (weekTotals[r.user_id] ?? 0) + (r.mock_tests_used ?? 0);
      }
      const merged = (todayRes.data ?? []).map((r) => ({ ...r, mock_tests_used: weekTotals[r.user_id] ?? 0 }));
      setRows(merged);
      setLoading(false);
    });
  }, [today, weekStart]);

  function toggleSort(field) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  async function resetUser(userId) {
    setResetting(userId);
    const callerUid = getCallerUid();
    await Promise.all([
      supabase.rpc('admin_reset_user_quota', { p_caller: callerUid, p_user_id: userId, p_date: today }),
      // admin_reset_user_quota only deletes TODAY's row — for the weekly
      // mock_tests cap that's not enough if the student's usage was from an
      // earlier day this week (their slot would stay "used" despite the
      // reset). This zeroes just that field across the whole week without
      // touching other days' ai_questions/veda_messages/etc.
      supabase.rpc('admin_reset_weekly_field', {
        p_caller: callerUid, p_user_id: userId, p_field: 'mock_tests_used',
        p_week_start: weekStart, p_week_end: today,
      }),
    ]);
    setRows(r => r.filter(x => x.user_id !== userId));
    setResetting(null);
  }

  const freeLimit = planLimits?.free ?? { ai_questions: 15, veda_messages: 20, mock_tests: 3 };

  const filtered = rows
    .filter(r => !search || r.user_id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortField] ?? 0, bv = b[sortField] ?? 0;
      return sortAsc ? av - bv : bv - av;
    });

  const SortBtn = ({ field, label }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-xs font-semibold">
      {label}
      {sortField === field ? (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
    </button>
  );

  return (
    <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-white text-sm">Today's Usage <span className="text-slate-500 font-normal">({today})</span></h2>
          <p className="text-slate-400 text-xs mt-0.5">{rows.length} active users today · Mock Tests is this week's total, everything else is today only</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search UID…"
            className="bg-slate-700 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 w-44"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/5">
            <tr>
              <th className="text-left px-5 py-3 text-slate-400 font-semibold text-xs">User ID</th>
              {FIELDS.map(f => (
                <th key={f.key} className="text-center px-4 py-3">
                  <SortBtn field={USAGE_KEY[f.key]} label={f.label} />
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={FIELDS.length + 2} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={FIELDS.length + 2} className="px-5 py-8 text-center text-slate-500">No usage today yet.</td></tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="px-5 py-3 font-mono text-xs text-slate-300 max-w-[180px] truncate">{row.user_id}</td>
                {FIELDS.map(f => {
                  const used  = row[USAGE_KEY[f.key]] ?? 0;
                  const limit = freeLimit[f.key] ?? 15;
                  const pct   = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
                  const full  = used >= limit && limit > 0;
                  return (
                    <td key={f.key} className="px-4 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-xs font-bold ${full ? 'text-red-400' : 'text-white'}`}>
                          {used}<span className="text-slate-500 font-normal">/{limit < 0 ? '∞' : limit}</span>
                        </span>
                        <div className="h-1 w-16 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pctColor(pct)}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => resetUser(row.user_id)}
                    disabled={resetting === row.user_id}
                    title="Reset today's quota (and this week's mock tests)"
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors ml-auto"
                  >
                    <RotateCcw size={12} className={resetting === row.user_id ? 'animate-spin' : ''} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Per-student override section ───────────────────────────── */
function OverridesSection() {
  const callerUid   = getCallerUid();
  const [overrides, setOverrides] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState({
    user_id: '', reason: '', expires_at: '',
    ...Object.fromEntries(FIELDS.map(f => [f.key, ''])),
  });
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  useEffect(() => {
    supabase.rpc('admin_list_quota_overrides', { p_caller: callerUid })
      .then(({ data }) => { setOverrides(data ?? []); setLoading(false); });
  }, []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleAdd() {
    if (!form.user_id.trim()) { setErr('User ID is required'); return; }
    setSaving(true); setErr('');
    // Was hardcoded to only 3 of the 4 fields the form actually rendered
    // inputs for (paper_evaluations was editable but silently discarded) —
    // now driven off FIELDS so every field the form shows actually saves.
    const values = Object.fromEntries(FIELDS.map(f => [f.key, form[f.key] !== '' ? Number(form[f.key]) : null]));
    const { error } = await supabase.rpc('admin_set_quota_override', {
      p_caller:            callerUid,
      p_user_id:           form.user_id.trim(),
      p_ai:                values.ai_questions,
      p_veda:              values.veda_messages,
      p_mock:              values.mock_tests,
      p_reason:            form.reason || null,
      p_expires_at:        form.expires_at || null,
      p_paper_evaluations: values.paper_evaluations,
      p_podcasts:          values.podcasts,
    });
    if (error) { setErr(error.message); setSaving(false); return; }
    const newRow = {
      id:         crypto.randomUUID(),
      user_id:    form.user_id.trim(),
      ...values,
      reason:     form.reason || null,
      expires_at: form.expires_at || null,
      created_at: new Date().toISOString(),
    };
    setOverrides(o => [newRow, ...o.filter(x => x.user_id !== newRow.user_id)]);
    setForm({ user_id: '', reason: '', expires_at: '', ...Object.fromEntries(FIELDS.map(f => [f.key, ''])) });
    setSelectedStudent(null);
    setShowForm(false);
    setSaving(false);
  }

  async function handleDelete(userId) {
    await supabase.rpc('admin_delete_quota_override', { p_caller: callerUid, p_user_id: userId });
    setOverrides(o => o.filter(x => x.user_id !== userId));
  }

  return (
    <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-white text-sm">Student Quota Overrides</h2>
          <p className="text-slate-400 text-xs mt-0.5">Override per-plan defaults for a specific student. NULL = use plan default.</p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-colors">
          <Edit3 size={12} /> Add Override
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-b border-white/5 overflow-hidden"
          >
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Student *</label>
                  <StudentPicker
                    value={selectedStudent}
                    onSelect={(u) => { setSelectedStudent(u); setForm(f => ({ ...f, user_id: u?.firebase_uid ?? '' })); }}
                  />
                </div>
                {FIELDS.map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-slate-400 mb-1">{f.label} limit <span className="text-slate-600">(blank = default)</span></label>
                    <input type="number" value={form[f.key]} onChange={set(f.key)} placeholder="e.g. 50 or -1 for ∞"
                      className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Expires</label>
                  <input type="date" value={form.expires_at} onChange={set('expires_at')}
                    className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Reason</label>
                  <input value={form.reason} onChange={set('reason')} placeholder="e.g. Trial extension for coaching centre batch"
                    className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
                </div>
              </div>
              {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={11} /> {err}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-xl border border-white/10 text-slate-300 text-xs hover:bg-white/5 transition-colors">Cancel</button>
                <button onClick={handleAdd} disabled={saving} className="px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Saving…' : 'Save Override'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="divide-y divide-white/5">
        {loading ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">Loading…</div>
        ) : overrides.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No overrides set.</div>
        ) : overrides.map(o => (
          <div key={o.id} className="px-5 py-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-slate-300 truncate">{o.user_id}</p>
              {o.reason && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{o.reason}</p>}
            </div>
            <div className="flex items-center gap-4 shrink-0">
              {FIELDS.map(f => (
                <div key={f.key} className="text-center">
                  <p className={`text-xs font-bold ${o[f.key] === null ? 'text-slate-600' : o[f.key] === -1 ? 'text-violet-400' : 'text-white'}`}>
                    {o[f.key] === null ? '—' : o[f.key] === -1 ? '∞' : o[f.key]}
                  </p>
                  <p className="text-[9px] text-slate-600">{f.label}</p>
                </div>
              ))}
              {o.expires_at && (
                <p className="text-[10px] text-slate-500">until {new Date(o.expires_at).toLocaleDateString('en-IN')}</p>
              )}
              <button onClick={() => handleDelete(o.user_id)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function AdminQuota() {
  const [planLimits, setPlanLimits] = useState(null);

  useEffect(() => {
    // quota_config has a read-only SELECT policy for authenticated users
    supabase.from('quota_config').select('*').then(({ data }) => {
      if (!data) return;
      const map = {};
      data.forEach(r => { map[r.plan_id] = r; });
      setPlanLimits(map);
    });
  }, []);

  const today = IST_DATE();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Quota Management</h1>
          <p className="text-slate-400 text-sm mt-1">Configure daily AI limits per plan and override for individual students</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
          <Gauge size={14} className="text-primary-400" />
          <span className="text-slate-300 text-xs font-medium">{today} IST</span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {FIELDS.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="bg-slate-800/50 border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-1">
              <Icon size={16} className={color} />
              <p className="text-slate-300 text-sm">{label}</p>
            </div>
            <p className="text-3xl font-extrabold text-white">
              {planLimits?.free?.[key] === -1 ? '∞' : (planLimits?.free?.[key] ?? '—')}
            </p>
            <p className="text-slate-500 text-xs mt-1">free plan daily limit</p>
          </div>
        ))}
      </div>

      <PlanLimitsSection />
      <TodayUsageSection planLimits={planLimits?.free} />
      <OverridesSection />
    </div>
  );
}
