import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, AlertTriangle, User, GraduationCap,
  BarChart3, Zap, Target,
  Building2, Trophy, Sparkles, Crown, Clock, Pencil,
} from 'lucide-react';
import { supabase, adminGetAllSubscriptions, adminGetQuotaOverride } from '../lib/supabase';
import { pickExpiryInfo } from '../lib/quota';
import { formatCountdown } from '../components/dashboard/ExpiryBadge';
import StudentPicker from '../components/admin/StudentPicker';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const IST_DATE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

async function fetchStudentDetail(uid) {
  const today = IST_DATE();
  const callerUid = getCallerUid();
  const [
    { data: profile },
    { data: quota },
    { data: gamification },
    { data: sessions },
    { data: coachingRow },
    subscriptions,
    override,
  ] = await Promise.all([
    supabase.rpc('admin_get_user', { p_caller: callerUid, p_uid: uid }),
    supabase.from('daily_usage_quota').select('*').eq('user_id', uid).eq('usage_date', today).maybeSingle(),
    supabase.from('user_gamification').select('*').eq('user_id', uid).maybeSingle(),
    supabase.from('test_sessions').select('id, score, total_marks, created_at').eq('firebase_uid', uid).order('created_at', { ascending: false }).limit(10),
    // was .from('coaching_students').eq('student_uid', uid) selecting
    // coaching_centres(centre_name, centre_brand_color) — neither the
    // filter column nor the selected columns exist on the live schema
    // (real columns: firebase_uid, name, brand_color), so this 400'd
    // silently every time and the coaching badge never rendered.
    supabase.rpc('student_get_own_centre', { p_uid: uid }),
    // get_user_subscription is self-scoped (verified_uid() = p_uid), so an
    // admin looking up ANOTHER student cannot call it — admin_list_subscriptions
    // already exists (AdminBilling.jsx) and is filtered to this one uid
    // client-side rather than adding a new per-user RPC for a handful of rows.
    adminGetAllSubscriptions(callerUid).then((rows) => rows.find((s) => s.user_id === uid) ?? null),
    // admin_get_quota_override is SECURITY DEFINER — correctly bypasses
    // quota_overrides_self_read (`user_id = verified_uid()`) for an admin
    // caller, which a direct client select on quota_overrides cannot.
    adminGetQuotaOverride(callerUid, uid),
  ]);

  const coaching = coachingRow?.[0]
    ? { coaching_centres: { centre_name: coachingRow[0].centre_name, centre_brand_color: coachingRow[0].brand_color } }
    : null;

  const hasOverride = !!override?.id;
  const expiry = pickExpiryInfo(hasOverride ? override.expires_at : null, subscriptions);

  return { profile, quota, gamification, sessions: sessions ?? [], coaching, subscription: subscriptions, override: hasOverride ? override : null, expiry };
}

