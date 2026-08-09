/**
 * Copy for the public landing page, kept out of the layout so wording can be
 * edited without touching JSX.
 *
 * EVERYTHING HERE MUST BE TRUE. The reference designs this page is modelled on
 * carry heavy social proof — "4.9 stars, 10k+ reviews", a trusted-by logo row,
 * testimonial carousels, "15,000+ learners". EWE has almost no users yet, so
 * those sections keep the visual rhythm but are filled with checkable product
 * facts instead of invented numbers, quotes or partner logos.
 *
 * Free-tier numbers are DERIVED from FREE_LIMITS rather than retyped — see the
 * note on FREE_TIER below.
 */

import { FREE_LIMITS } from './quota';

/* ── What EWE actually supports ───────────────────────────────
   Replaces the reference's "trusted by Google / Udemy / Khan Academy" row.
   These are boards and exams the platform genuinely has content and paper
   patterns for (see PAPER_PATTERNS in questionGen.js and the exam_categories
   catalog), not logos of companies with no relationship to EWE. */
export const SUPPORTED_SYLLABI = [
  'CBSE',
  'Kerala State',
  'NEET UG',
  'JEE Main',
  'JEE Advanced',
];

/* ── Free tier, straight from the enforced limits ─────────────
   The Help page hardcoded "15 AI questions, 20 EWE messages and 3 mock tests
   per day" — every one of those numbers was wrong (real: 20, 15, and 2 mock
   tests PER WEEK, not per day). Wrong on a help page is a stale note; wrong on
   a landing page is a false pricing claim, so these are computed from the same
   constant the quota gate enforces and cannot drift again. */
export const FREE_TIER = {
  aiQuestions:      FREE_LIMITS.ai_questions_used,
  vedaMessages:     FREE_LIMITS.veda_messages_used,
  mockTestsPerWeek: FREE_LIMITS.mock_tests_used,
  paperEvaluations: FREE_LIMITS.paper_evaluations_used,
  fullPapers:       FREE_LIMITS.paper_generations_used,
};

/* ── Product-fact band ────────────────────────────────────────
   Replaces the reference's "15.000+ / 500+ / 24/7 / 95%" stats band. Same
   four-up rhythm, but every figure is verifiable from the product itself. */
export const PRODUCT_FACTS = [
  {
    stat: '6',
    label: 'subjects covered',
    desc: 'Physics, Chemistry, Biology, Maths, English and Social Studies across Classes 8–12.',
  },
  {
    stat: '5',
    label: 'exam patterns built in',
    desc: 'NEET, JEE Main, JEE Advanced and the CBSE / state board blueprints, with real marking schemes.',
  },
  {
    stat: '24×7',
    label: 'AI tutor on call',
    desc: 'Ask a doubt at 2am and get a worked explanation, not a queue ticket.',
  },
  {
    stat: `${FREE_TIER.aiQuestions}`,
    label: 'free AI questions a day',
    desc: `Plus ${FREE_TIER.vedaMessages} tutor messages and ${FREE_TIER.mockTestsPerWeek} mock tests a week — no card needed.`,
  },
];

/* ── Split showcase — the 2x2 value grid ─────────────────────── */
export const VALUE_CARDS = [
  {
    icon: 'Compass',
    title: 'It adapts to you',
    desc: 'Your study plan is rebuilt around your exam date and the chapters you keep getting wrong — not a fixed syllabus everyone gets.',
  },
  {
    icon: 'ClipboardCheck',
    title: 'It matches the real exam',
    desc: 'Papers follow the actual NEET / JEE / board blueprint: section counts, marks per question and negative marking included.',
  },
  {
    icon: 'MessageCircleQuestion',
    title: 'It teaches, not just answers',
    desc: 'Ask EWE walks you toward the answer with questions of its own, so you can solve the next one without it.',
  },
  {
    icon: 'Search',
    title: 'It is honest about gaps',
    desc: 'Weak chapters and repeated mistakes are surfaced plainly, with the misconception behind them named.',
  },
];

/* ── "How EWE is different" ───────────────────────────────────
   Replaces the reference's two testimonial carousels. Same card rhythm; real
   product differentiators rather than quotes from students who don't exist. */
