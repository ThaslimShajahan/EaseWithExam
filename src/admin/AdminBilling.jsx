/**
 * Billing history — every payment attempt, newest first.
 *
 * Reads `payment_orders` via admin_list_payments, NOT `subscriptions`.
 * `subscriptions` upserts on (user_id), so it holds one row per student and
 * loses the previous payment on every renewal. `payment_orders` keeps one row
 * per order permanently, which makes it the only honest source for a history.
 *
 * THIS IS A PAYMENT LOG, NOT A TAX INVOICE. No invoice number, no GSTIN, no tax
 * breakup, no place of supply. Invoicing is pieces 2-5 of the plan in
 * docs/ACTION_ITEMS_FOR_YOU.md and is deliberately not started — whether a GST
 * tax invoice is even the right artefact depends on registration status and the
 * education-exemption question, both of which need a CA's answer first. The
 * banner below says so on screen so nobody mistakes this for one.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Receipt, Loader2, Search, RefreshCw, IndianRupee, CircleAlert, CircleCheck, CircleDashed,
} from 'lucide-react';
import { supabase, adminGetAllUsers } from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const rupees = (paise) => `₹${((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;

const fmt = (ts) => (ts
  ? new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  : '—');

/* A `created` row is an ABANDONED CHECKOUT, not a failure and not a payment.
 * Surfaced rather than filtered: a history showing only redeemed rows would hide
 * every abandoned attempt, which is precisely what you need when a student says
 * they were charged and cannot see their plan. */
function statusChip(status) {
  if (status === 'redeemed') {
    return { cls: 'bg-emerald-900/60 text-emerald-300', Icon: CircleCheck, label: 'Paid' };
  }
  return { cls: 'bg-amber-900/40 text-amber-400', Icon: CircleDashed, label: 'Started' };
}

export default function AdminBilling() {
  const callerUid = getCallerUid();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [search,  setSearch]  = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc('admin_list_payments', { p_caller: callerUid });
    if (rpcErr) {
      setError(rpcErr.message ?? 'Could not load payments.');
      setRows([]);
      setLoading(false);
      return;
    }

    // payment_orders stores only a Firebase UID. Showing a bare 28-char UID as
    // the sole identifier makes the screen unusable for answering "did THIS
    // student pay?", so names and emails are joined on — best-effort, because a
    // failed user lookup should degrade to UIDs rather than blank the page.
    let byUid = {};
    try {
      const users = await adminGetAllUsers(callerUid);
      byUid = Object.fromEntries((users ?? []).map((u) => [u.firebase_uid, u]));
    } catch { /* fall back to bare UIDs */ }

    setRows((data ?? []).map((r) => ({
      ...r,
      display_name: byUid[r.firebase_uid]?.display_name ?? null,
      email:        byUid[r.firebase_uid]?.email ?? null,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.display_name, r.email, r.firebase_uid, r.order_id, r.payment_id, r.plan_id]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  /* Collected counts REDEEMED rows only. Summing every row would count
   * abandoned checkouts as revenue. */
  const stats = useMemo(() => {
    const paid = rows.filter((r) => r.status === 'redeemed');
    return {
      collected: paid.reduce((sum, r) => sum + (Number(r.amount_paise) || 0), 0),
      paid:      paid.length,
      started:   rows.length - paid.length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Receipt size={18} className="text-primary-400" />
          <h2 className="text-lg font-semibold text-white">Billing history</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, order or payment id…"
              className="pl-8 pr-3 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 w-72"
            />
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            title="Reload"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Deliberately prominent. The single most likely misuse of this screen is
          treating a row as proof of a compliant invoice having been issued. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2">
        <CircleAlert size={15} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-200/90">
          This is a <strong>payment log</strong>, not a tax invoice — no invoice number, GSTIN, tax
          breakup or place of supply. GST invoicing is scoped but not built, pending confirmation of
          registration status and the education-exemption question.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat icon={IndianRupee} label="Collected" value={rupees(stats.collected)} tone="emerald" />
        <Stat icon={CircleCheck} label="Payments"  value={stats.paid} tone="primary" />
        <Stat icon={CircleDashed} label="Started, not completed" value={stats.started} tone="amber" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-xs">
              <tr>
                <Th>Student</Th><Th>Plan</Th><Th className="text-right">Amount</Th>
                <Th>Status</Th><Th>Started</Th><Th>Paid</Th><Th>Razorpay ids</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && (
                <tr><td colSpan={7} className="py-10 text-center text-slate-500">
                  <Loader2 size={18} className="animate-spin inline" />
                </td></tr>
              )}

              {!loading && !filtered.length && (
                <tr><td colSpan={7} className="py-10 text-center text-slate-500 text-sm">
                  {rows.length
                    ? 'No payment matches that search.'
                    : 'No payments yet. Checkout is gated behind the payments_enabled flag.'}
                </td></tr>
              )}

              {!loading && filtered.map((r) => {
                const chip = statusChip(r.status);
                return (
                  <motion.tr
                    key={r.order_id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="hover:bg-slate-900/40"
                  >
                    <Td>
                      <div className="text-slate-200">{r.display_name ?? '—'}</div>
                      <div className="text-[11px] text-slate-500">{r.email ?? r.firebase_uid}</div>
                    </Td>
                    <Td><span className="text-slate-300">{r.plan_id}</span></Td>
                    <Td className="text-right text-slate-200 tabular-nums">{rupees(r.amount_paise)}</Td>
                    <Td>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${chip.cls}`}>
                        <chip.Icon size={11} />{chip.label}
                      </span>
                    </Td>
                    <Td className="text-slate-400 text-xs">{fmt(r.created_at)}</Td>
                    <Td className="text-slate-400 text-xs">{fmt(r.redeemed_at)}</Td>
                    <Td>
                      <div className="font-mono text-[10px] text-slate-500 leading-tight">
                        <div>{r.order_id}</div>
                        {r.payment_id && <div className="text-slate-600">{r.payment_id}</div>}
                      </div>
                    </Td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const TONES = {
  emerald: 'text-emerald-400',
  primary: 'text-primary-400',
  amber:   'text-amber-400',
};

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="flex items-center gap-2 text-slate-400 text-xs">
        <Icon size={13} className={TONES[tone]} />{label}
      </div>
      <div className="text-xl font-semibold text-white mt-1 tabular-nums">{value}</div>
    </div>
  );
}

const Th = ({ children, className = '' }) => (
  <th className={`text-left font-medium px-3 py-2 ${className}`}>{children}</th>
);
const Td = ({ children, className = '' }) => (
  <td className={`px-3 py-2 align-top ${className}`}>{children}</td>
);
