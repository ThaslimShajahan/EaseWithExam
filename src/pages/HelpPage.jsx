import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Search, Brain, FileText, Target, Layers, Zap, BarChart3,
  BookOpen, ChevronDown, ChevronUp, Trophy, Flame, Star,
  ArrowRight, CheckCircle2, Play, MessageCircle, Users,
  Sparkles, HelpCircle, ExternalLink, Headphones, BookMarked,
} from 'lucide-react';
import { FAQ_FLAT } from '../lib/landingContent';
import { usePlatformSettings } from '../hooks/usePlatformSettings';

/* ─── Data ──────────────────────────────────────────────────────────── */
const FEATURES = [
  {
    id: 'veda',
    icon: Brain, iconColor: 'text-violet-600', bg: 'bg-violet-50',
    category: 'AI Tools',
    title: 'EWE AI Tutor',
    desc: 'Get instant, step-by-step explanations for any concept. EWE evaluates your thinking and guides you rather than just giving answers away.',
    tip: 'Go to Ask EWE · Type a topic like "explain p-block elements" or paste a question you got wrong.',
    route: '/doubt', cta: 'Ask EWE',
    keywords: 'ai tutor doubt chat concept explain ewe',
  },
  {
    id: 'practice',
    icon: FileText, iconColor: 'text-primary-600', bg: 'bg-primary-50',
    category: 'AI Tools',
    title: 'AI Practice Questions',
    // Was "unlimited" — same overclaim fixed in the pricing copy 2026-08-14
    // (free is 20/day, premium 200/day, both real enforced caps).
    desc: 'Generate subject-wise questions at your chosen difficulty, with a generous daily allowance. Each answer includes a full solution and spaced repetition tagging.',
    tip: 'Practice → Generate → pick subject, chapter, difficulty',
    route: '/practice/generate', cta: 'Generate Questions',
    keywords: 'questions practice subject chapter generate difficulty',
  },
  {
    id: 'exam',
    icon: Target, iconColor: 'text-red-600', bg: 'bg-red-50',
    category: 'Exams',
    title: 'Exam Center',
    desc: 'Full-length AI mock papers in NEET / JEE / CBSE pattern. Real marking (+4 / −1), timed sessions, and full analysis after submission.',
    tip: 'Exam Center → New Paper → pick exam type and subject',
    route: '/exam-center', cta: 'Open Exam Center',
    keywords: 'mock test exam neet jee cbse paper timed score',
  },
  {
    id: 'flashcards',
    icon: Layers, iconColor: 'text-blue-600', bg: 'bg-blue-50',
    category: 'Study Tools',
    title: 'Smart Flashcards',
    desc: 'AI creates 12 flashcards per chapter using the SM-2 spaced repetition algorithm. Hard cards resurface sooner; mastered ones are spaced out.',
    tip: 'Flashcards → pick a subject and chapter → Start Study',
    route: '/flashcards', cta: 'Open Flashcards',
    keywords: 'flashcards spaced repetition sm2 chapter memory',
  },
  {
    id: 'studyplan',
    icon: Zap, iconColor: 'text-amber-600', bg: 'bg-amber-50',
    category: 'Planning',
    title: 'AI Study Plan',
    desc: 'Get a personalised week-by-week study plan based on your exam date, weak areas, and real progress. The plan adapts as you improve.',
    tip: 'Goals → Generate Plan → answer a few setup questions',
    route: '/goals', cta: 'Create Study Plan',
    keywords: 'study plan week schedule goals weak topic adaptive',
  },
  {
    id: 'analytics',
    icon: BarChart3, iconColor: 'text-emerald-600', bg: 'bg-emerald-50',
    category: 'Analytics',
    title: 'Analytics & Insights',
    desc: 'Score trend, subject-wise accuracy, weak chapter heatmap, and time-per-session tracking. AI identifies your highest-impact chapters.',
    tip: 'Take 2+ mock tests first — Analytics improves with more data.',
    route: '/analytics', cta: 'View Analytics',
    keywords: 'analytics score accuracy weak topic heatmap trend insight',
  },
  // Three real, live features that had zero entries here — found auditing
  // this page 2026-08-14. Routes and icons matched exactly to StudyHubPage.jsx,
  // the actual host (all three live under /study?tab=..., not their own route).
  {
    id: 'notebook',
    icon: BookMarked, iconColor: 'text-rose-600', bg: 'bg-rose-50',
    category: 'Study Tools',
    title: 'Error Notebook',
    desc: 'Every question you get wrong is saved automatically, grouped by the misconception behind it — not just the topic. Review what you actually keep getting wrong.',
    tip: 'Study → Error Notebook, or jump straight there after any practice session.',
    route: '/study?tab=notebook', cta: 'Open Error Notebook',
    keywords: 'error notebook wrong mistakes misconception review',
  },
  {
    id: 'summarizer',
    icon: Sparkles, iconColor: 'text-fuchsia-600', bg: 'bg-fuchsia-50',
    category: 'Study Tools',
    title: 'AI Summarizer',
    desc: 'Paste notes, an article, or a lecture PDF and get the key points back in seconds — useful for a quick pass before a test.',
    tip: 'Study → Summarizer → paste text or upload a PDF.',
    route: '/study?tab=summarizer', cta: 'Open Summarizer',
    keywords: 'summarizer summary notes pdf key points',
  },
  {
    id: 'podcast',
    icon: Headphones, iconColor: 'text-orange-600', bg: 'bg-orange-50',
    category: 'Study Tools',
    title: 'Podcast Generator',
    desc: 'Turn your notes into a short audio lesson you can listen to on the go — revision without staring at a screen.',
    tip: 'Study → Podcast → pick a chapter → Generate.',
    route: '/study?tab=podcast', cta: 'Open Podcast Generator',
    keywords: 'podcast audio listen notes revision',
  },
];

