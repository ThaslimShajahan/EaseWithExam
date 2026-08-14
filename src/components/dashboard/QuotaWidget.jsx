import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Gauge, Zap, MessageSquare, ClipboardList } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { checkQuota } from '../../lib/quota';
import ExpiryBadge from './ExpiryBadge';

const QUOTA_META = [
  { key: 'ai_questions_used',  label: 'AI Questions', icon: Zap,          color: 'bg-violet-500' },
  { key: 'mock_tests_used',    label: 'Mock Tests',   icon: ClipboardList, color: 'bg-blue-500' },
  { key: 'veda_messages_used', label: 'EWE Chat',     icon: MessageSquare, color: 'bg-emerald-500' },
];

export default function QuotaWidget() {
  const { currentUser, isPremium, subscription } = useAuth();
  const [usage,   setUsage]   = useState({});
  const [limits,  setLimits]  = useState({});
  const [loading, setLoading] = useState(true);

  const uid = currentUser?.uid;

  // Runs for EVERY student now, premium included. Premium used to short-circuit
  // straight to a hardcoded "Unlimited AI questions, tests & chat" card — true
  // when premium's quota_config was Infinity, false since it became 200/day
  // (2026-08-14, same night, to match what checkQuota actually enforces). A
  // premium student's own dashboard was contradicting the limit they could
  // actually hit. Real numbers now, for every plan.
  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    Promise.all(QUOTA_META.map(({ key }) => checkQuota(uid, key, isPremium, subscription?.plan)))
      .then((results) => {
        const nextUsage = {}, nextLimits = {};
        QUOTA_META.forEach(({ key }, i) => {
          nextUsage[key]  = results[i].used  ?? 0;
          nextLimits[key] = results[i].unlimited ? Infinity : results[i].limit;
        });
        setUsage(nextUsage);
        setLimits(nextLimits);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [uid, isPremium]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-slate-100 rounded-full w-24 mb-3" />
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-6 bg-slate-50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-slate-600" />
          <h3 className="font-semibold text-slate-900 text-sm">Daily Usage</h3>
        </div>
        {/* Shown for every plan — free, premium, or a temporary grant — not
            only students an admin has specifically touched. */}
        <ExpiryBadge />
      </div>

      {!isPremium && (
        <Link to="/pricing"
          className="inline-block text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full hover:bg-amber-100 transition-colors mb-3">
          Upgrade
        </Link>
      )}

      <div className="space-y-3">
        {QUOTA_META.map(({ key, label, icon: Icon, color }) => {
          const used  = usage[key] || 0;
          const limit = limits[key] ?? 0;
          const pct   = Number.isFinite(limit) && limit > 0 ? Math.min(Math.round((used / limit) * 100), 100) : 0;
          const full  = Number.isFinite(limit) && used >= limit;
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Icon size={11} className={full ? 'text-red-400' : 'text-slate-500'} />
                  <span className="text-xs text-slate-600">{label}</span>
                </div>
                <span className={`text-[10px] font-bold ${full ? 'text-red-500' : 'text-slate-500'}`}>
                  {used}/{Number.isFinite(limit) ? limit : '∞'}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${full ? 'bg-red-400' : color}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mt-3 text-center">Resets at midnight IST · <Link to="/pricing" className="text-primary-500 hover:underline">Remove limits →</Link></p>
    </div>
  );
}
