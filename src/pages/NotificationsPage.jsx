import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bell, Calendar, ExternalLink, Filter, Loader2, RefreshCw,
  FileText, CheckCircle2, CreditCard, BookOpen, Sparkles,
  Info, AlertTriangle, Trophy, ClipboardList, CheckCheck,
} from 'lucide-react';
import { getExamNotifications, supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const TYPE_CONFIG = {
  notification: { label: 'New Exam',     icon: Bell,          bg: 'bg-blue-50    border-blue-200',   text: 'text-blue-700'   },
  application:  { label: 'Apply Now',    icon: FileText,      bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  admit_card:   { label: 'Admit Card',   icon: CreditCard,    bg: 'bg-amber-50   border-amber-200',   text: 'text-amber-700'  },
  result:       { label: 'Result',       icon: CheckCircle2,  bg: 'bg-violet-50  border-violet-200',  text: 'text-violet-700' },
  schedule:     { label: 'Schedule',     icon: Calendar,      bg: 'bg-slate-50   border-slate-200',   text: 'text-slate-600'  },
  syllabus:     { label: 'Syllabus',     icon: BookOpen,      bg: 'bg-pink-50    border-pink-200',    text: 'text-pink-700'   },
};

const INAPP_TYPE = {
  info:        { icon: Info,          bg: 'bg-blue-50',   text: 'text-blue-700',   label: 'Info' },
  success:     { icon: CheckCircle2,  bg: 'bg-emerald-50',text: 'text-emerald-700',label: 'Success' },
  warning:     { icon: AlertTriangle, bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Alert' },
  achievement: { icon: Trophy,        bg: 'bg-violet-50', text: 'text-violet-700', label: 'Achievement' },
  assignment:  { icon: ClipboardList, bg: 'bg-orange-50', text: 'text-orange-700', label: 'Assignment' },
};

const PREF_KEY = 'exam_pilot_pref_cats';

function fmtDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const { currentUser }  = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [inAppNotifs,   setInAppNotifs]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [loadingIA,     setLoadingIA]     = useState(true);
  const [filterType,    setFilterType]    = useState('All');
  const [filterCat,     setFilterCat]     = useState('All');
  const [prefCats,      setPrefCats]      = useState(() => {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '[]'); } catch { return []; }
  });
  const [showPrefs,     setShowPrefs]     = useState(false);
  const [tab,           setTab]           = useState('inapp'); // inapp | exams

  const load = async () => {
    setLoading(true);
    const data = await getExamNotifications({ limit: 100 });
    setNotifications(data);
    setLoading(false);
  };

  const loadInApp = async () => {
    if (!currentUser) return;
    setLoadingIA(true);
    try {
      const { data } = await supabase.rpc('get_user_notifications', {
        p_uid: currentUser.uid, p_limit: 50,
      });
      setInAppNotifs(Array.isArray(data) ? data : []);
    } catch { setInAppNotifs([]); }
    setLoadingIA(false);
  };

  async function markAllRead() {
    if (!currentUser) return;
    await supabase.rpc('mark_all_notifications_read', { p_uid: currentUser.uid });
    setInAppNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { loadInApp(); }, [currentUser]);

  const unreadCount = inAppNotifs.filter(n => !n.is_read).length;

  const allCats  = ['All', ...new Set(notifications.map((n) => n.category).filter(Boolean))];
  const allTypes = ['All', ...new Set(notifications.map((n) => n.notification_type).filter(Boolean))];

  const togglePref = (cat) => {
    const next = prefCats.includes(cat) ? prefCats.filter((c) => c !== cat) : [...prefCats, cat];
    setPrefCats(next);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  };

  const filtered = notifications.filter((n) => {
    if (prefCats.length && !prefCats.includes(n.category)) return false;
    if (filterCat  !== 'All' && n.category          !== filterCat)  return false;
    if (filterType !== 'All' && n.notification_type !== filterType) return false;
    return true;
  });

  async function markOneRead(id) {
    if (!currentUser) return;
    await supabase.rpc('mark_notification_read', { p_uid: currentUser.uid, p_notif_id: id });
    setInAppNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  return (
    <div className="space-y-5 p-4 lg:p-0">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Bell size={18} className="text-amber-500" /> Notifications
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">In-app alerts and live exam updates</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'exams' && (
            <>
              <button onClick={() => setShowPrefs(s => !s)}
                className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
                <Filter size={15} />
              </button>
              <button onClick={load} className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            </>
          )}
          {tab === 'inapp' && unreadCount > 0 && (
            <button onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-50 text-primary-700 text-xs font-semibold hover:bg-primary-100 transition-colors">
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[
          { key: 'inapp', label: 'In-App', badge: unreadCount },
          { key: 'exams', label: 'Exam Alerts' },
        ].map(({ key, label, badge }) => (
          <button key={key} onClick={() => setTab(key)}
            className={['flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'].join(' ')}>
            {label}
            {badge > 0 && (
              <span className="h-4 min-w-4 px-1 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── IN-APP TAB ── */}
      {tab === 'inapp' && (
        <>
          {loadingIA ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
              <Loader2 size={16} className="animate-spin" /> Loading notifications…
            </div>
          ) : inAppNotifs.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center gap-3">
              <div className="h-14 w-14 rounded-2xl bg-violet-50 flex items-center justify-center">
                <Sparkles size={22} className="text-violet-400" />
              </div>
              <p className="font-semibold text-slate-700">You're all caught up!</p>
              <p className="text-sm text-slate-400 max-w-xs">New announcements, achievements, and alerts will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {inAppNotifs.map((n, i) => {
                const cfg  = INAPP_TYPE[n.type] || INAPP_TYPE.info;
                const Icon = cfg.icon;
                return (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    onClick={() => { if (!n.is_read) markOneRead(n.id); if (n.url) window.location.href = n.url; }}
                    className={['flex items-start gap-3 p-4 rounded-2xl border transition-colors cursor-default',
                      n.is_read
                        ? 'bg-white border-slate-100 opacity-70'
                        : 'bg-white border-slate-200 shadow-sm'].join(' ')}
                  >
                    <div className={`h-9 w-9 rounded-xl ${cfg.bg} flex items-center justify-center shrink-0`}>
                      <Icon size={15} className={cfg.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
                        {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary-500 shrink-0" />}
                      </div>
                      <p className="text-sm font-semibold text-slate-900 leading-snug">{n.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.body}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{fmtDate(n.created_at)}</p>
                    </div>
                    {n.url && (
                      <ExternalLink size={13} className="text-slate-300 shrink-0 mt-1" />
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── EXAM ALERTS TAB ── */}
      {tab === 'exams' && (
        <>
          {/* Preferences panel */}
          {showPrefs && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-700">My Exams (filter to relevant only)</p>
              <div className="flex flex-wrap gap-2">
                {allCats.filter(c => c !== 'All').map(cat => (
                  <button key={cat} onClick={() => togglePref(cat)}
                    className={['px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                      prefCats.includes(cat)
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'].join(' ')}>
                    {cat}
                  </button>
                ))}
              </div>
              {prefCats.length > 0 && (
                <button onClick={() => { setPrefCats([]); localStorage.removeItem(PREF_KEY); }}
                  className="text-xs text-red-500 hover:text-red-600 transition-colors">
                  Clear preferences
                </button>
              )}
            </motion.div>
          )}

          {/* Category filter tabs */}
          {allCats.length > 2 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {allCats.map(cat => (
                <button key={cat} onClick={() => setFilterCat(cat)}
                  className={['px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                    filterCat === cat
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'].join(' ')}>
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Type filter pills */}
          {allTypes.length > 2 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {allTypes.map(t => {
                const cfg = TYPE_CONFIG[t];
                return (
                  <button key={t} onClick={() => setFilterType(t)}
                    className={['px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 border',
                      filterType === t
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'].join(' ')}>
                    {cfg ? cfg.label : t}
                  </button>
                );
              })}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
              <Loader2 size={16} className="animate-spin" /> Fetching notifications…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center gap-3">
              <div className="h-14 w-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                <Bell size={22} className="text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-700">No exam alerts yet</p>
                <p className="text-sm text-slate-400 mt-1 max-w-xs">
                  {notifications.length > 0
                    ? 'Try adjusting your filters or preferences.'
                    : 'Ask your admin to add official exam sites and run a scrape.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((n, i) => {
                const cfg   = TYPE_CONFIG[n.notification_type] || TYPE_CONFIG.notification;
                const Icon  = cfg.icon;
                const dates = Object.entries(n.important_dates || {}).filter(([, v]) => v);
                return (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className={`bg-white border-l-4 rounded-2xl shadow-sm overflow-hidden ${cfg.bg}`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`p-2 rounded-xl bg-white/80 shrink-0 ${cfg.text}`}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className={`text-[10px] font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
                              <span className="text-[10px] text-slate-400">{n.exam_body}</span>
                              {n.category && <span className="text-[10px] bg-white/60 text-slate-500 px-1.5 py-0.5 rounded">{n.category}</span>}
                            </div>
                            <h3 className="text-sm font-semibold text-slate-900 leading-snug">{n.title}</h3>
                            {n.exam_name && n.exam_name !== n.title && (
                              <p className="text-xs text-primary-600 mt-0.5 font-medium">{n.exam_name}</p>
                            )}
                            {n.description && (
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{n.description}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">{fmtDate(n.scraped_at)}</span>
                      </div>

                      {dates.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-black/5">
                          <div className="flex flex-wrap gap-2">
                            {dates.map(([key, val]) => (
                              <div key={key} className="flex items-center gap-1.5 bg-white/60 rounded-lg px-2.5 py-1">
                                <Calendar size={10} className="text-amber-500 shrink-0" />
                                <span className="text-[10px] text-slate-600">
                                  <span className="capitalize">{key.replace(/_/g, ' ')}</span>:
                                  <span className="font-semibold text-slate-800 ml-1">{val}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {n.source_url && (
                        <a href={n.source_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] text-primary-600 hover:text-primary-700 mt-2 font-medium transition-colors">
                          <ExternalLink size={10} /> Official Website
                        </a>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