const CATEGORIES = ['All', ...new Set(FEATURES.map(f => f.category))];

const TIPS = [
  { icon: '🔥', tip: 'Study daily to keep your streak — even 20 min counts.' },
  { icon: '🎯', tip: 'Focus on weak topics first. Analytics surfaces these automatically.' },
  { icon: '📚', tip: 'Use flashcards the day before a mock test for quick revision.' },
  { icon: '⏰', tip: 'Practice under timed conditions — NEET allows ~48 sec per question.' },
  { icon: '💡', tip: 'Ask EWE "why is this wrong?" after an incorrect answer for deeper learning.' },
  { icon: '📈', tip: 'Check Analytics weekly — see which chapters need the most work.' },
];

const XP_TABLE = [
  { action: 'Correct practice answer', xp: 1,  icon: FileText },
  { action: 'Complete mock test',       xp: 5,  icon: Target },
  { action: 'Daily challenge',          xp: 20, icon: Flame },
  { action: 'EWE conversation',          xp: 10, icon: Brain },
  { action: 'Flashcard study session',  xp: 3,  icon: Layers },
];

// FAQ now comes from src/lib/landingContent.js, shared with the public landing
// page. The copy that used to live here claimed "15 AI questions, 20 EWE
// messages, and 3 mock tests per day" — all three numbers were wrong (real:
// 20, 15, and 2 mock tests per WEEK) and had drifted from FREE_LIMITS. The
// shared version interpolates them from that constant so it cannot drift again.
const FAQ = FAQ_FLAT;

const QUICK_ACTIONS = [
  { icon: Brain,       label: 'Ask EWE',         desc: 'AI doubt solver',      route: '/doubt',            color: 'from-violet-500 to-purple-600' },
  { icon: Target,      label: 'Take a Mock Test', desc: 'Full exam simulation', route: '/exam-center',       color: 'from-red-500 to-rose-600' },
  { icon: Layers,      label: 'Study Flashcards', desc: 'Spaced repetition',    route: '/flashcards',        color: 'from-blue-500 to-cyan-600' },
  { icon: BarChart3,   label: 'View Analytics',   desc: 'Your weak topics',     route: '/analytics',         color: 'from-emerald-500 to-teal-600' },
];

