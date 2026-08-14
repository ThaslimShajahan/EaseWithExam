import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Brain, FileText, Target, Zap, BarChart3, Sparkles, Headphones,
  Check, ArrowRight, ArrowUpRight, Crown, UserPlus, ListChecks, Bot,
  ImageIcon, Compass, ClipboardCheck, MessageCircleQuestion, Search,
  Plus, Minus,
} from 'lucide-react';
import AuthModal from '../components/auth/AuthModal';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';
import { PLANS, computeGst, formatRupees } from '../lib/subscription';
import {
  SUPPORTED_SYLLABI, PRODUCT_FACTS, VALUE_CARDS, DIFFERENTIATORS, FAQ_GROUPS,
} from '../lib/landingContent';
import { useSeo } from '../lib/seo';
import StructuredData from '../components/seo/StructuredData';
import { usePlatformSettings } from '../hooks/usePlatformSettings';

/**
 * Public landing page, laid out from the supplied reference designs.
 *
 * Two rules run through the whole file:
 *
 * 1. FLAT COLOUR, NO GRADIENTS. The reference is orange; this uses the brand
 *    green (primary-600 action, primary-700 hover, primary-50 tint). Every
 *    gradient the previous version carried — the placeholder fill, the hero
 *    backdrop blobs, the highlighted plan card and the closing banner — is now
 *    a flat fill.
 *
 * 2. NOTHING INVENTED. The reference leans on review counts, partner logos,
 *    testimonials and learner totals. EWE has almost no users, so those
 *    sections keep their layout but are filled from src/lib/landingContent.js
 *    with facts that are actually checkable against the product.
 */

/* Drop a real file into public/landing/ with the matching name (see
   public/landing/README.txt) and it replaces the placeholder automatically. */
