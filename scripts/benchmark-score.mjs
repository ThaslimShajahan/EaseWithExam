/**
 * Scores an adjudicated benchmark file.
 *
 *   node scripts/benchmark-score.mjs --set=mcq
 *
 * Computes the number that actually matters — the SERVED-WRONG RATE, i.e. of
 * the questions a student would actually receive, how many carry a wrong key —
 * under each validation regime, from one sample so the comparison is like with
 * like:
 *
 *   none        every generated question is served (pre-session-17 behaviour)
 *   cross-check only the free key-vs-explanation check withholds
 *   both        cross-check + semantic verification (what ships now)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const SET = arg('set', 'mcq');
const TYPE = arg('type', null);   // e.g. --type=Numerical to score one type
const FILE = resolve(ROOT, '.benchmark', `${SET}.json`);
if (!existsSync(FILE)) { console.error(`no benchmark file at ${FILE}`); process.exit(1); }

const s = JSON.parse(readFileSync(FILE, 'utf8'));
let all = Object.entries(s.batches).flatMap(([bid, b]) =>
  b.questions.map((q) => ({ ...q, batch: bid, label: `${bid}:${q.idx}` })));

// A batch requested as one type can come back mixed, so scoring a specific
// type has to filter rather than assume.
if (TYPE) all = all.filter((q) => q.type === TYPE);
if (!all.length) { console.error(`no questions of type ${TYPE}`); process.exit(1); }

const unjudged = all.filter((q) => typeof q.handVerifiedCorrect !== 'boolean');
if (unjudged.length) {
  console.error(`${unjudged.length} question(s) not yet hand-adjudicated: ${unjudged.map((q) => q.label).join(', ')}`);
  process.exit(1);
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
const wrong = all.filter((q) => !q.handVerifiedCorrect);

// Regimes differ only in which questions are WITHHELD.
const regimes = {
  'none (pre-session-17)': () => false,
  'cross-check only':      (q) => q.crossCheckFlagged,
  'both (ships now)':      (q) => q.finalFlagged,
};

console.log(`\n═══ ${SET} benchmark — ${all.length} questions, hand-adjudicated ═══\n`);
console.log(`ground truth: ${wrong.length} wrong key(s) = ${pct(wrong.length, all.length)} of everything generated\n`);

console.log('regime'.padEnd(24) + 'served'.padStart(8) + 'withheld'.padStart(10) + 'wrong served'.padStart(14) + 'served-wrong rate'.padStart(20));
for (const [name, withhold] of Object.entries(regimes)) {
  const served = all.filter((q) => !withhold(q));
  const bad = served.filter((q) => !q.handVerifiedCorrect);
  console.log(name.padEnd(24) + String(served.length).padStart(8) + String(all.length - served.length).padStart(10)
    + String(bad.length).padStart(14) + pct(bad.length, served.length).padStart(20));
}

// Precision/recall of the combined filter.
const flagged = all.filter((q) => q.finalFlagged);
const tp = flagged.filter((q) => !q.handVerifiedCorrect);
const fp = flagged.filter((q) => q.handVerifiedCorrect);
console.log(`\ncombined filter: ${flagged.length} withheld — ${tp.length} true positive, ${fp.length} false positive`);
console.log(`  recall    ${pct(tp.length, wrong.length)}  (${tp.length} of ${wrong.length} wrong keys caught)`);
console.log(`  precision ${pct(tp.length, flagged.length)}  (cost: ${fp.length} sound question(s) withheld)`);

// Layer attribution — which check earned its keep.
const byCross = all.filter((q) => q.crossCheckFlagged);
const byVerifier = all.filter((q) => q.finalFlagged && !q.crossCheckFlagged);
console.log(`\nlayer attribution:`);
console.log(`  cross-check flagged ${byCross.length} (${byCross.filter((q) => !q.handVerifiedCorrect).length} true positive)`);
console.log(`  verifier added      ${byVerifier.length} (${byVerifier.filter((q) => !q.handVerifiedCorrect).length} true positive)`);

console.log(`\nwrong keys that got through (the remaining gap):`);
const missed = all.filter((q) => !q.handVerifiedCorrect && !q.finalFlagged);
if (!missed.length) console.log('  none');
missed.forEach((q) => {
  console.log(`  [${q.label}] ${q.question.replace(/\s+/g, ' ').slice(0, 96)}`);
  console.log(`      ${q.handNote}`);
});

console.log(`\ncaught:`);
tp.forEach((q) => {
  console.log(`  [${q.label}] ${q.question.replace(/\s+/g, ' ').slice(0, 96)}`);
  console.log(`      flagged by: ${q.finalReason}`);
});
if (fp.length) {
  console.log(`\nfalse positives (sound questions withheld):`);
  fp.forEach((q) => {
    console.log(`  [${q.label}] ${q.question.replace(/\s+/g, ' ').slice(0, 96)}`);
    console.log(`      ${q.finalReason}`);
  });
}

// Answer-position distribution — a separate defect from correctness.
const mcqs = all.filter((q) => Array.isArray(q.options) && typeof q.correctOption === 'number');
if (mcqs.length) {
  const dist = {};
  mcqs.forEach((q) => { const L = 'ABCDEF'[q.correctOption]; dist[L] = (dist[L] ?? 0) + 1; });
  const line = ['A', 'B', 'C', 'D'].map((L) => `${L}=${dist[L] ?? 0} (${pct(dist[L] ?? 0, mcqs.length)})`).join('  ');
  console.log(`\nanswer position over ${mcqs.length} MCQs: ${line}`);
}
console.log();