/* ─── Components ────────────────────────────────────────────────────── */
function QuickCard({ icon: Icon, label, desc, route, color }) {
  const navigate = useNavigate();
  return (
    <motion.button
      onClick={() => navigate(route)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={`flex flex-col items-start p-4 rounded-2xl bg-gradient-to-br ${color} text-white shadow-sm hover:shadow-md transition-all`}
    >
      <Icon size={20} className="mb-2 opacity-90" />
      <p className="text-sm font-bold leading-tight">{label}</p>
      <p className="text-[11px] opacity-75 mt-0.5">{desc}</p>
    </motion.button>
  );
}

function FeatureCard({ feature }) {
  const navigate = useNavigate();
  const Icon = feature.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`h-11 w-11 rounded-xl ${feature.bg} flex items-center justify-center shrink-0`}>
          <Icon size={20} className={feature.iconColor} />
        </div>
        <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-100 rounded-full px-2 py-0.5 mt-1 whitespace-nowrap">
          {feature.category}
        </span>
      </div>
      <div>
        <h3 className="font-bold text-slate-900">{feature.title}</h3>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">{feature.desc}</p>
      </div>
      <div className="bg-slate-50 rounded-xl px-3 py-2.5 text-[11px] text-slate-500 leading-relaxed">
        <span className="font-semibold text-slate-600 block mb-0.5">How to use</span>
        {feature.tip}
      </div>
      <button
        onClick={() => navigate(feature.route)}
        className="flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:text-primary-700 transition-colors"
      >
        {feature.cta} <ArrowRight size={13} />
      </button>
    </motion.div>
  );
}

