import { useEffect, useState } from 'react';
import { ClipboardList, Loader2, BookOpen, Calendar, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useCoaching } from './CoachingPortalGuard';

const TYPE_COLORS = {
  NEET:         'bg-violet-100 text-violet-700',
  JEE:          'bg-blue-100 text-blue-700',
  'MHT-CET':    'bg-emerald-100 text-emerald-700',
};

function DueBadge({ dueDate }) {
  if (!dueDate) return null;
  const due  = new Date(dueDate);
  const now  = new Date();
  const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  if (diff < 0)  return <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle size={9} />Overdue</span>;
  if (diff === 0) return <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><Clock size={9} />Due today</span>;
  if (diff <= 3)  return <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full"><Clock size={9} />Due in {diff}d</span>;
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
      <Calendar size={9} /> {due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
    </span>
  );
}

export default function CoachingAssignmentsPage() {
  const { currentUser }              = useAuth();
  const { record }                   = useCoaching();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [filter, setFilter]           = useState('all'); // all | upcoming | overdue

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_coaching_centre_assignments', {
          p_uid: currentUser.uid,
        });
        if (err) throw err;
        setAssignments(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser]);

  const now = new Date();
  const filtered = assignments.filter((a) => {
    if (filter === 'upcoming') return !a.due_date || new Date(a.due_date) >= now;
    if (filter === 'overdue')  return a.due_date && new Date(a.due_date) < now;
    return true;
  });

  const upcoming = assignments.filter(a => a.due_date && new Date(a.due_date) >= now).length;
  const overdue  = assignments.filter(a => a.due_date && new Date(a.due_date) < now).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <ClipboardList size={20} className="text-primary-600" /> Assignments
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">{record?.centre_name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total',    value: assignments.length, icon: ClipboardList, color: 'text-primary-600 bg-primary-50' },
          { label: 'Upcoming', value: upcoming,           icon: CheckCircle2,  color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Overdue',  value: overdue,            icon: AlertCircle,   color: 'text-red-600 bg-red-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
              <Icon size={16} />
            </div>
            <div>
              <p className="text-xl font-extrabold text-slate-900 leading-tight">{value}</p>
              <p className="text-[10px] text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {[['all', 'All'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={[
              'px-4 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
              filter === val
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <p className="text-sm font-semibold text-red-600">Failed to load assignments</p>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <ClipboardList size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {filter === 'overdue' ? 'No overdue assignments.' : 'No assignments yet. Add them from the Admin portal.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <div key={a.id} className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                  <BookOpen size={16} className="text-violet-600" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="font-semibold text-slate-900 text-sm">{a.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.subject && (
                      <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {a.subject}
                      </span>
                    )}
                    {a.exam_type && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[a.exam_type] || 'bg-slate-100 text-slate-600'}`}>
                        {a.exam_type}
                      </span>
                    )}
                    <DueBadge dueDate={a.due_date} />
                  </div>
                  {a.description && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{a.description}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
