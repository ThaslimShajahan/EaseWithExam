/**
 * Answer-quality benchmark — generates real questions through the real
 * pipeline, records what each validation layer flagged, and dumps everything
 * for hand-adjudication.
 *
 *   npm run dev
 *   BASE_URL=http://localhost:5173 node scripts/benchmark-answer-quality.mjs
 *   ... --set=mcq        (default: 15 Class 10 Maths + 15 Class 11 Physics)
 *   ... --set=numerical  (30 Numerical-type questions)
 *   ... --reset
 *
 * WHY A SCRIPT AND NOT AN AD-HOC RUN
 * The previous two measurements were ad-hoc, so "the same benchmark" could not
 * actually be re-run — only re-approximated. This fixes the configuration in
 * code so before/after numbers compare like with like.
 *
 * WHAT IT DOES NOT DO
 * It does not decide whether an answer is CORRECT. That is the hand-verification
 * step and it stays human: the whole point of this exercise is that the model is
 * wrong ~10% of the time, so asking a model to grade itself would launder the
 * error rate rather than measure it. This script records questions, keys,
 * explanations and flags; correctness is adjudicated afterwards and merged in.
 *
 * CHECKPOINTED — each batch is written to disk as soon as it returns, so an
 * interrupted run resumes instead of re-spending the generation.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUTDIR = resolve(ROOT, '.benchmark');
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const SET = arg('set', 'mcq');
const RESET = process.argv.includes('--reset');

const SETS = {
  // The original benchmark: 15 Class 10 Mathematics + 15 Class 11 Physics.
  mcq: [
    { id: 'c10-maths',   subject: 'Mathematics', examType: 'CBSE Class 10', count: 15, qTypes: ['MCQ'] },
    { id: 'c11-physics', subject: 'Physics',     examType: 'CBSE Class 11', count: 15, qTypes: ['MCQ'] },
  ],
  // Numericals have never been measured. The MCQ run produced 28 MCQ + 2
  // Assertion-Reason and zero Numericals, so the one category with no
  // structural filter at all was never exercised.
  numerical: [
    { id: 'num-c11-physics', subject: 'Physics',   examType: 'CBSE Class 11', count: 15, qTypes: ['Numerical'] },
    { id: 'num-c10-maths',   subject: 'Mathematics', examType: 'CBSE Class 10', count: 15, qTypes: ['Numerical'] },
  ],
};

const jobs = SETS[SET];
if (!jobs) { console.error(`unknown --set=${SET} (expected: ${Object.keys(SETS).join(', ')})`); process.exit(1); }

if (!existsSync(OUTDIR)) mkdirSync(OUTDIR, { recursive: true });
const OUT = resolve(OUTDIR, `${SET}.json`);
const state = (!RESET && existsSync(OUT)) ? JSON.parse(readFileSync(OUT, 'utf8')) : { set: SET, batches: {} };
const save = () => writeFileSync(OUT, JSON.stringify(state, null, 2));

{
  const probe = `${BASE}/src/lib/questionGen.js`;
  const res = await fetch(probe).catch((e) => ({ ok: false, status: e.code ?? 'unreachable' }));
  if (!res.ok) { console.error(`\nDev server not serving modules at ${probe} (${res.status}). Start \`npm run dev\`.\n`); process.exit(1); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(`   [browser] ${m.text().slice(0, 160)}`); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

for (const job of jobs) {
  if (state.batches[job.id]) { console.log(`[skip] ${job.id} — already captured (${state.batches[job.id].questions.length} questions)`); continue; }
  console.log(`\n[gen] ${job.id}: ${job.count} x ${job.qTypes.join('/')} — ${job.examType} ${job.subject}`);
  const t0 = Date.now();

  const out = await page.evaluate(async (j) => {
    const [{ generateQuestionPaper, toEngineFormat }, { verifyQuestions }] = await Promise.all([
      import('/src/lib/questionGen.js'),
      import('/src/lib/answerVerification.js'),
    ]);

    const raw = await generateQuestionPaper({
      subject: j.subject, topics: '', examType: j.examType,
      difficulty: 'medium', count: j.count, qTypes: j.qTypes,
      rotationSlot: Math.floor(Math.random() * 5),
    });

    // Engine format applies the FREE cross-check and the hard drop for an
    // unparseable key. Captured before verification so each layer's
    // contribution can be separated afterwards.
    const engine = toEngineFormat(raw, j.subject, j.examType);
    const preFlags = engine.map((q) => ({ needs_review: !!q.needs_review, review_reason: q.review_reason ?? null }));

    const { questions: verified, stats } = await verifyQuestions(engine);

    return {
      stats,
      generatedCount: (raw?.questions ?? raw ?? []).length,
      engineCount: engine.length,
      questions: verified.map((q, i) => ({
        idx: i,
        type: q.type,
        question: q.question,
        options: q.options ?? null,
        correctOption: q.correctOption ?? null,
        correctAnswer: q.correctAnswer ?? null,
        explanation: q.explanation ?? '',
        // Layer attribution: what the free check said BEFORE the verifier ran.
        crossCheckFlagged: preFlags[i]?.needs_review ?? false,
        crossCheckReason: preFlags[i]?.review_reason ?? null,
        // Final state after verification.
        finalFlagged: !!q.needs_review,
        finalReason: q.review_reason ?? null,
        verifierAnswer: q.verifier_answer ?? null,
      })),
    };
  }, job);

  out.seconds = Math.round((Date.now() - t0) / 1000);
  out.job = job;
  state.batches[job.id] = out;
  save();

  const verifierOnly = out.questions.filter((q) => q.finalFlagged && !q.crossCheckFlagged).length;
  console.log(`   generated=${out.generatedCount} engine=${out.engineCount} in ${out.seconds}s`);
  console.log(`   crossCheck flagged=${out.questions.filter((q) => q.crossCheckFlagged).length}  verifier added=${verifierOnly}  final flagged=${out.questions.filter((q) => q.finalFlagged).length}`);
  console.log(`   verifier stats: ${JSON.stringify(out.stats)}`);
}

await browser.close();

const all = Object.values(state.batches).flatMap((b) => b.questions);
console.log(`\n─── captured ${all.length} questions -> ${OUT}`);
console.log(`   cross-check flagged : ${all.filter((q) => q.crossCheckFlagged).length}`);
console.log(`   verifier added      : ${all.filter((q) => q.finalFlagged && !q.crossCheckFlagged).length}`);
console.log(`   would be SERVED     : ${all.filter((q) => !q.finalFlagged).length}`);
console.log(`   would be WITHHELD   : ${all.filter((q) => q.finalFlagged).length}`);
console.log(`\nNext: hand-adjudicate correctness, then merge verdicts into ${OUT}.\n`);