function ImgOrPlaceholder({ src, alt, className = '', label, placeholderClassName = '' }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-primary-50 border-2 border-dashed border-primary-200 text-primary-400 ${className} ${placeholderClassName}`}>
        <ImageIcon size={26} />
        {label && <span className="text-[11px] font-semibold text-primary-500 text-center px-3">{label}</span>}
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} />;
}

const ICONS = { Compass, ClipboardCheck, MessageCircleQuestion, Search };

const FEATURES = [
  { icon: Brain,      title: 'Ask EWE — AI Tutor',      desc: 'A tutor that guides you to the answer with questions of its own, instead of just handing it over.' },
  { icon: FileText,   title: 'AI Practice Questions',   desc: 'Unlimited subject-wise questions at your chosen difficulty, each with a full worked solution.' },
  { icon: Target,     title: 'Full-Length Mock Tests',  desc: 'Real NEET / JEE / board patterns, real marking schemes, timed sessions with analysis after.' },
  { icon: Zap,        title: 'Adaptive Study Plan',     desc: 'A week-by-week plan built around your exam date and weak areas, adjusting as you improve.' },
  { icon: BarChart3,  title: 'Deep Analytics',          desc: 'Score trends, subject accuracy and a weak-chapter heatmap, so you know what to study next.' },
  { icon: Sparkles,   title: 'AI Summarizer',           desc: 'Paste notes, an article or a lecture PDF — get the key points in seconds.' },
  { icon: Headphones, title: 'Podcast Generator',       desc: 'Turn your notes into a short audio lesson you can listen to on the go.' },
];

const STEPS = [
  { icon: UserPlus,   title: 'Create your account',      desc: 'Sign up with Google or your phone number. No card, no trial countdown.', img: '/landing/step-1.png' },
  { icon: ListChecks, title: 'Tell us your exam',        desc: 'Pick your class, board and target exam — EWE builds the study plan around it.', img: '/landing/step-2.png' },
  { icon: Bot,        title: 'Practise with AI, daily',  desc: 'Generate papers, ask doubts, sit mock tests, and get instant detailed feedback.', img: '/landing/step-3.png' },
];

const DISPLAY_PLANS = ['free', 'premium_monthly', 'premium_yearly', 'neet_complete'];

/* ── Section heading ─────────────────────────────────────────── */
function SectionHead({ title, sub, className = '' }) {
  return (
    <div className={`text-center max-w-2xl mx-auto ${className}`}>
      <h2 className="text-3xl sm:text-[2.6rem] leading-tight font-extrabold text-slate-900 tracking-tight">{title}</h2>
      {sub && <p className="text-slate-500 mt-3 text-[15px] leading-relaxed">{sub}</p>}
    </div>
  );
}

/* ── 1. Hero ─────────────────────────────────────────────────── */
function Hero({ onGetStarted }) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-16 lg:pt-20 lg:pb-24">
      <div className="grid lg:grid-cols-2 gap-12 lg:gap-10 items-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <a href="#features" className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full pl-1.5 pr-3.5 py-1.5 hover:border-primary-200 transition-colors">
            <span className="bg-primary-50 text-primary-700 text-[11px] font-bold px-2.5 py-1 rounded-full">New</span>
            <span className="text-[13px] font-medium text-slate-700">Diagrams in every generated paper</span>
            <ArrowRight size={13} className="text-slate-400" />
          </a>

          {/* The H1 carries the terms people actually search. The previous
              "Crack Your Exam With an AI Tutor" named none of them — no exam,
              no board, no country — so the single strongest on-page signal was
              spent on a phrase nobody types. Board coverage is stated exactly
              as SUPPORTED_SYLLABI defines it: CBSE and Kerala State, not "all
              state boards". */}
          <h1 className="mt-7 text-[2.75rem] sm:text-6xl font-extrabold text-slate-900 leading-[1.05] tracking-tight">
            NEET, JEE &amp; CBSE Prep
            {/* The space is load-bearing. The span is display:block so it reads
                as a line break visually either way, but textContent — which is
                what text extractors concatenate — would otherwise yield
                "PrepWith an AI Tutor" and lose "Prep" as a matchable token. */}
            {' '}
            <span className="block">With an AI Tutor</span>
          </h1>

          <p className="mt-5 text-slate-500 text-[15px] sm:text-base leading-relaxed max-w-md">
            Exam preparation for Indian students across CBSE, Kerala State board,
            NEET and JEE. Real exam-pattern papers, a tutor that explains instead
            of just answering, and a study plan that adapts to the chapters you
            keep getting wrong.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button onClick={onGetStarted}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold transition-colors">
              Get Started <ArrowUpRight size={16} />
            </button>
            <a href="#how-it-works"
              className="inline-flex items-center px-6 py-3.5 rounded-2xl border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 transition-colors">
              See how it works
            </a>
          </div>

          {/* The reference puts a "4.9 stars, 10k+ reviews" cluster here. EWE
              has no reviews yet, so this states what the free plan gives —
              true today, and a better reason to click than a fake rating. */}
          <p className="mt-6 text-[13px] text-slate-500">
            Free to start · no card required
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, delay: 0.1 }}>
          <ImgOrPlaceholder
            src="/landing/hero-collage.png"
            alt="EaseWithExam product screens"
            label="hero-collage.png — dashboard / paper / quiz screens"
            className="w-full rounded-3xl object-contain"
            placeholderClassName="h-[340px] sm:h-[420px] rounded-3xl"
          />
        </motion.div>
      </div>
    </section>
  );
}

/* ── 2. Supported syllabi (replaces the "trusted by" logo row) ── */
function SyllabusStrip() {
  // Grey bold words in a row read as unstyled text, because the thing they
  // replaced — a row of recognisable company logos — carried its own shape.
  // Plain names need a container to look deliberate, so each sits in a white
  // pill on the tinted band with a check to signal "supported", not "partner".
  return (
    <section className="border-y border-slate-100 bg-slate-50/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 mb-6">
          Built for the boards and exams you actually sit
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {SUPPORTED_SYLLABI.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full pl-3 pr-4 py-2 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <Check size={13} className="text-primary-600 shrink-0" />
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 3. Split showcase + 2x2 value grid ──────────────────────── */
function Showcase() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <SectionHead
        title="Study like the exam is the point"
        sub="Everything here exists to move one number: what you score on the day."
      />
      <div className="mt-12 bg-slate-50/70 rounded-[2rem] p-4 sm:p-6 lg:p-8">
        <div className="grid lg:grid-cols-2 gap-6">
          <ImgOrPlaceholder
            src="/landing/showcase.png"
            alt="EaseWithExam dashboard"
            label="showcase.png — dashboard screenshot"
            className="w-full h-full rounded-2xl object-cover"
            placeholderClassName="min-h-[320px] rounded-2xl"
          />
          <div className="grid sm:grid-cols-2 gap-4">
            {VALUE_CARDS.map(({ icon, title, desc }) => {
              const Icon = ICONS[icon] ?? Compass;
              return (
                <div key={title} className="bg-white border border-slate-100 rounded-2xl p-6">
                  <div className="h-11 w-11 rounded-xl bg-primary-50 flex items-center justify-center mb-4">
                    <Icon size={19} className="text-primary-600" />
                  </div>
                  <h3 className="font-bold text-slate-900 mb-1.5">{title}</h3>
                  <p className="text-[13px] text-slate-500 leading-relaxed">{desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 4. Feature bento grid ───────────────────────────────────── */
function Features() {
  const [lead, ...rest] = FEATURES;
  const LeadIcon = lead.icon;
  return (
    <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <SectionHead
        title="Seven tools, one place"
        sub="Practice, tutoring, testing and tracking — without stitching five apps together."
      />
      <div className="mt-12 grid md:grid-cols-3 gap-5">
        {/* Lead card spans two columns, mirroring the reference's bento rhythm. */}
        <div className="md:col-span-2 bg-primary-50 border border-primary-100 rounded-3xl p-7 sm:p-9 flex flex-col justify-between min-h-[260px]">
          <div>
            <div className="h-12 w-12 rounded-2xl bg-white flex items-center justify-center mb-5">
              <LeadIcon size={22} className="text-primary-600" />
            </div>
            <h3 className="text-2xl font-extrabold text-slate-900 mb-2">{lead.title}</h3>
            <p className="text-slate-600 leading-relaxed max-w-md">{lead.desc}</p>
          </div>
          <ImgOrPlaceholder
            src="/landing/feature-tutor.png"
            alt="Ask EWE chat"
            label="feature-tutor.png"
            className="mt-6 w-full max-h-40 object-contain rounded-xl"
            placeholderClassName="mt-6 h-32 rounded-xl"
          />
        </div>

        {rest.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-white border border-slate-100 rounded-3xl p-7 hover:border-primary-200 transition-colors">
            <div className="h-11 w-11 rounded-xl bg-primary-50 flex items-center justify-center mb-4">
              <Icon size={19} className="text-primary-600" />
            </div>
            <h3 className="font-bold text-slate-900 mb-1.5">{title}</h3>
            <p className="text-[13px] text-slate-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 5. How it works — light stepped cards ───────────────────── */
function HowItWorks({ onGetStarted }) {
  return (
    <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <SectionHead
        title="Up and running in three steps"
        sub="No setup, no onboarding call. Pick your exam and start practising."
      />
      <div className="mt-12 grid md:grid-cols-3 gap-6">
        {STEPS.map(({ icon: Icon, title, desc, img }, i) => (
          <div key={title} className="bg-white border border-slate-100 rounded-3xl p-6 flex flex-col">
            <ImgOrPlaceholder
              src={img}
              alt={title}
              label={img.split('/').pop()}
              className="w-full rounded-2xl object-cover mb-6"
              placeholderClassName="h-40 rounded-2xl mb-6"
            />
            <span className="inline-flex self-start items-center gap-1.5 bg-primary-50 text-primary-700 text-[11px] font-bold px-3 py-1 rounded-full mb-3">
              <Icon size={11} /> Step {i + 1}
            </span>
            <h3 className="font-bold text-slate-900 text-lg mb-1.5">{title}</h3>
            <p className="text-[13px] text-slate-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 text-center">
        <button onClick={onGetStarted}
          className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold transition-colors">
          Get Started <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}

/* ── 6. Product facts band (replaces the invented stats band) ── */
function FactsBand() {
  return (
    <section className="bg-primary-600">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {PRODUCT_FACTS.map(({ stat, label, desc }) => (
          <div key={label}>
            <p className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">{stat}</p>
            <p className="text-primary-100 font-semibold text-sm mt-1">{label}</p>
            <p className="text-primary-100/80 text-[13px] leading-relaxed mt-2">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 7. How EWE is different (replaces testimonials) ─────────── */
function Different() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <SectionHead
        title="What makes it different"
        sub="Four things EWE does that a generic AI chat window does not."
      />
      <div className="mt-12 grid sm:grid-cols-2 gap-5">
        {DIFFERENTIATORS.map(({ title, body }) => (
          <div key={title} className="bg-white border border-slate-100 rounded-3xl p-7">
            <div className="h-8 w-8 rounded-lg bg-primary-50 flex items-center justify-center mb-4">
              <Check size={16} className="text-primary-600" />
            </div>
            <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
            <p className="text-[14px] text-slate-500 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 8. Pricing — real plans, real rupees ────────────────────── */
function PlanCard({ plan, highlight, onSelect, taxRatePercent }) {
  return (
    <div className={[
      'relative rounded-3xl p-7 border flex flex-col',
      highlight ? 'border-primary-600 bg-white shadow-lg shadow-primary-100' : 'border-slate-100 bg-white',
    ].join(' ')}>
      {plan.badge && (
        <span className="absolute -top-3 left-7 bg-primary-600 text-white text-[11px] font-bold px-3 py-1 rounded-full">
          {plan.badge}
        </span>
      )}
      <h3 className="font-bold text-slate-900">{plan.name}</h3>
      <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed min-h-[40px]">{plan.description}</p>

      <div className="mt-5 mb-6">
        <span className="text-3xl font-extrabold text-slate-900">{plan.priceLabel}</span>
        {plan.priceSuffix && <span className="text-xs text-slate-400 ml-1">{plan.priceSuffix}</span>}
        {/* Same GST-inclusive line as PricingPage/PaywallModal — 2026-08-14,
            display-only, the real charge is create-razorpay-order's own
            computation. */}
        {plan.razorpayAmount > 0 && computeGst(plan.razorpayAmount, taxRatePercent).hasTax && (
          <p className="text-[11px] text-slate-400 mt-0.5">
            + {computeGst(plan.razorpayAmount, taxRatePercent).ratePercent}% GST = {formatRupees(computeGst(plan.razorpayAmount, taxRatePercent).totalPaise)}
            {plan.priceLabel.includes('/') ? `/${plan.priceLabel.split('/')[1]}` : ''}
          </p>
        )}
      </div>

      <button
        onClick={onSelect}
        className={[
          'w-full py-3 rounded-xl font-semibold text-sm transition-colors',
          highlight
            ? 'bg-primary-600 hover:bg-primary-700 text-white'
            : 'bg-primary-50 hover:bg-primary-100 text-primary-700',
        ].join(' ')}
      >
        Get started
      </button>

      <ul className="mt-6 space-y-2.5">
        {plan.features.slice(0, 6).map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13px] text-slate-600">
            <Check size={14} className="text-primary-600 shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pricing({ onSelect }) {
  const { tax_rate_percent: taxRatePercent } = usePlatformSettings();
  return (
    <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <SectionHead
        title="Choose your plan"
        sub="Start free and stay free if it suits you — the limits reset daily rather than expiring."
      />
      <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {DISPLAY_PLANS.map((id) => {
          const plan = PLANS[id];
          if (!plan) return null;
          return (
            <PlanCard key={id} plan={plan} highlight={id === 'premium_yearly'} onSelect={onSelect} taxRatePercent={taxRatePercent} />
          );
        })}
      </div>
      {/* No GST wording: Razorpay is charged exactly the listed amount, with
          nothing added, so "exclusive of GST" told students a price that was
          never charged. The tax treatment is unresolved — see ACTION_ITEMS —
          and until it is, the honest copy is the number actually taken. */}
      <p className="text-center text-xs text-slate-400 mt-6">Prices in INR. Cancel any time.</p>
    </section>
  );
}

/* ── 9. FAQ — category rail + accordion ──────────────────────── */
function FAQ() {
  const [group, setGroup] = useState(0);
  const [open, setOpen] = useState(0);
  const active = FAQ_GROUPS[group];

  return (
    <section id="faq" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <SectionHead title="Frequently asked questions" sub="Everything worth knowing before you start." />

      <div className="mt-12 grid md:grid-cols-[200px_1fr] gap-8 lg:gap-12">
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:border-l md:border-slate-100">
          {FAQ_GROUPS.map((g, i) => (
            <button
              key={g.category}
              onClick={() => { setGroup(i); setOpen(0); }}
              className={[
                'text-left text-[13px] font-medium px-4 py-2.5 whitespace-nowrap transition-colors md:-ml-px md:border-l-2 rounded-lg md:rounded-none',
                i === group
                  ? 'text-primary-700 md:border-primary-600 bg-primary-50 md:bg-transparent'
                  : 'text-slate-500 md:border-transparent hover:text-slate-800',
              ].join(' ')}
            >
              {g.category}
            </button>
          ))}
        </div>

        <div>
          <h3 className="text-xl font-bold text-slate-900 mb-5">{active.category}</h3>
          <div className="space-y-3">
            {active.items.map((item, i) => {
              const isOpen = open === i;
              return (
                <div key={item.q} className="bg-slate-50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    className="w-full flex items-center justify-between gap-4 text-left px-5 py-4"
                  >
                    <span className="font-semibold text-slate-900 text-[15px]">{item.q}</span>
                    {isOpen
                      ? <Minus size={16} className="text-slate-400 shrink-0" />
                      : <Plus size={16} className="text-slate-400 shrink-0" />}
                  </button>
                  {isOpen && (
                    <p className="px-5 pb-4 -mt-1 text-[13px] text-slate-500 leading-relaxed">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 9b. Campaign section — hidden unless a campaign is actually running ──
 *
 * Deliberately NOT derived from quota_overrides (the per-student grant
 * mechanism) even though that has its own "active" state. An admin granting
 * one student bonus quota for an unrelated support reason would otherwise
 * flip on a PUBLIC marketing section for every visitor — two different
 * concepts (an individual grant vs. a public campaign) sharing one signal.
 * A dedicated toggle keeps them independent, same platform_settings pattern
 * as everything else in Admin > Platform > Settings.
 */
function CampaignSection() {
  const {
    landing_campaign_enabled, landing_campaign_form_url, landing_campaign_label,
    landing_campaign_image_url, landing_campaign_description, loaded,
  } = usePlatformSettings();
  const [imageBroken, setImageBroken] = useState(false);
  if (!loaded || landing_campaign_enabled !== 'true' || !landing_campaign_form_url) return null;

  // 2026-08-15 redesign: was a centered single column; now splits into image
  // + text when an image is set. hasImage also requires the <img> to have
  // actually loaded — a broken URL (deleted asset, typo) falls back to the
  // full-width text layout below rather than showing an empty/broken box.
  const hasImage = !!landing_campaign_image_url && !imageBroken;

  // Text-first in DOM (badge/heading/description/CTA), image second — matches
  // this page's own Hero section (grid lg:grid-cols-2, copy in the first
  // column, visual in the second) so a returning visitor sees the same
  // reading order twice, and on mobile the actionable content (what this is,
  // how to join) appears before a decorative image rather than after it.
  return (
    <section className="px-4 sm:px-6 py-8">
      {/* items-center on the grid already vertically centers the (shorter)
          text column against the image column's height. The bug fixed here
          (2026-08-15) was horizontal only: hasImage dropped text-center
          entirely, and the description's max-w-sm had no mx-auto to center
          itself within a centered parent — both made the text column read
          as left-aligned once an image existed. */}
      <div className={`max-w-4xl mx-auto bg-gradient-to-br from-primary-600 to-primary-700 rounded-[2rem] overflow-hidden ${hasImage ? 'grid lg:grid-cols-2 items-center' : ''}`}>
        <div className={`p-6 sm:p-10 text-center ${hasImage ? 'lg:py-10' : ''}`}>
          <span className="inline-flex items-center gap-1.5 bg-white/15 text-white text-[11px] font-bold px-3 py-1 rounded-full mb-4">
            <Sparkles size={11} /> Limited time
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {landing_campaign_label || 'Special campaign'}
          </h2>
          <p className={`text-primary-100 mt-2 text-sm mx-auto ${hasImage ? 'max-w-sm' : 'max-w-md'} whitespace-pre-line`}>
            {landing_campaign_description || 'Fill in the form below to take part.'}
          </p>
          <a href={landing_campaign_form_url} target="_blank" rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white text-primary-700 font-bold hover:bg-slate-100 transition-colors">
            Join now <ArrowUpRight size={16} />
          </a>
        </div>
        {hasImage && (
          // object-contain, not cover — 2026-08-15. Uploaded campaign images
          // are promotional flyers with their own embedded text/branding
          // (real one tested: 2752x1536, ~1.8:1), and this box's ratio never
          // matches that closely at any width (~1.5:1 on mobile, ~1.4:1 at
          // lg+) — cover was cropping the sides enough to cut real content
          // ("EARLY BIRD OFFER" losing its "EA"). contain always shows the
          // whole image; any letterbox gap shows the card's own gradient
          // behind it rather than a hard edge, so it reads as intentional.
          <div className="h-56 lg:h-full lg:min-h-[320px] flex items-center justify-center">
            <img
              src={landing_campaign_image_url}
              alt={landing_campaign_label || 'Campaign'}
              onError={() => setImageBroken(true)}
              className="w-full h-full object-contain"
            />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── 10. Dark closing band ───────────────────────────────────── */
function ClosingBand({ onGetStarted }) {
  return (
    <section className="px-4 sm:px-6 pb-16 sm:pb-24">
      <div className="max-w-6xl mx-auto bg-slate-900 rounded-[2rem] px-6 py-16 sm:py-20 text-center">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight tracking-tight">
          From zero to exam-ready
          <span className="block text-primary-400">in three steps</span>
        </h2>
        <p className="text-slate-400 mt-4 text-[15px] max-w-md mx-auto">
          No complicated setup. Pick your exam, generate a paper, and start.
        </p>

        <div className="mt-12 grid md:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
          {STEPS.map(({ title, desc }, i) => (
            <div key={title} className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <span className="text-primary-400 font-extrabold text-sm">0{i + 1}</span>
              <h3 className="text-white font-bold mt-3 mb-1.5">{title}</h3>
              <p className="text-slate-400 text-[13px] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <button onClick={onGetStarted}
          className="mt-12 inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors">
          Get Started <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}

export default function LandingPage() {
  useSeo('/');
  const [showAuth, setShowAuth] = useState(false);
  const open = () => setShowAuth(true);

  return (
    <div className="min-h-screen bg-white">
      <StructuredData />
      <PublicNavBar onSignIn={open} />
      <Hero onGetStarted={open} />
      <SyllabusStrip />
      <Showcase />
      <Features />
      <HowItWorks onGetStarted={open} />
      <FactsBand />
      <Different />
      <Pricing onSelect={open} />
      <CampaignSection />
      <FAQ />
      <ClosingBand onGetStarted={open} />
      <PublicFooter />
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
    </div>
  );
}
