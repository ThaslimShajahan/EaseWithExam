import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, BookOpen, Trophy, TrendingUp, Search, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useCoaching } from './CoachingPortalGuard';
import { useAuth } from '../context/AuthContext';

function StatCard({ icon, label, value, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet:  'bg-violet-50  text-violet-600',
    amber:   'bg-amber-50   text-amber-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-extrabold text-slate-900 leading-tight">{value ?? '—'}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function StudentRow({ student }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0 text-xs font-bold text-primary-700">
        {(student.display_name || student.student_name || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">
          {student.display_name || student.student_name || 'Unknown'}
        </p>
        <p className="text-[10px] text-slate-400">
          {student.target_exam || student.exam_type || 'N/A'} · {student.class_level || ''}
        </p>
      </div>
      {student.xp !== null && student.xp !== undefined && (
        <div className="text-right shrink-0">
          <p className="text-xs font-bold text-primary-600">{student.xp} XP</p>
          {(student.streak_days ?? 0) > 0 && (
            <p className="text-[10px] text-amber-500">🔥 {student.streak_days}d</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function CoachingDashboard() {
  const { currentUser }     = useAuth();
  const { record }          = useCoaching();
  const [students, setStudents] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_coaching_centre_students', {
          p_uid: currentUser.uid,
        });
        if (err) throw err;
        setStudents(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser]);

  const filtered = students.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.display_name || s.student_name || '').toLowerCase().includes(q) ||
      (s.email || s.student_email || '').toLowerCase().includes(q) ||
      (s.batch || '').toLowerCase().includes(q)
    );
  });

  const avgXp = students.length
    ? Math.round(students.reduce((a, s) => a + (s.xp || 0), 0) / students.length)
    : 0;

  return (
    <div className="space-y-5">
      {/* Welcome */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">
          Welcome, {record?.name?.split(' ')[0] ?? 'Coach'} 👋
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">{record?.centre_name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Users size={18} />}      label="Total Students" value={students.length} color="primary" />
        <StatCard icon={<Trophy size={18} />}      label="Avg XP"         value={avgXp}           color="amber" />
        <StatCard icon={<TrendingUp size={18} />}  label="On Streak"
          value={students.filter(s => (s.streak_days || 0) > 0).length} color="emerald" />
        <StatCard icon={<BookOpen size={18} />}    label="Batches"
          value={new Set(students.map(s => s.batch).filter(Boolean)).size || '—'} color="violet" />
      </div>

      {/* Students list */}
      <div className="bg-white rounded-2xl border border-slate-100">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Users size={15} className="text-primary-600" /> Students
          </h2>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-primary-400 w-40"
            />
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 size={20} className="animate-spin text-primary-500" />
            </div>
          ) : error ? (
            <p className="text-xs text-red-500 text-center py-4">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">
              {search ? 'No students match your search.' : 'No students enrolled yet.'}
            </p>
          ) : (
            <div>
              {filtered.map((s) => (
                <StudentRow key={s.id} student={s} />
              ))}
            </div>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="px-4 pb-3 text-[10px] text-slate-400 text-right">
            {filtered.length} student{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