function FAQItem({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        className="w-full flex items-center justify-between gap-3 py-4 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className="text-[9px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
            {item.tag}
          </span>
          <span className="text-sm font-semibold text-slate-800">{item.q}</span>
        </div>
        {open
          ? <ChevronUp size={15} className="text-slate-400 shrink-0" />
          : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-sm text-slate-500 leading-relaxed pb-4">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────── */
export default function HelpPage() {
  const [search,   setSearch]   = useState('');
  const [catTab,   setCatTab]   = useState('All');
  const [faqQuery, setFaqQuery] = useState('');
  const navigate = useNavigate();
  const { support_widget_enabled } = usePlatformSettings();

  const filteredFeatures = useMemo(() => {
    const q = search.toLowerCase();
    return FEATURES.filter(f => {
      const matchCat    = catTab === 'All' || f.category === catTab;
      const matchSearch = !q
        || f.title.toLowerCase().includes(q)
        || f.desc.toLowerCase().includes(q)
        || f.keywords.includes(q);
      return matchCat && matchSearch;
    });
  }, [search, catTab]);

  const filteredFAQ = useMemo(() => {
    const q = faqQuery.toLowerCase();
    return !q ? FAQ : FAQ.filter(f =>
      f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q) || f.tag.toLowerCase().includes(q)
    );
  }, [faqQuery]);

  return (
    <div className="space-y-8 p-4 lg:p-0 max-w-3xl mx-auto">

      {/* ── Hero header ── */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-800 rounded-3xl p-6 text-white space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles size={14} className="text-primary-200" />
            <span className="text-xs font-semibold text-primary-200 uppercase tracking-wider">Help Center</span>
          </div>
          <h1 className="text-2xl font-extrabold leading-tight">How can we help?</h1>
          <p className="text-sm text-primary-200 mt-1">Search features, tips, and answers below</p>
        </div>

        {/* Search box */}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search features, topics, questions…"
            className="w-full bg-white/10 border border-white/20 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/40 backdrop-blur-sm transition-colors"
          />
        </div>

        {/* Quick actions */}
        {!search && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QUICK_ACTIONS.map(a => <QuickCard key={a.label} {...a} />)}
          </div>
        )}
      </div>

      {/* ── 5-step Getting Started ── */}
      {!search && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <h2 className="font-bold text-slate-900 text-base">Getting started in 5 minutes</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              "Complete your profile so the AI knows which exam you're preparing for",
              "Take a practice session in your weakest subject to calibrate your level",
              "Ask EWE to explain a concept you've been struggling with",
              "Generate flashcards for one chapter and complete the full session",
              "Take a full mock test to see your baseline score",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3.5 px-5 py-3.5">
                <div className="h-6 w-6 rounded-full bg-primary-50 border border-primary-100 flex items-center justify-center text-[11px] font-bold text-primary-700 shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Features ── */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BookOpen size={18} className="text-primary-600" /> Features
          </h2>
          {/* Category tabs */}
          {!search && (
            <div className="flex gap-1 overflow-x-auto scrollbar-hide">
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setCatTab(cat)}
                  className={['px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors',
                    catTab === cat
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'].join(' ')}>
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredFeatures.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center gap-3">
            <HelpCircle size={24} className="text-slate-300" />
            <p className="text-sm text-slate-500">No features match "{search}"</p>
            <button onClick={() => setSearch('')} className="text-xs text-primary-600 font-semibold hover:underline">
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {filteredFeatures.map(f => <FeatureCard key={f.id} feature={f} />)}
          </div>
        )}
      </div>

      {/* ── XP Table ── */}
      {!search && (
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Trophy size={18} className="text-amber-500" /> XP Rewards
          </h2>
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            {XP_TABLE.map(({ action, xp, icon: Icon }, i) => (
              <div key={i}
                className={`flex items-center justify-between px-4 py-3 ${i < XP_TABLE.length - 1 ? 'border-b border-slate-50' : ''}`}>
                <div className="flex items-center gap-2.5 text-sm text-slate-700">
                  <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Icon size={13} className="text-amber-500" />
                  </div>
                  {action}
                </div>
                <span className="text-sm font-bold text-amber-600 tabular-nums">+{xp} XP</span>
              </div>
            ))}
          </div>
          <div className="mt-3 bg-amber-50 rounded-xl px-4 py-3">
            <p className="text-[11px] text-amber-700 font-semibold mb-1">Level milestones</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {[['Curious', '100'], ['Practitioner', '500'], ['Scholar', '1k'], ['Master', '5k'], ['Legend', '10k']].map(([name, xp]) => (
                <span key={name} className="text-[11px] text-amber-600">
                  <span className="font-bold">{xp} XP</span> = {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Pro Tips ── */}
      {!search && (
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Flame size={18} className="text-orange-500" /> Pro Tips
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {TIPS.map(({ icon, tip }) => (
              <div key={tip} className="bg-white rounded-xl border border-slate-100 p-3.5 flex items-start gap-3">
                <span className="text-lg shrink-0 leading-none">{icon}</span>
                <p className="text-xs text-slate-600 leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── FAQ ── */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <HelpCircle size={18} className="text-primary-600" /> FAQ
          </h2>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={faqQuery}
              onChange={e => setFaqQuery(e.target.value)}
              placeholder="Search FAQ…"
              className="w-44 bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-primary-400 transition-colors"
            />
          </div>
        </div>
        {filteredFAQ.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No FAQ matches "{faqQuery}"</p>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 px-4">
            {filteredFAQ.map(item => <FAQItem key={item.q} item={item} />)}
          </div>
        )}
      </div>

      {/* ── Support nudge ── */}
      <div className="bg-gradient-to-br from-slate-50 to-primary-50 rounded-2xl p-5 border border-primary-100 flex items-center gap-4 flex-wrap">
        <div className="h-12 w-12 rounded-2xl bg-primary-100 flex items-center justify-center shrink-0">
          <MessageCircle size={22} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">Still have questions?</p>
          <p className="text-xs text-slate-500 mt-0.5">Ask EWE — it knows your progress and can help with study strategy, not just subject doubts.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Redber chat, gated behind Admin > Platform > Settings — same
              on/off pattern as the cookie banner, default off. A full page
              (/support), not a floating bubble — see SupportPage.jsx /
              docs/CHANGELOG.md 2026-08-19 for why the floating widget.js
              approach was dropped (hardcoded position overlapped real page
              content, no icon control, an unconditional auto-open). */}
          {support_widget_enabled === 'true' && (
            <button
              onClick={() => navigate('/support')}
              className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 transition-colors"
            >
              Chat with us <MessageCircle size={11} />
            </button>
          )}
          <a href="mailto:support@easewithexam.in"
            className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 transition-colors">
            Email <ExternalLink size={11} />
          </a>
          {/* Parity with the public /contact page's phone entry — a signed-in
              student had no phone option here before, only email + (now) chat. */}
          <a href="tel:+916238910451"
            className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 transition-colors">
            Call <ExternalLink size={11} />
          </a>
        </div>
      </div>

    </div>
  );
}
