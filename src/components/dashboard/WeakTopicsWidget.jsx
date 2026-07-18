import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Target, ChevronRight, TrendingUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getWeakTopics } from '../../lib/errorNotebook';

const SUBJECT_COLORS = {
  Physics:     'bg-blue-500',
  Chemistry:   'bg-emerald-500',
  Biology:     'bg-violet-500',
  Mathematics: 'bg-orange-500',
  General:     'bg-slate-400',
};

function AccuracyBar({ pct }) {
  const color = pct < 40 ? 'bg-red-500' : pct < 60 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex-1">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6 }}
      />
    </div>
  );
}

export default function WeakTopicsWidget() {
  const { currentUser } = useAuth();
  const [topics,  setTopics]  = useState([]);
  const [loading, setLoading] = useState(true);

  const uid = currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    getWeakTopics(uid, 5)
      .then(setTopics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [uid]);

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-slate-100 rounded-full w-28 mb-3" />
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-8 bg-slate-50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-red-500" />
          <h3 className="font-semibold text-slate-900 text-sm">Weak Topics</h3>
        </div>
        <Link to="/notebook?tab=weak" className="text-[10px] text-primary-600 hover:underline flex items-center gap-0.5">
          View all <ChevronRight size={10} />
        </Link>
      </div>

      {topics.length === 0 ? (
        <div className="text-center py-5">
          <TrendingUp size={22} className="text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">No weak topics yet.<br />Complete practice sessions to see your gaps.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {topics.map((t, i) => {
            const dotCol = SUBJECT_COLORS[t.subject] || SUBJECT_COLORS.General;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-3"
              >
                <div className={`h-2 w-2 rounded-full shrink-0 ${dotCol}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{t.topic}</p>
                  <p className="text-[9px] text-slate-400">{t.subject} · {t.total_attempts} attempts</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 w-28">
                  <AccuracyBar pct={t.accuracy_pct} />
                  <span className={`text-[10px] font-bold w-8 text-right ${
                    t.accuracy_pct < 40 ? 'text-red-500' : t.accuracy_pct < 60 ? 'text-amber-500' : 'text-emerald-600'
                  }`}>{t.accuracy_pct}%</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {topics.length > 0 && (
        <Link
          to={`/practice/generate?subject=${topics[0]?.subject}&topic=${topics[0]?.topic}`}
          className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-100 rounded-xl py-2 transition-colors"
        >
          Practice Weakest Topic <ChevronRight size={12} />
        </Link>
      )}
    </div>
  );
}
