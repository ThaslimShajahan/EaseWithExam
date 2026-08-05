import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Plus, Trash2, RefreshCw, Bell, Calendar, Loader2,
  ExternalLink, X, Zap, CheckCircle2, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  getMonitoredSources, addMonitoredSource, deleteMonitoredSource,
  getExamNotifications, clearExamNotifications, deactivateExamNotification,
} from '../lib/supabase';
import { fetchExamAlerts } from '../lib/examAlerts';
import Button from '../components/ui/Button';

/* ── Preset sources — no manual URL typing needed ─────────── */
const PRESET_GROUPS = [
  {
    group: 'NEET / Medical',
    color: 'text-emerald-400',
    sources: [
      { name: 'NTA – NEET UG',          url: 'https://neet.nta.nic.in',         category: 'Medical'     },
      { name: 'NTA Official',            url: 'https://nta.ac.in',               category: 'Medical'     },
      { name: 'AYUSH Admissions (AACCC)',url: 'https://aaccc.gov.in',            category: 'Medical'     },
      { name: 'MCC – Counselling',       url: 'https://mcc.nic.in',              category: 'Medical'     },
    ],
  },
  {
    group: 'JEE / Engineering',
    color: 'text-blue-400',
    sources: [
      { name: 'NTA – JEE Main',          url: 'https://jeemain.nta.nic.in',      category: 'Engineering' },
      { name: 'JEE Advanced (IIT)',       url: 'https://jeeadv.ac.in',            category: 'Engineering' },
      { name: 'JOSAA Counselling',        url: 'https://josaa.nic.in',            category: 'Engineering' },
    ],
  },
  {
    group: 'CBSE / Boards',
    color: 'text-violet-400',
    sources: [
      { name: 'CBSE',                    url: 'https://cbse.gov.in',             category: 'State PSC'   },
      { name: 'CBSE Results',            url: 'https://results.cbse.nic.in',     category: 'State PSC'   },
    ],
  },
];

const ALL_PRESETS = PRESET_GROUPS.flatMap((g) => g.sources);

const TYPE_CONFIG = {
  notification: { label: 'Notification', bg: 'bg-blue-100   text-blue-700'   },
  application:  { label: 'Application',  bg: 'bg-emerald-100 text-emerald-700' },
  admit_card:   { label: 'Admit Card',   bg: 'bg-amber-100  text-amber-700'   },
  result:       { label: 'Result',       bg: 'bg-violet-100 text-violet-700'  },
  schedule:     { label: 'Schedule',     bg: 'bg-slate-100  text-slate-600'   },
  syllabus:     { label: 'Syllabus',     bg: 'bg-pink-100   text-pink-700'    },
};

const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

