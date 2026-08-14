import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Save, Plus, Trash2, RefreshCw, Check, IndianRupee } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { PLANS as DEFAULT_PLANS, computeGst } from '../lib/subscription';
import { usePlatformSettings } from '../hooks/usePlatformSettings';

const PLAN_IDS = ['free', 'premium_monthly', 'premium_yearly', 'neet_complete'];

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid ?? '' : '';
  } catch { return ''; }
}

/* Load config from Supabase, merging with hardcoded defaults */
async function loadPlanConfig() {
  const { data } = await supabase
    .from('plan_config')
    .select('*');

  const result = {};
  PLAN_IDS.forEach((id) => {
    const row   = data?.find((r) => r.plan_id === id);
    const def   = DEFAULT_PLANS[id] ?? {};
    result[id]  = {
      plan_id:     id,
      name:        row?.name        ?? def.name        ?? id,
      price_label: row?.price_label ?? def.priceLabel  ?? 'Free',
      price_paise: row?.price_paise ?? def.razorpayAmount ?? 0,
      description: row?.description ?? def.description ?? '',
      badge:       row?.badge       ?? def.badge        ?? '',
      features:    row?.features    ?? def.features     ?? [],
      locked:      row?.locked      ?? def.locked       ?? [],
      active:      row?.active      ?? true,
    };
  });
  return result;
}

async function savePlanConfig(planId, config, callerUid) {
  const { error } = await supabase.rpc('admin_upsert_plan_config', {
    p_caller:      callerUid,
    p_plan_id:     planId,
    p_name:        config.name,
    p_price_label: config.price_label,
    p_price_paise: Number(config.price_paise) || 0,
    p_description: config.description,
    p_badge:       config.badge,
    p_features:    config.features,
    p_locked:      config.locked,
    p_active:      config.active,
  });
  if (error) throw error;
  logChange(ENTITY.PLAN_CONFIG, planId, ACTION.UPDATE,
    { after: { price_paise: config.price_paise, active: config.active } },
    `Admin updated plan config for ${planId}`);
}

function FeatureListEditor({ items, onChange, placeholder, color = 'emerald' }) {
  const add = () => onChange([...items, '']);
  const del = (i) => onChange(items.filter((_, idx) => idx !== i));
  const upd = (i, v) => onChange(items.map((x, idx) => (idx === i ? v : x)));

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            value={item}
            onChange={(e) => upd(i, e.target.value)}
            className="flex-1 bg-slate-700 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-primary-500"
            placeholder={placeholder}
          />
          <button onClick={() => del(i)} className="text-red-400 hover:text-red-300 shrink-0">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className={`flex items-center gap-1 text-xs text-${color}-400 hover:text-${color}-300 font-medium mt-1`}
      >
        <Plus size={11} /> Add item
      </button>
    </div>
  );
}

function PlanEditor({ planId, config, onChange, onSave, saving, saved }) {
  const set = (field, val) => onChange({ ...config, [field]: val });
  // Display-only, same rule as every student-facing price now (owner
  // confirmed 2026-08-14: GST applies exclusive/on top, no exceptions for
  // an admin-set price) — create-razorpay-order applies this same
  // computation to whatever price_paise ends up here, unconditionally.
  const { tax_rate_percent: taxRatePercent } = usePlatformSettings();
  const gst = computeGst(Number(config.price_paise) || 0, taxRatePercent);

  return (
    <motion.div
      className="bg-slate-800 rounded-2xl border border-white/10 p-5 space-y-4"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-white capitalize">{planId.replace('_', ' ')}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${config.active ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
            {config.active ? 'Active' : 'Hidden'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => set('active', !config.active)}
            className="text-xs text-slate-400 hover:text-slate-200 border border-white/10 px-2 py-1 rounded-lg transition-colors"
          >
            {config.active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all ${
              saved ? 'bg-emerald-600 text-white' : 'bg-primary-600 hover:bg-primary-500 text-white'
            }`}
          >
            {saved ? <><Check size={11} /> Saved</> : saving ? 'Saving…' : <><Save size={11} /> Save</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1">Display Name</label>
          <input
            value={config.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1">Price Label (shown to users)</label>
          <input
            value={config.price_label}
            onChange={(e) => set('price_label', e.target.value)}
            placeholder="e.g. Rs.399/month"
            className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1">Price (paise — 39900 = Rs.399)</label>
          <div className="flex items-center gap-1.5">
            <IndianRupee size={13} className="text-slate-400 shrink-0" />
            <input
              type="number"
              value={config.price_paise}
              onChange={(e) => set('price_paise', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
            />
          </div>
          {config.price_paise > 0 && (
            <p className="text-[10px] text-slate-500 mt-0.5">
              = Rs.{(config.price_paise / 100).toFixed(0)}
              {gst.hasTax && ` · students are charged Rs.${(gst.totalPaise / 100).toFixed(2)} with ${gst.ratePercent}% GST added`}
            </p>
          )}
        </div>
        <div>
          <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1">Badge text (e.g. Most Popular)</label>
          <input
            value={config.badge}
            onChange={(e) => set('badge', e.target.value)}
            placeholder="Leave empty for none"
            className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1">Description</label>
        <input
          value={config.description}
          onChange={(e) => set('description', e.target.value)}
          className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold block mb-2">Included features</label>
          <FeatureListEditor
            items={config.features}
            onChange={(v) => set('features', v)}
            placeholder="Feature description"
            color="emerald"
          />
        </div>
        {planId === 'free' && (
          <div>
            <label className="text-[10px] text-red-400 uppercase tracking-wider font-semibold block mb-2">Locked / Premium-only</label>
            <FeatureListEditor
              items={config.locked ?? []}
              onChange={(v) => set('locked', v)}
              placeholder="Premium feature name"
              color="red"
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function AdminPricing() {
  const [configs,  setConfigs]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState({});
  const [saved,    setSaved]    = useState({});
  const [error,    setError]    = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await loadPlanConfig();
      setConfigs(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleChange = (planId, config) => {
    setConfigs((c) => ({ ...c, [planId]: config }));
  };

  const handleSave = async (planId) => {
    setSaving((s) => ({ ...s, [planId]: true }));
    try {
      await savePlanConfig(planId, configs[planId], getCallerUid());
      setSaved((s) => ({ ...s, [planId]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [planId]: false })), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving((s) => ({ ...s, [planId]: false }));
    }
  };

  return (
    <div className="space-y-6 max-w-3xl text-white">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pricing Config</h1>
          <p className="text-slate-400 text-sm mt-1">Changes apply immediately to all users.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-500/40 text-red-300 rounded-2xl p-4 text-sm">
          {error}
          <p className="text-[11px] text-red-400 mt-1">
            Run the plan_config table migration in Supabase first (see supabase/migrations/plan_config.sql).
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="h-4 w-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" /> Loading config…
        </div>
      ) : (
        <div className="space-y-4">
          {PLAN_IDS.map((id) => configs[id] && (
            <PlanEditor
              key={id}
              planId={id}
              config={configs[id]}
              onChange={(c) => handleChange(id, c)}
              onSave={() => handleSave(id)}
              saving={saving[id]}
              saved={saved[id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