export const DIFFERENTIATORS = [
  {
    title: 'A tutor that makes you think',
    body: 'Most AI tools hand over the answer. Ask EWE asks what you have tried, points at the step that broke, and lets you finish it yourself.',
  },
  {
    title: 'Papers with the figures included',
    body: 'Ray diagrams, circuits, chemical structures and geometry are generated with each paper — chemistry structures come from a real cheminformatics renderer, not a sketch.',
  },
  {
    title: 'Revision timed by forgetting',
    body: 'Flashcards use SM-2 — the same spacing algorithm as Anki — so cards you keep missing come back sooner and ones you know stop wasting your time.',
  },
  {
    title: 'Mistakes tracked by cause',
    body: 'The misconception engine groups repeated wrong answers by the idea you actually misunderstood, so you fix the concept instead of memorising one question.',
  },
];

/* ── FAQ ──────────────────────────────────────────────────────
   Grouped for the reference's category-rail layout. Shared with HelpPage.jsx
   so the two can never disagree. */
export const FAQ_GROUPS = [
  {
    category: 'Getting started',
    items: [
      {
        q: 'What do I need to sign up?',
        a: 'A Google account or a phone number — that is it. No card is asked for at any point on the free plan.',
      },
      {
        q: 'Which classes and boards are covered?',
        a: 'Classes 8 to 12 on CBSE and Kerala State, plus NEET, JEE Main and JEE Advanced preparation. You pick your class and board at signup, and competitive exams are offered from Class 11 upward.',
      },
      {
        q: 'What happens if I miss a day?',
        a: 'Your streak resets to zero, but your XP, level and every bit of history stay exactly as they were. Streaks roll over at midnight IST.',
      },
    ],
  },
  {
    category: 'AI tools',
    items: [
      {
        q: 'How are practice questions generated?',
        a: 'Each paper follows the real blueprint for your exam and is grounded in the uploaded syllabus and previous-year questions for that chapter, so the style matches what you will actually sit.',
      },
      {
        q: 'Do questions include diagrams?',
        a: 'Yes. Figures are generated alongside the questions that need them — ray diagrams, circuits, graphs and labelled biology schematics, with chemical structures drawn by a dedicated chemistry renderer.',
      },
      {
        q: 'How does spaced repetition work in flashcards?',
        a: 'Cards you know well appear less often; cards you struggle with come back sooner. EWE uses the SM-2 algorithm, the same one behind Anki, to get the most retention from the least study time.',
      },
    ],
  },
  {
    category: 'Plans & billing',
    items: [
      {
        q: 'How does the daily quota work?',
        // Numbers interpolated from FREE_LIMITS — see FREE_TIER above.
        a: `Free accounts get ${FREE_TIER.aiQuestions} AI questions, ${FREE_TIER.vedaMessages} tutor messages, ${FREE_TIER.fullPapers} full papers and ${FREE_TIER.paperEvaluations} paper evaluations a day, plus ${FREE_TIER.mockTestsPerWeek} mock tests a week. Premium removes every limit. Usage resets at midnight IST.`,
      },
      {
        q: 'Can I try it before paying?',
        a: 'Yes — the free plan is not a trial that expires. It has daily limits rather than a countdown, so you can keep using it indefinitely.',
      },
      {
        q: 'What do the paid plans add?',
        a: 'Unlimited questions, tutor messages and mock tests, the score predictor, deep chapter notes and progress certificates. The yearly and three-year plans are the same features for a longer term at a lower monthly cost.',
      },
    ],
  },
  {
    category: 'Progress & analytics',
    items: [
      {
        q: 'How do I track my weak topics?',
        a: 'Every answer is logged. Any topic where your accuracy falls below 60% is flagged, and shows up in the Weak Topics widget on your dashboard and in Analytics.',
      },
      {
        q: 'How is my score predicted?',
        a: 'The score predictor uses your accuracy history, your weak-topic list and the days left before your exam to estimate a likely band. It sharpens as you sit more tests.',
      },
      {
        q: 'Can my parents follow my progress?',
        a: 'Yes — share the Parent Link from your profile. Parents see your streak, recent scores and weekly progress without needing an account. Your individual answers and notes stay private.',
      },
    ],
  },
];

/* Flat list for HelpPage's existing searchable FAQ, so both surfaces read from
   this one source instead of keeping separate copies that drift apart. */
export const FAQ_FLAT = FAQ_GROUPS.flatMap((g) =>
  g.items.map((item) => ({ ...item, tag: g.category })),
);