export default function AdminExamWatch() {
  const [sources,        setSources]        = useState([]);
  const [notifications,  setNotifications]  = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [scraping,       setScraping]       = useState(new Set());
  const [autoRunning,    setAutoRunning]    = useState(false);
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [showPresets,    setShowPresets]    = useState(true);
  const [filterCat,      setFilterCat]      = useState('All');
  const [toast,          setToast]          = useState(null);
  const [loadError,      setLoadError]      = useState('');
  const [form,           setForm]           = useState({ name: '', url: '', examCategory: 'Medical' });
  const autoTriggered = useRef(false);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [s, n] = await Promise.all([getMonitoredSources(), getExamNotifications()]);
      setSources(s);
      setNotifications(n);
      return s;
    } catch (e) {
      setLoadError(e.message || 'Failed to load sources.');
      return [];
    } finally {
      setLoading(false);
    }
  };

  /* Auto-scrape stale sources on mount */
  useEffect(() => {
    load().then((srcs) => {
      if (autoTriggered.current) return;
      const stale = srcs.filter((s) => {
        if (!s.is_active) return false;
        if (!s.last_scraped) return true;
        return Date.now() - new Date(s.last_scraped).getTime() > STALE_MS;
      });
      if (stale.length > 0) {
        autoTriggered.current = true;
        handleScrapeList(stale, true);
      }
    });
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  /* Add a single preset that isn't already in the list */
  const addPreset = async (preset, existingNames) => {
    if (existingNames.has(preset.name)) return null;
    try {
      return await addMonitoredSource({ name: preset.name, url: preset.url, examCategory: preset.category });
    } catch { return null; }
  };

  const handleQuickSetup = async () => {
    const existingNames = new Set(sources.map((s) => s.name));
    const toAdd = ALL_PRESETS.filter((p) => !existingNames.has(p.name));
    if (!toAdd.length) { showToast('All preset sources already added'); return; }

    showToast(`Adding ${toAdd.length} sources…`);
    const results = await Promise.all(toAdd.map((p) => addPreset(p, existingNames)));
    const added = results.filter(Boolean);
    setSources((prev) => [...added, ...prev]);
    showToast(`Added ${added.length} sources. Starting auto-scrape…`);
    const freshSources = [...added, ...sources];
    handleScrapeList(freshSources.filter((s) => s.is_active !== false), true);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.url.trim() || !form.name.trim()) return;
    try {
      const source = await addMonitoredSource(form);
      setSources((s) => [source, ...s]);
      setForm({ name: '', url: '', examCategory: 'Medical' });
      setShowAddForm(false);
      showToast('Source added');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteMonitoredSource(id);
      setSources((s) => s.filter((x) => x.id !== id));
      showToast('Source removed');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    }
  };

  const scrapeSingle = async (source) => {
    setScraping((s) => new Set(s).add(source.id));
    try {
      const count = await fetchExamAlerts(source);
      setSources((prev) => prev.map((s) => s.id === source.id ? { ...s, last_scraped: new Date().toISOString() } : s));
      return count;
    } catch (err) {
      showToast(`${source.name}: ${err.message}`, 'error');
      return 0;
    } finally {
      setScraping((s) => { const n = new Set(s); n.delete(source.id); return n; });
    }
  };

  const handleScrapeList = async (list, auto = false) => {
    if (auto) setAutoRunning(true);
    let total = 0;
    for (const s of list) { total += await scrapeSingle(s); }
    const fresh = await getExamNotifications();
    setNotifications(fresh);
    if (auto) setAutoRunning(false);
    showToast(`${auto ? 'Auto-scraped' : 'Scraped'}: found ${total} notification(s) across ${list.length} source(s)`);
  };

  const handleClearAll = async () => {
    if (!confirm('Delete all scraped notifications?')) return;
    await clearExamNotifications();
    setNotifications([]);
    showToast('Cleared all notifications');
  };

  const handleRemoveNotification = async (id) => {
    try {
      await deactivateExamNotification(id);
      setNotifications((n) => n.filter((x) => x.id !== id));
      showToast('Notification removed');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    }
  };

  const fmtAgo = (iso) => {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const isStale = (iso) => !iso || Date.now() - new Date(iso).getTime() > STALE_MS;

  const filtered = filterCat === 'All' ? notifications : notifications.filter((n) => n.category === filterCat);
  const cats     = ['All', ...new Set(notifications.map((n) => n.category).filter(Boolean))];
  const addedNames = new Set(sources.map((s) => s.name));
  const missingPresets = ALL_PRESETS.filter((p) => !addedNames.has(p.name));

  return (
    <div className="space-y-6 relative">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg max-w-sm ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bell size={20} className="text-amber-400" /> Exam Watch
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Auto-monitors official NEET/JEE sites · scrapes every 6 hours when page is open
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {autoRunning && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded-xl">
              <Loader2 size={12} className="animate-spin" /> Auto-scraping…
            </span>
          )}
          {sources.filter((s) => s.is_active !== false).length > 0 && (
            <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />}
              onClick={() => handleScrapeList(sources.filter((s) => s.is_active !== false))}>
              Scrape All Now
            </Button>
          )}
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setShowAddForm((v) => !v)}>
            Add Custom
          </Button>
        </div>
      </div>

      {/* Quick Setup panel */}
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowPresets((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-amber-400" />
            <span className="text-white font-semibold text-sm">Quick Setup — Official NEET / JEE Sites</span>
            {missingPresets.length === 0
              ? <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">All added</span>
              : <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">{missingPresets.length} not added yet</span>}
          </div>
          {showPresets ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </button>
        <AnimatePresence initial={false}>
          {showPresets && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="px-5 pb-5 space-y-4 border-t border-white/10">
                {PRESET_GROUPS.map((grp) => (
                  <div key={grp.group}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${grp.color}`}>{grp.group}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {grp.sources.map((p) => {
                        const added = addedNames.has(p.name);
                        return (
                          <div key={p.name}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition-colors ${added ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>
                            <div className="min-w-0">
                              <p className={`font-medium truncate ${added ? 'text-emerald-300' : 'text-white'}`}>{p.name}</p>
                              <p className="text-slate-500 truncate text-[10px]">{p.url}</p>
                            </div>
                            {added
                              ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0 ml-2" />
                              : <button onClick={async () => {
                                  const s = await addPreset(p, addedNames);
                                  if (s) { setSources((prev) => [s, ...prev]); showToast(`Added ${p.name}`); }
                                }}
                                className="text-[10px] bg-primary-600 text-white px-2 py-1 rounded-lg hover:bg-primary-700 shrink-0 ml-2 transition-colors">
                                Add
                              </button>
                            }
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {missingPresets.length > 0 && (
                  <button onClick={handleQuickSetup}
                    className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary-700 transition-colors">
                    <Zap size={15} /> Add All Missing + Auto-Scrape ({missingPresets.length} sources)
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Custom add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.form initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            onSubmit={handleAdd}
            className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold text-sm">Add Custom Source</p>
              <button type="button" onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-white">
                <X size={15} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Name</label>
                <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-primary-500"
                  placeholder="e.g. NTA NEET"
                  value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Category</label>
                <select className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                  value={form.examCategory} onChange={(e) => setForm((f) => ({ ...f, examCategory: e.target.value }))}>
                  {['Medical', 'Engineering', 'Banking', 'SSC', 'UPSC', 'State PSC', 'Railways', 'Defence'].map((c) =>
                    <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Official URL</label>
              <input className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-primary-500"
                type="url" placeholder="https://neet.nta.nic.in"
                value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" icon={<Plus size={13} />}>Add & Scrape</Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {loadError && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-2xl p-4 flex items-center gap-3">
          <Bell size={16} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{loadError}</p>
          <button onClick={load} className="ml-auto text-xs text-red-400 hover:text-red-200 font-semibold shrink-0">Retry</button>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Sources list */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-2">
            Monitored Sources
            <span className="text-slate-500 font-normal normal-case">({sources.length})</span>
          </h2>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : sources.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
              <Globe size={20} className="text-slate-500 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Use "Quick Setup" above to add official NEET/JEE sites instantly.</p>
            </div>
          ) : (
            sources.map((src) => (
              <div key={src.id} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium text-sm truncate">{src.name}</p>
                    <span className="badge bg-white/10 text-slate-300 text-[10px]">{src.exam_category}</span>
                  </div>
                  <button onClick={() => handleDelete(src.id)} className="text-slate-500 hover:text-red-400 transition-colors p-1 shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
                <a href={src.url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-primary-400 hover:text-primary-300 flex items-center gap-0.5 truncate mb-3">
                  <ExternalLink size={9} /> {src.url}
                </a>
                <div className="flex items-center justify-between">
                  <span className={`flex items-center gap-1 text-[10px] ${isStale(src.last_scraped) ? 'text-amber-400' : 'text-slate-500'}`}>
                    <Clock size={9} /> {fmtAgo(src.last_scraped)}
                    {isStale(src.last_scraped) && src.last_scraped && <span className="text-amber-400"> · stale</span>}
                  </span>
                  <button
                    onClick={() => scrapeSingle(src).then(async (count) => {
                      const fresh = await getExamNotifications();
                      setNotifications(fresh);
                      showToast(`${src.name}: found ${count} notification(s)`);
                    })}
                    disabled={scraping.has(src.id)}
                    className="flex items-center gap-1 text-[11px] text-primary-400 hover:text-primary-300 disabled:opacity-50 transition-colors font-medium">
                    {scraping.has(src.id) ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    Scrape
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Notifications feed */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
              Scraped Notifications <span className="text-slate-500 font-normal normal-case">({notifications.length})</span>
            </h2>
            {notifications.length > 0 && (
              <button onClick={handleClearAll} className="text-[11px] text-red-400 hover:text-red-300 transition-colors">
                Clear all
              </button>
            )}
          </div>

          {cats.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <button key={c} onClick={() => setFilterCat(c)}
                  className={['px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    filterCat === c ? 'bg-primary-600 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/20'].join(' ')}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
              <Bell size={24} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 font-medium text-sm">No notifications yet</p>
              <p className="text-slate-500 text-xs mt-1">
                {sources.length === 0
                  ? 'Use "Quick Setup" above to add NEET/JEE sources first.'
                  : autoRunning ? 'Auto-scraping in progress…' : 'Click "Scrape All Now" or wait for auto-scrape.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((n, i) => {
                const typeCfg  = TYPE_CONFIG[n.notification_type] || TYPE_CONFIG.notification;
                const dateKeys = Object.entries(n.important_dates || {}).filter(([, v]) => v);
                return (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className={`badge text-[10px] ${typeCfg.bg}`}>{typeCfg.label}</span>
                        <span className="badge bg-white/10 text-slate-300 text-[10px]">{n.exam_body}</span>
                        {n.category && <span className="badge bg-white/10 text-slate-400 text-[10px]">{n.category}</span>}
                      </div>
                      <button onClick={() => handleRemoveNotification(n.id)} className="text-slate-500 hover:text-red-400 transition-colors p-1 shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <p className="text-white text-sm font-medium leading-snug">{n.title}</p>
                    {n.exam_name && n.exam_name !== n.title && (
                      <p className="text-xs text-primary-400 mt-0.5">{n.exam_name}</p>
                    )}
                    {n.description && (
                      <p className="text-xs text-slate-400 leading-relaxed mt-1">{n.description}</p>
                    )}
                    {dateKeys.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {dateKeys.map(([key, val]) => (
                          <div key={key} className="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1">
                            <Calendar size={9} className="text-amber-400" />
                            <span className="text-[10px] text-slate-300">
                              {key.replace(/_/g, ' ')}: <span className="text-white font-medium">{val}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {n.source_url && (
                      <a href={n.source_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-primary-400 hover:text-primary-300 mt-2 transition-colors">
                        <ExternalLink size={9} /> Official site
                      </a>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-slate-400 leading-relaxed space-y-1">
        <p className="font-semibold text-slate-300">How it works</p>
        <p>• Notifications are fetched using GPT-4o's knowledge of Indian exam schedules — no website scraping needed.</p>
        <p>• Sources stale for more than 6 hours are automatically refreshed when this page is opened.</p>
        <p>• Duplicate notifications are filtered before saving.</p>
        <p>• Data accuracy depends on GPT-4o training knowledge. For live real-time data, verify on the official site.</p>
      </div>
    </div>
  );
}
