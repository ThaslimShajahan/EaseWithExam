import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  CalendarCheck, CheckCircle2, Circle, BookOpen, Zap,
  ChevronRight, Timer, Plus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getTodayTasks, markTaskDone } from '../../lib/dailyTasks';

const TYPE_META = {
  study:     { color: 'text-blue-600',    bg: 'bg-blue-50',     label: 'Study' },
  practice:  { color: 'text-violet-600',  bg: 'bg-violet-50',   label: 'Practice' },
  revision:  { color: 'text-amber-600',   bg: 'bg-amber-50',    label: 'Revise' },
  mock_test: { color: 'text-red-600',     bg: 'bg-red-50',      label: 'Mock Test' },
};

export default function TodayFocus() {
  const { currentUser } = useAuth();
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);

  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    getTodayTasks(uid)
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [uid]);

  const toggle = async (task) => {
    const next = !task.is_done;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_done: next } : t));
    await markTaskDone(task.id, next).catch(() => {});
  };

  const done  = tasks.filter(t => t.is_done).length;
  const total = tasks.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-slate-100 rounded-full w-32 mb-3" />
        <div className="space-y-2">
          {[1,2].map(i => <div key={i} className="h-10 bg-slate-50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <CalendarCheck size={16} className="text-primary-500" />
          <h3 className="font-semibold text-slate-900 text-sm">Today's Plan</h3>
        </div>
        <div className="text-center py-6">
          <div className="h-12 w-12 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-3">
            <BookOpen size={20} className="text-primary-400" />
          </div>
          <p className="text-sm text-slate-500 mb-3">No tasks scheduled yet.<br />Generate a study plan to get started.</p>
          <Link to="/goals"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 bg-primary-50 px-3 py-2 rounded-xl hover:bg-primary-100 transition-colors border border-primary-100">
            <Plus size={12} /> Create Study Plan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarCheck size={16} className="text-primary-500" />
          <h3 className="font-semibold text-slate-900 text-sm">Today's Focus</h3>
        </div>
        <span className="text-xs text-slate-500">{done}/{total} done</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
        <motion.div
          className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Tasks */}
      <div className="space-y-1.5">
        {tasks.slice(0, 5).map((task, i) => {
          const meta = TYPE_META[task.task_type] || TYPE_META.study;
          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                task.is_done ? 'bg-slate-50 opacity-60' : 'hover:bg-slate-50'
              }`}
            >
              <button onClick={() => toggle(task)} className="shrink-0">
                {task.is_done
                  ? <CheckCircle2 size={18} className="text-emerald-500" />
                  : <Circle size={18} className="text-slate-300 hover:text-primary-400 transition-colors" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${task.is_done ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                  {task.topic}
                </p>
                <p className="text-[10px] text-slate-400">{task.subject}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {task.duration_min && (
                  <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                    <Timer size={9} />{task.duration_min}m
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                  {meta.label}
                </span>
              </div>
            </motion.div>
          );
        })}

        {tasks.length > 5 && (
          <Link to="/goals"
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 px-2 py-1">
            +{tasks.length - 5} more tasks <ChevronRight size={11} />
          </Link>
        )}
      </div>

      {pct === 100 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2 border border-emerald-100"
        >
          <Zap size={13} className="text-emerald-500" />
          All done for today! Great work!
        </motion.div>
      )}
    </div>
  );
}
