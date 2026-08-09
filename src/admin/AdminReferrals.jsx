import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Gift, Loader2, Search, RefreshCw, Users, Clock, CheckCircle2, CalendarPlus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

/** Falls back to the uid only when there is genuinely no name or email —
 *  a bare 28-char Firebase uid tells an admin nothing on its own. */
function Person({ name, email, uid }) {
  if (!uid) return <span className="text-slate-600">—</span>;
  return (
    <div className="min-w-0">
      <p className="text-slate-200 truncate">{name || email || uid}</p>
      {(name && email) && <p className="text-slate-500 text-[11px] truncate">{email}</p>}
    </div>
  );
}

export default function AdminReferrals() {
  const callerUid = getCallerUid();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all'); // all | pending | converted

  const load = async () => {
    setLoading(true); setError('');
    const { data, error } = await supabase.rpc('admin_list_referrals', { p_caller: callerUid });
    if (error) { setError(error.message); setLoading(false); return; }
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    // Rows are one per redemption, plus one null-redemption row per code that
    // has never been used — so redemptions must be counted off referred_uid,
    // not off the row count.
    const redemptions = rows.filter(r => r.referred_uid);
    const codes = new Set(rows.map(r => r.referrer_uid));
    return {
      codes:      codes.size,
      pending:    redemptions.filter(r => !r.converted).length,
      converted:  redemptions.filter(r =>  r.converted).length,
      daysGiven:  redemptions.filter(r => r.converted)
                             .reduce((a, r) => a + (r.days_granted ?? 0), 0) * 2, // both sides
    };
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (filter === 'pending'   && (!r.referred_uid ||  r.converted)) return false;
    if (filter === 'converted' && (!r.referred_uid || !r.converted)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.code, r.referrer_name, r.referrer_email, r.referrer_uid,
            r.referred_name, r.referred_email, r.referred_uid]
      .some(v => v?.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Gift size={22} /> Referrals
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Who referred whom, and whether it has converted. Rewards pay out only once the
            referred student subscribes to a paid plan.
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-slate-400">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Codes created',   value: stats.codes,     icon: Users,        color: 'text-slate-300' },
          { label: 'Pending',         value: stats.pending,   icon: Clock,        color: 'text-amber-400' },
          { label: 'Converted',       value: stats.converted, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Premium days given', value: stats.daysGiven, icon: CalendarPlus, color: 'text-primary-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-xs font-medium">{label}</p>
              <Icon size={15} className={color} />
            </div>
            <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, name, email or uid…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
          />
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
          {[['all', 'All'], ['pending', 'Pending'], ['converted', 'Converted']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === id ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-sm text-red-300">{error}</div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 size={20} className="animate-spin text-slate-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {rows.length === 0
              ? 'No referral codes yet — a code is created the first time a student opens their Profile.'
              : 'Nothing matches that filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-slate-400 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Referrer</th>
                  <th className="px-4 py-3 text-left font-semibold">Code</th>
                  <th className="px-4 py-3 text-left font-semibold">Referred</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Redeemed</th>
                  <th className="px-4 py-3 text-left font-semibold">Converted</th>
                  <th className="px-4 py-3 text-right font-semibold">Totals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((r, i) => (
                  <tr key={`${r.referrer_uid}-${r.referred_uid ?? i}`} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 max-w-[200px]">
                      <Person name={r.referrer_name} email={r.referrer_email} uid={r.referrer_uid} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-violet-300">{r.code}</td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <Person name={r.referred_name} email={r.referred_email} uid={r.referred_uid} />
                    </td>
                    <td className="px-4 py-3">
                      {!r.referred_uid ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-700 text-slate-400">
                          Not used yet
                        </span>
                      ) : r.converted ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-900 text-emerald-300">
                          Converted · +{r.days_granted ?? 0}d each
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-900/50 text-amber-400">
                          Awaiting payment
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(r.redeemed_at)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(r.converted_at)}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                      <span className="text-emerald-400 font-semibold">{r.conversions}</span> conv ·{' '}
                      <span className="text-amber-400 font-semibold">{r.pending}</span> pend ·{' '}
                      <span className="text-primary-400 font-semibold">{r.credits_earned}</span>d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
