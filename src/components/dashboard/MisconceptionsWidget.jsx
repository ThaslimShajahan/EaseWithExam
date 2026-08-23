import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BrainCircuit, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getUserMisconceptions } from '../../lib/misconceptions';

export default function MisconceptionsWidget() {
  const { currentUser } = useAuth();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  const uid = currentUser?.uid;

  const load = () => {
    if (!uid) return;
    getUserMisconceptions(uid, 5)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Refetch on focus too — this widget's data changes mid-session (a wrong
  // answer in Practice logs a misconception immediately), and a student is
  // likely to tab back to the dashboard right after a practice session.
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [uid]);

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-slate-100 rounded-full w-32 mb-3" />
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-10 bg-slate-50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit size={16} className="text-amber-500" />
          <h3 className="font-semibold text-slate-900 text-sm">Common Mistakes</h3>
        </div>
        <button onClick={load} className="text-slate-300 hover:text-slate-500 transition-colors p-2.5 -m-2.5" aria-label="Refresh">
          <RefreshCw size={12} />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-5">
          <BrainCircuit size={22} className="text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">No repeated mistakes yet.<br />Practice a few chapters to see your patterns.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <motion.div
              key={`${r.subject}-${r.chapter}`}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="p-2.5 rounded-xl border border-amber-100 bg-amber-50/50"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800 truncate">{r.chapter || r.subject}</p>
                <span className="shrink-0 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                  {r.total_count}× repeated
                </span>
              </div>
              {r.top_question_text && (
                <p className="text-[10px] text-slate-500 mt-1 truncate">{r.top_question_text}</p>
              )}
              {r.top_distractor && r.top_correct_answer && (
                <p className="text-[10px] mt-0.5">
                  <span className="text-red-500">You picked: {r.top_distractor}</span>
                  {' · '}
                  <span className="text-emerald-600">Correct: {r.top_correct_answer}</span>
                </p>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