function StatPill({ label, value, color = 'bg-slate-700 text-slate-300' }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${color}`}>
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-xs font-bold ml-auto">{value ?? '—'}</span>
    </div>
  );
}

function ExpiryLine({ expiry }) {
  if (expiry.kind === 'grant') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold bg-emerald-900/40 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-700/30">
        <Sparkles size={9} /> Grant — {formatCountdown(expiry.expiresAt)}
      </span>
    );
  }
  if (expiry.kind === 'subscription') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full border border-amber-700/30">
        <Crown size={9} /> {formatCountdown(expiry.expiresAt)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full border border-white/5">
      <Clock size={9} /> No expiry
    </span>
  );
}

function StudentCard({ detail }) {
  const { profile, quota, gamification, sessions, coaching, subscription, override, expiry } = detail;
  const planName = subscription?.isActive ? subscription.plan : 'Free';

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      {/* Identity */}
      <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-5 flex items-start gap-4">
        {profile?.photo_url ? (
          <img src={profile.photo_url} alt="" className="h-14 w-14 rounded-2xl object-cover shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-2xl bg-primary-700 flex items-center justify-center shrink-0">
            <User size={22} className="text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-lg leading-snug">{profile?.display_name || '—'}</p>
          <p className="text-slate-400 text-sm">{profile?.email || '—'}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {profile?.target_exam && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-primary-900/50 text-primary-400 px-2 py-0.5 rounded-full border border-primary-700/30">
                <Target size={9} /> {profile.target_exam}
              </span>
            )}
            {coaching?.coaching_centres?.centre_name && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-violet-900/40 text-violet-400 px-2 py-0.5 rounded-full border border-violet-700/30">
                <Building2 size={9} /> {coaching.coaching_centres.centre_name}
              </span>
            )}
            <span className="text-[10px] font-bold bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full capitalize">
              {planName.replace('_', ' ')}
            </span>
            <ExpiryLine expiry={expiry} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-600 font-mono">{profile?.firebase_uid?.slice(0, 14)}…</p>
          <p className="text-[10px] text-slate-600 mt-0.5">
            Joined {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
          </p>
        </div>
      </div>

      {/* Stream / subjects — items 3/6 finding: this was invisible here even
          though tonight's scoping makes it the difference between a student
          seeing a picker and seeing the setup prompt on six screens. */}
      <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4 space-y-2">
        <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
          <GraduationCap size={12} className="text-primary-400" /> Stream &amp; Subjects
        </p>
        <div className="text-xs text-slate-400">
          {profile?.syllabus || '—'} {profile?.class_level ? `· Class ${profile.class_level}` : ''}
          {profile?.academic_track?.stream ? ` · ${profile.academic_track.stream}` : ''}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {profile?.subjects?.length
            ? profile.subjects.map((s) => (
                <span key={s} className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-700 text-slate-300">{s}</span>
              ))
            : <span className="text-[10px] text-amber-400">None set — student sees the subject setup prompt</span>}
        </div>
      </div>

      {/* Quota grant — presence + edit link. Editing itself stays in
          AdminStudents.jsx's QuotaGrantEditor (the one write path, avoiding a
          second form for the same action) — this screen is read-only by
          design, as its own header text already said. */}
      <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mb-1">
            <Sparkles size={12} className="text-emerald-400" /> Quota Grant
          </p>
          {override
            ? <p className="text-xs text-slate-400">{formatCountdown(override.expires_at)}{override.reason ? ` — "${override.reason}"` : ''}</p>
            : <p className="text-xs text-slate-500">No active grant.</p>}
        </div>
        <a href="/admin/students" className="flex items-center gap-1 text-[11px] text-primary-400 hover:text-primary-300 shrink-0">
          <Pencil size={11} /> Edit in Students
        </a>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Today's Quota */}
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Zap size={12} className="text-amber-400" /> Today's Quota (IST)
          </p>
          <StatPill label="AI Questions" value={quota?.ai_questions_used ?? 0} color="bg-violet-900/30 text-violet-300" />
          <StatPill label="EWE Messages"  value={quota?.veda_messages_used ?? 0} color="bg-emerald-900/30 text-emerald-300" />
          <StatPill label="Mock Tests" value={quota?.mock_tests_used ?? 0} color="bg-blue-900/30 text-blue-300" />
        </div>

        {/* Gamification */}
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Trophy size={12} className="text-amber-400" /> Gamification
          </p>
          <StatPill label="XP" value={gamification?.xp ?? 0} color="bg-amber-900/30 text-amber-300" />
          <StatPill label="Level" value={gamification?.level ?? 1} color="bg-orange-900/30 text-orange-300" />
          <StatPill label="Streak" value={`${gamification?.streak_days ?? 0}d`} color="bg-rose-900/30 text-rose-300" />
        </div>
      </div>

      {/* Recent test sessions */}
      {sessions.length > 0 && (
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4">
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mb-3">
            <BarChart3 size={12} className="text-primary-400" /> Last {sessions.length} Test Sessions
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-600 uppercase tracking-wider">
                  <th className="text-left pb-2 font-semibold">Date</th>
                  <th className="text-right pb-2 font-semibold">Score</th>
                  <th className="text-right pb-2 font-semibold">Total</th>
                  <th className="text-right pb-2 font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const p = s.total_marks > 0 ? Math.round((s.score / s.total_marks) * 100) : 0;
                  return (
                    <tr key={s.id} className="border-t border-white/5">
                      <td className="py-1.5 text-slate-400">
                        {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-1.5 text-right text-white font-bold">{s.score}</td>
                      <td className="py-1.5 text-right text-slate-500">{s.total_marks}</td>
                      <td className={`py-1.5 text-right font-bold ${p >= 75 ? 'text-emerald-400' : p >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {p}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function AdminStudentLookup() {
  const [selected, setSelected] = useState(null);
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const loadDetail = async (user) => {
    setSelected(user);
    setDetail(null);
    if (!user) return;
    setLoading(true); setError('');
    try {
      const d = await fetchStudentDetail(user.firebase_uid);
      setDetail(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search size={22} className="text-primary-400" /> Student Lookup
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          View any student's profile, plan, quota, subjects, and test history (read-only).
        </p>
      </div>

      {/* StudentPicker already debounces (300ms) against admin_search_users and
          shows live name/email suggestions as you type — the exact-match
          submit-a-query form this replaced required knowing the right spelling
          up front. */}
      <StudentPicker value={selected} onSelect={loadDetail} placeholder="Search by name or email…" />

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-slate-500">
          <Loader2 size={22} className="mx-auto mb-2 animate-spin" />
        </div>
      )}

      <AnimatePresence>
        {detail && !loading && <StudentCard detail={detail} />}
      </AnimatePresence>
    </div>
  );
}
