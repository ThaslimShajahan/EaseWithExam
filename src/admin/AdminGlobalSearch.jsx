import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, FileText, BookOpen, ClipboardList, Users,
  LayoutDashboard, Globe, Wand2, Bell, CreditCard, Settings,
  Building2, ToggleRight, Send, Library, BookOpenText, BarChart3,
  Database, Upload, ClipboardCheck, ArrowRight, Tag,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const QUICK_LINKS = [
  { label: 'Overview',        path: '/admin',              icon: LayoutDashboard },
  { label: 'PDF Upload',      path: '/admin/pdfupload',    icon: Upload          },
  { label: 'Review Queue',    path: '/admin/review',       icon: ClipboardCheck  },
  { label: 'Paper Generator', path: '/admin/papergen',     icon: Wand2           },
  { label: 'Published Tests', path: '/admin/tests',        icon: ClipboardList   },
  { label: 'Students',        path: '/admin/students',     icon: Users           },
  { label: 'Study Notes',     path: '/admin/notes',        icon: BookOpen        },
  { label: 'Coaching',        path: '/admin/coaching',     icon: Building2       },
  { label: 'Subscriptions',   path: '/admin/subscriptions',icon: CreditCard      },
  { label: 'Pricing',         path: '/admin/pricing',      icon: Tag             },
  { label: 'Feature Flags',   path: '/admin/flags',        icon: ToggleRight     },
  { label: 'Push Notif.',     path: '/admin/push',         icon: Send            },
  { label: 'Blueprints',      path: '/admin/blueprints',   icon: BarChart3       },
  { label: 'Syllabus',        path: '/admin/syllabus',     icon: BookOpenText    },
  { label: 'Crawler',         path: '/admin/crawler',      icon: Globe           },
  { label: 'Content Library', path: '/admin/library',      icon: Library         },
  { label: 'Platform',        path: '/admin/settings',     icon: Settings        },
  { label: 'Exam Watch',      path: '/admin/examwatch',    icon: Bell            },
  { label: 'Data',            path: '/admin/data',         icon: Database        },
];

async function runSearch(q) {
  if (!q.trim()) return [];
  const term = `%${q.trim()}%`;
  function getCallerUid() {
    try {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
      return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
    } catch { return ''; }
  }

  const [tests, notes, questions] = await Promise.all([
    supabase.rpc('admin_search_published_tests', { p_caller: getCallerUid(), p_query: q.trim(), p_limit: 5 }).then((r) => ({ data: r.data })),
    supabase.from('study_notes')
      .select('id, title, subject, exam_type')
      .ilike('title', term)
      .eq('is_published', true)
      .limit(5),
    supabase.from('pyq_questions')
      .select('id, question_text, subject, exam_type')
      .ilike('question_text', term)
      .limit(4),
  ]);

  const results = [];

  (tests.data ?? []).forEach((r) =>
    results.push({
      id: `test-${r.id}`, type: 'Published Test', icon: ClipboardList,
      label: r.title, sub: `${r.exam_type} · ${r.subject}`,
      path: '/admin/tests', accent: 'text-blue-400',
    })
  );

  (notes.data ?? []).forEach((r) =>
    results.push({
      id: `note-${r.id}`, type: 'Study Note', icon: BookOpen,
      label: r.title, sub: `${r.exam_type ?? ''} · ${r.subject ?? ''}`,
      path: '/admin/notes', accent: 'text-emerald-400',
    })
  );

  (questions.data ?? []).forEach((r) =>
    results.push({
      id: `pyq-${r.id}`, type: 'PYQ Question', icon: FileText,
      label: r.question_text?.slice(0, 80) + (r.question_text?.length > 80 ? '…' : ''),
      sub: `${r.exam_type ?? ''} · ${r.subject ?? ''}`,
      path: '/admin/library', accent: 'text-violet-400',
    })
  );

  return results;
}

export default function AdminGlobalSearch({ open, onClose }) {
  const navigate  = useNavigate();
  const inputRef  = useRef();
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(0);

  const allItems = query.trim()
    ? results
    : QUICK_LINKS.map((l) => ({
        id: `ql-${l.path}`, type: 'Page', icon: l.icon, label: l.label,
        path: l.path, accent: 'text-slate-400', sub: '',
      }));

  const go = useCallback((path) => {
    navigate(path);
    onClose();
    setQuery('');
    setResults([]);
  }, [navigate, onClose]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      setQuery('');
      setResults([]);
      setFocused(0);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await runSearch(query);
      setResults(r);
      setFocused(0);
      setLoading(false);
    }, 280);
    return () => clearTimeout(t);
  }, [query]);

  function handleKey(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, allItems.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, 0)); }
    if (e.key === 'Enter' && allItems[focused]) go(allItems[focused].path);
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh] px-4">
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Panel */}
        <motion.div
          className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ opacity: 0, y: -20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
            <Search size={16} className="text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Search tests, notes, questions or navigate to a page…"
              className="flex-1 bg-transparent text-white text-sm placeholder:text-slate-600 outline-none"
            />
            {loading && (
              <div className="h-3.5 w-3.5 rounded-full border-2 border-slate-600 border-t-primary-400 animate-spin shrink-0" />
            )}
            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white transition-colors">
              <X size={13} />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto py-2">
            {allItems.length === 0 && query.trim() && !loading && (
              <div className="px-4 py-8 text-center text-slate-500 text-sm">No results for "{query}"</div>
            )}

            {!query.trim() && (
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Quick Navigation</p>
            )}

            {query.trim() && results.length > 0 && (
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Results</p>
            )}

            <div className={!query.trim() ? 'grid grid-cols-2 gap-0.5 px-2' : 'space-y-0.5 px-2'}>
              {allItems.map((item, i) => {
                const Icon = item.icon;
                const isFoc = focused === i;
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item.path)}
                    onMouseEnter={() => setFocused(i)}
                    className={[
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                      isFoc ? 'bg-white/8 text-white' : 'text-slate-400 hover:bg-white/5',
                    ].join(' ')}
                  >
                    <Icon size={14} className={`shrink-0 ${item.accent}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate leading-none">{item.label}</p>
                      {item.sub && <p className="text-[10px] text-slate-600 mt-0.5 truncate">{item.sub}</p>}
                    </div>
                    {!query.trim()
                      ? <span className="text-[9px] text-slate-700">{item.type}</span>
                      : <ArrowRight size={11} className={`shrink-0 transition-opacity ${isFoc ? 'opacity-50' : 'opacity-0'}`} />
                    }
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2.5 border-t border-white/5 flex items-center gap-4 text-[10px] text-slate-600">
            <span><kbd className="bg-white/8 text-slate-400 px-1.5 py-0.5 rounded font-mono text-[9px]">↑↓</kbd> navigate</span>
            <span><kbd className="bg-white/8 text-slate-400 px-1.5 py-0.5 rounded font-mono text-[9px]">↵</kbd> go</span>
            <span><kbd className="bg-white/8 text-slate-400 px-1.5 py-0.5 rounded font-mono text-[9px]">esc</kbd> close</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
