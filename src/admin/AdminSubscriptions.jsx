import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CreditCard, Loader2, Search, RefreshCw, TrendingUp, Users, IndianRupee,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PLANS } from '../lib/subscription';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

function planBadge(plan) {
  const colors = {
    free:            'bg-slate-700 text-slate-300',
    premium_monthly: 'bg-primary-900 text-primary-300',
    premium_yearly:  'bg-emerald-900 text-emerald-300',
    neet_complete:   'bg-rose-900 text-rose-300',
  };
  return colors[plan] ?? 'bg-slate-700 text-slate-300';
}

function statusBadge(status) {
  return status === 'active'
    ? 'bg-emerald-900 text-emerald-300'
    : 'bg-red-900/50 text-red-400';
}

export default function AdminSubscriptions() {
  const callerUid = getCallerUid();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [stats,   setStats]   = useState(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_subscriptions', { p_caller: callerUid });
    if (error) { console.error('Subscriptions RPC error:', error); setLoading(false); return; }
    const rows = data ?? [];
    setRows(rows);
    const total   = rows.length;
    const paid    = rows.filter(r => r.plan !== 'free').length;
    const active  = rows.filter(r => r.status === 'active' && r.plan !== 'free').length;
    const revenue = rows.reduce((a, r) => a + (r.amount_paid ?? 0), 0);
    setStats({ total, paid, active, revenue: (revenue / 100).toFixed(0) });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = rows.filter(r =>
    !search ||
    r.user_id?.toLowerCase().includes(search.toLowerCase()) ||
    r.plan?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <CreditCard size={22} /> Subscriptions
          </h1>
          <p className="text-slate-400 text-sm mt-1">All user subscription records</p>
        </div>
        <button onClick={load} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-slate-400">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Users',    value: stats.total,  icon: Users,        color: 'text-slate-300' },
            { label: 'Paid Users',     value: stats.paid,   icon: CreditCard,   color: 'text-primary-400' },
            { label: 'Active Premium', value: stats.active, icon: TrendingUp,   color: 'text-emerald-400' },
            { label: 'Total Revenue',  value: `₹${Number(stats.revenue).toLocaleString('en-IN')}`, icon: IndianRupee, color: 'text-amber-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-slate-800/50 border border-white/5 rounded-2xl p-5">
              <div className={`flex items-center gap-2 mb-1 ${color}`}>
                <Icon size={14} />
                <p className="text-xs text-slate-400">{label}</p>
              </div>
              <p className="text-2xl font-extrabold text-white tabular-nums">{value}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* Search + Table */}
      <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by UID or plan…"
              className="w-full bg-slate-700 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
            />
          </div>
          <p className="text-slate-500 text-xs">{filtered.length} records</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/5 bg-slate-900/30">
              <tr>
                {['User ID', 'Plan', 'Status', 'Starts', 'Expires', 'Paid', 'Payment ID'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-slate-400 font-semibold text-xs whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Loader2 size={20} className="animate-spin text-primary-500 mx-auto" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">
                    {rows.length > 0 ? 'No results match your search.' : 'No subscriptions yet.'}
                  </td>
                </tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-[160px] truncate">{r.user_id}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${planBadge(r.plan)}`}>
                      {PLANS?.[r.plan]?.name ?? r.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadge(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {r.starts_at ? new Date(r.starts_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {r.expires_at
                      ? (() => {
                          const d = new Date(r.expires_at);
                          const past = d < new Date();
                          return <span className={past ? 'text-red-400' : ''}>{d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>;
                        })()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs font-medium">
                    {r.amount_paid ? `₹${(r.amount_paid / 100).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-[120px] truncate">
                    {r.razorpay_payment_id ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
