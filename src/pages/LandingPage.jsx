import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Brain, FileText, Target, Zap, BarChart3, Sparkles, Headphones,
  Check, ArrowRight, Crown, UserPlus, ListChecks, TrendingUp, Bot,
  ImageIcon, Atom, FlaskConical, Dna, Calculator,
} from 'lucide-react';
import AuthModal from '../components/auth/AuthModal';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';
import { AtomDoodle, StarDoodle, DNADoodle, FormulaText } from '../components/ui/Illustrations';
import { PLANS } from '../lib/subscription';

/**
 * Drop a real file into public/landing/ with the matching name (see
 * public/landing/README.txt) and it replaces this placeholder automatically
 * — no code change needed.
 */
// Some of the placeholder character renders carry a faint non-transparent
// haze right at the canvas edge, which reads as a hard rectangle against a
// white page. `fade` feathers that edge away with a mask so it blends in.
const EDGE_FADE = 'radial-gradient(ellipse 82% 82% at center, black 70%, transparent 100%)';

function ImgOrPlaceholder({ src, alt, className, label, placeholderClassName = '', fade = false }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary-50 to-violet-50 border-2 border-dashed border-primary-200 text-primary-400 ${className} ${placeholderClassName}`}>
        <ImageIcon size={28} />
        {label && <span className="text-[11px] font-semibold text-primary-500 text-center px-3">{label}</span>}
      </div>
    );
  }
  const style = fade ? { maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE } : undefined;
  return <img src={src} alt={alt} className={className} style={style} onError={() => setBroken(true)} />;
}

const SUBJECTS = [
  { icon: Atom,         key: 'physics',   name: 'Physics',   desc: 'Mechanics to modern physics, with worked derivations.', badge: 'bg-primary-500' },
  { icon: FlaskConical, key: 'chemistry', name: 'Chemistry', desc: 'Organic, inorganic, and physical — all three, covered.',  badge: 'bg-violet-500' },
  { icon: Dna,          key: 'biology',   name: 'Biology',   desc: 'NCERT-aligned, diagram-heavy, built for NEET recall.',    badge: 'bg-emerald-500' },
  { icon: Calculator,   key: 'maths',     name: 'Maths',     desc: 'Step-by-step solutions, not just final answers.',         badge: 'bg-amber-500' },
];

const FEATURES = [
  { icon: Brain,      color: 'text-violet-600',  bg: 'bg-violet-50',  title: 'Ask EWE — AI Tutor', desc: 'Chat with an AI tutor that guides you to the answer with Socratic questions, instead of just handing it over.' },
  { icon: FileText,   color: 'text-primary-600', bg: 'bg-primary-50', title: 'AI Practice Questions', desc: 'Unlimited subject-wise questions at your chosen difficulty, each with a full worked solution.' },
  { icon: Target,     color: 'text-red-600',     bg: 'bg-red-50',     title: 'Full-Length Mock Tests', desc: 'Real NEET / JEE / board exam patterns, real marking scheme, timed sessions with full analysis after.' },
  { icon: Zap,        color: 'text-amber-600',   bg: 'bg-amber-50',   title: 'Adaptive Study Plan', desc: 'A week-by-week plan built around your exam date and weak areas, that adjusts as you improve.' },
  { icon: BarChart3,  color: 'text-emerald-600', bg: 'bg-emerald-50', title: 'Deep Analytics', desc: 'Score trends, subject-wise accuracy, and a weak-chapter heatmap so you know exactly what to study next.' },
  { icon: Sparkles,   color: 'text-blue-600',    bg: 'bg-blue-50',    title: 'AI Summarizer', desc: 'Paste notes, an article, or a lecture PDF — get key points and a clear overview in seconds.' },
  { icon: Headphones, color: 'text-teal-600',    bg: 'bg-teal-50',    title: 'Podcast Generator', desc: 'Turn your notes into a short audio lesson you can listen to on the go.' },
];

const STEPS = [
  { icon: UserPlus,    title: 'Create your free account', desc: 'Sign up in seconds with just your phone number — no credit card needed.' },
  { icon: ListChecks,  title: 'Get your personalised plan', desc: 'Tell us your exam and target date — EWE builds a week-by-week study plan around it.' },
  { icon: Bot,         title: 'Practice with AI, daily', desc: 'Ask doubts, generate questions, take mock tests, and get instant, detailed feedback.' },
  { icon: TrendingUp,  title: 'Track and improve', desc: 'Watch your accuracy and weak chapters shrink, mock test after mock test.' },
];

const DISPLAY_PLANS = ['free', 'premium_monthly', 'premium_yearly', 'neet_complete'];

function HeroBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary-100 blur-3xl opacity-70" />
      <div className="absolute top-10 -right-16 h-80 w-80 rounded-full bg-violet-100 blur-3xl opacity-60" />
      <div className="absolute top-16 right-[8%] hidden sm:block"><AtomDoodle size={70} opacity={0.14} color="#21A375" /></div>
      <div className="absolute top-40 left-[6%] hidden sm:block"><StarDoodle size={18} opacity={0.20} color="#21A375" /></div>
      <div className="absolute bottom-10 left-[12%] hidden lg:block"><DNADoodle height={90} opacity={0.12} color="#21A375" /></div>
      <div className="absolute bottom-24 right-[14%]"><FormulaText size={13} color="#21A375" opacity={0.16}>F = ma</FormulaText></div>
      <div className="absolute top-28 left-[30%] hidden lg:block"><FormulaText size={13} color="#21A375" opacity={0.14}>PV = nRT</FormulaText></div>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative w-full max-w-md mx-auto h-[420px] sm:h-[500px]">
      <ImgOrPlaceholder
        src="/landing/hero-illustration.png"
        alt="EWE — AI exam prep"
        label="Hero illustration goes here — drop hero-illustration.png into public/landing/"
        className="absolute inset-0 w-full h-full object-contain scale-110"
        placeholderClassName="rounded-[2rem]"
        fade
      />

      <motion.div
        initial={{ opacity: 0, y: 20, rotate: -6 }}
        animate={{ opacity: 1, y: 0, rotate: -4 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="absolute top-0 -left-6 sm:-left-16 w-[52%] bg-white rounded-2xl shadow-xl shadow-primary-900/10 border border-slate-100 p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-full bg-primary-100 flex items-center justify-center">
            <Bot size={14} className="text-primary-600" />
          </div>
          <span className="text-xs font-bold text-slate-700">Ask EWE</span>
        </div>
        <div className="bg-slate-50 rounded-xl rounded-tl-sm px-3 py-2 text-[11px] text-slate-600 mb-2">
          Why does the rate of reaction increase with temperature?
        </div>
        <div className="bg-primary-50 rounded-xl rounded-tr-sm px-3 py-2 text-[11px] text-primary-800 ml-6">
          Think about kinetic energy first — what happens to particle collisions as temperature rises?
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20, rotate: 6 }}
        animate={{ opacity: 1, y: 0, rotate: 5 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="absolute -bottom-2 -right-4 sm:-right-14 w-[64%] bg-white rounded-2xl shadow-xl shadow-primary-900/10 border border-slate-100 p-4"
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Mock Test Result</span>
        <div className="mt-2 space-y-2">
          {[
            { label: 'Physics',   pct: 82, color: 'bg-primary-500' },
            { label: 'Chemistry', pct: 68, color: 'bg-violet-500' },
            { label: 'Biology',   pct: 91, color: 'bg-emerald-500' },
          ].map((s) => (
            <div key={s.label}>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                <span>{s.label}</span><span className="font-semibold text-slate-700">{s.pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="absolute top-6 right-0 sm:-right-2 bg-white rounded-xl shadow-lg shadow-primary-900/10 border border-slate-100 px-3 py-2 flex items-center gap-2"
      >
        <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center">
          <Zap size={12} className="text-amber-600" />
        </div>
        <span className="text-[11px] font-bold text-slate-700">7-day streak 🔥</span>
      </motion.div>
    </div>
  );
}

function Hero({ onGetStarted }) {
  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 grid lg:grid-cols-2 gap-12 items-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center lg:text-left">
          <span className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 text-xs font-bold px-3 py-1.5 rounded-full border border-primary-100 mb-5">
            <Sparkles size={12} /> AI-Powered Exam Prep
          </span>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-slate-900 leading-tight">
            Study smarter for<br className="hidden lg:block" /> <span className="bg-gradient-to-r from-primary-600 to-violet-600 bg-clip-text text-transparent">NEET, JEE &amp; Boards</span>
          </h1>
          <p className="text-slate-500 text-lg mt-5 max-w-xl mx-auto lg:mx-0">
            Unlimited AI practice, real exam-pattern mock tests, and a personal AI tutor that actually teaches you — not just answers you.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mt-8">
            <button
              onClick={onGetStarted}
              className="flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-bold shadow-lg shadow-primary-600/20 transition-colors"
            >
              Get Started Free <ArrowRight size={16} />
            </button>
            <a href="#pricing" className="px-7 py-3.5 rounded-2xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold transition-colors">
              See Pricing
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 mt-6 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-500" /> No credit card needed</span>
            <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-500" /> Cancel anytime</span>
            <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-500" /> NEET · JEE · Boards</span>
          </div>
        </motion.div>

        <HeroVisual />
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    { icon: Target, label: 'NEET · JEE Main · JEE Advanced · All State & Central Boards' },
    { icon: Sparkles, label: '7 AI-powered study tools in one place' },
    { icon: Bot, label: 'Your AI tutor, available 24/7' },
  ];
  return (
    <section className="bg-primary-50/70 border-y border-primary-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-10 text-center">
        {items.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 text-sm font-semibold text-primary-800">
            <Icon size={16} className="text-primary-600 shrink-0" />
            {label}
          </div>
        ))}
      </div>
    </section>
  );
}

function ExploreSubjects() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center mb-12">
        <span className="inline-block text-xs font-bold text-primary-600 uppercase tracking-wide mb-3">Subjects</span>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Explore by subject</h2>
        <p className="text-slate-500 mt-3 max-w-lg mx-auto">Every chapter, every subject — practice questions, notes, and mock tests in one place.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {SUBJECTS.map(({ icon: Icon, key, name, desc, badge }, i) => (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ delay: i * 0.07 }}
            className="group rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all bg-white p-6 text-center"
          >
            <div className={`h-14 w-14 mx-auto rounded-full ${badge} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-md`}>
              <Icon size={24} className="text-white" />
            </div>
            <h3 className="font-bold text-slate-900">{name}</h3>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function WhySection() {
  const points = [
    'Built specifically for NEET, JEE, and state & central board patterns — not generic test prep.',
    'AI that teaches with guided questions, not just instant answers.',
    'Real exam-pattern mock tests with full post-test analysis.',
  ];
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
          className="relative order-2 lg:order-1"
        >
          <div className="relative h-[420px] sm:h-[500px]">
            <ImgOrPlaceholder
              src="/landing/why-section.png"
              alt="Studying with EWE"
              label="Drop why-section.png into public/landing/"
              className="absolute inset-0 w-full h-full object-contain scale-110"
              placeholderClassName="rounded-[2rem]"
              fade
            />
            <motion.div
              initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="absolute bottom-4 right-0 sm:right-4 min-w-[240px] bg-white rounded-2xl shadow-2xl shadow-primary-900/20 border-2 border-primary-100 px-5 py-3.5 flex items-center gap-3"
            >
              <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Check size={16} className="text-emerald-600" />
              </div>
              <span className="text-sm font-bold text-slate-900">Chapter completed</span>
            </motion.div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
          className="order-1 lg:order-2"
        >
          <span className="inline-block text-xs font-bold text-primary-600 uppercase tracking-wide mb-3">Why EWE</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Why students choose EWE</h2>
          <p className="text-slate-500 mt-3">Not another generic quiz app — everything here is built around how NEET, JEE, and board exams are actually structured and scored.</p>
          <div className="space-y-3 mt-7">
            {points.map((p) => (
              <div key={p} className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={13} className="text-primary-600" />
                </div>
                <span className="text-slate-600">{p}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16">
      <div className="text-center mb-12">
        <span className="inline-block text-xs font-bold text-primary-600 uppercase tracking-wide mb-3">Features</span>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Everything you need to crack your exam</h2>
        <p className="text-slate-500 mt-3 max-w-lg mx-auto">Built for NEET, JEE, and board students — not a generic study app.</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map(({ icon: Icon, color, bg, title, desc }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ delay: (i % 3) * 0.06 }}
            className="group bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-primary-100 transition-all"
          >
            <div className={`h-11 w-11 rounded-xl ${bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
              <Icon size={20} className={color} />
            </div>
            <h3 className="font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-slate-50 border-y border-slate-100 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-14">
          <span className="inline-block text-xs font-bold text-primary-600 uppercase tracking-wide mb-3">How it works</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">From sign-up to score improvement</h2>
          <p className="text-slate-500 mt-3 max-w-lg mx-auto">Four steps, all inside one app.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-4 relative">
          <div className="hidden lg:block absolute top-7 left-[12.5%] right-[12.5%] h-px bg-slate-200" />
          {STEPS.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="relative text-center"
            >
              <div className="relative z-10 h-14 w-14 mx-auto rounded-2xl bg-white border-2 border-primary-500 flex items-center justify-center shadow-sm">
                <Icon size={22} className="text-primary-600" />
              </div>
              <span className="block text-xs font-bold text-primary-500 mt-3">STEP {i + 1}</span>
              <h3 className="font-bold text-slate-900 mt-1">{title}</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed max-w-[220px] mx-auto">{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SuccessShowcase({ onGetStarted }) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
      <span className="inline-block text-xs font-bold text-primary-600 uppercase tracking-wide mb-3">Your Success Story</span>
      <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 max-w-2xl mx-auto">
        Every topper started exactly where you are now
      </h2>
      <p className="text-slate-500 mt-3 max-w-lg mx-auto">
        Thousands of NEET, JEE, and board students are already studying smarter with EWE — join them today.
      </p>
      <motion.div
        initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="relative max-w-lg mx-auto mt-6 h-[320px] sm:h-[420px]"
      >
        <ImgOrPlaceholder
          src="/landing/ewe_img.png"
          alt="Students celebrating exam success with EaseWithExam"
          label="Drop ewe_img.png into public/landing/"
          className="w-full h-full object-contain"
        />
      </motion.div>
      <button
        onClick={onGetStarted}
        className="mt-4 inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-bold shadow-lg shadow-primary-600/20 transition-colors"
      >
        Get Started Free <ArrowRight size={16} />
      </button>
    </section>
  );
}

function PlanCard({ plan, highlight, onSelect }) {
  return (
    <div className={[
      'relative rounded-3xl p-6 border-2 flex flex-col',
      highlight ? 'border-primary-500 bg-gradient-to-b from-primary-500 to-primary-800 text-white shadow-xl shadow-primary-200' : 'border-slate-200 bg-white text-slate-900',
    ].join(' ')}>
      {plan.badge && (
        <div className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold text-white px-3 py-1 rounded-full ${plan.badgeColor ?? 'bg-primary-500'}`}>
          {plan.badge}
        </div>
      )}
      <div className="mb-4">
        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-3 ${highlight ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
          {plan.id === 'free' ? <Zap size={12} /> : <Crown size={12} />} {plan.name}
        </div>
        <div className="flex items-end gap-1">
          <span className={`text-3xl font-extrabold ${highlight ? 'text-white' : 'text-slate-900'}`}>{plan.priceLabel.split('/')[0]}</span>
          {plan.priceLabel.includes('/') && <span className={`text-sm pb-1 ${highlight ? 'text-primary-200' : 'text-slate-400'}`}>/{plan.priceLabel.split('/')[1]}</span>}
        </div>
        <p className={`text-sm mt-1 ${highlight ? 'text-primary-200' : 'text-slate-500'}`}>{plan.description}</p>
      </div>
      <div className={`space-y-2 mb-6 flex-1 border-t pt-4 ${highlight ? 'border-white/20' : 'border-slate-100'}`}>
        {plan.features.map((f) => (
          <div key={f} className="flex items-start gap-2 text-sm">
            <Check size={14} className={`mt-0.5 shrink-0 ${highlight ? 'text-primary-200' : 'text-emerald-500'}`} />
            <span className={highlight ? 'text-primary-100' : 'text-slate-600'}>{f}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onSelect}
        className={highlight
          ? 'w-full py-2.5 rounded-xl bg-white text-primary-700 font-bold text-sm hover:bg-primary-50 transition-colors'
          : 'w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors'}
      >
        {plan.id === 'free' ? 'Start Free' : 'Get Started'}
      </button>
    </div>
  );
}

function Pricing({ onSelect }) {
  return (
    <section id="pricing" className="bg-gradient-to-b from-white to-primary-50/60 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-12">
          <span className="inline-block text-xs font-bold text-primary-600 uppercase tracking-wide mb-3">Pricing</span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Plans for every aspirant</h2>
          <p className="text-slate-500 mt-3">Start free, upgrade when you're ready. Cancel anytime.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {DISPLAY_PLANS.map((id, i) => (
            <PlanCard key={id} plan={PLANS[id]} highlight={i === 1} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA({ onGetStarted }) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <motion.div
        initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 to-primary-900 px-6 sm:px-16 py-14 text-center"
      >
        <div className="absolute -top-10 -right-10 opacity-20"><AtomDoodle size={140} opacity={1} color="white" /></div>
        <div className="absolute bottom-0 left-6 opacity-20"><StarDoodle size={26} opacity={1} color="white" /></div>
        <h2 className="text-2xl sm:text-4xl font-extrabold text-white relative z-10">Ready to study smarter, starting today?</h2>
        <p className="text-primary-100 mt-3 max-w-lg mx-auto relative z-10">Join EWE for free — no credit card, cancel anytime.</p>
        <button
          onClick={onGetStarted}
          className="relative z-10 mt-7 inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-white text-primary-700 font-bold shadow-lg hover:bg-primary-50 transition-colors"
        >
          Get Started Free <ArrowRight size={16} />
        </button>
      </motion.div>
    </section>
  );
}

export default function LandingPage() {
  const [showAuth, setShowAuth] = useState(false);
  return (
    <div className="min-h-screen bg-white">
      <PublicNavBar onSignIn={() => setShowAuth(true)} />
      <Hero onGetStarted={() => setShowAuth(true)} />
      <TrustStrip />
      <Features />
      <ExploreSubjects />
      <WhySection />
      <HowItWorks />
      <SuccessShowcase onGetStarted={() => setShowAuth(true)} />
      <Pricing onSelect={() => setShowAuth(true)} />
      <FinalCTA onGetStarted={() => setShowAuth(true)} />
      <PublicFooter />
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
    </div>
  );
}
