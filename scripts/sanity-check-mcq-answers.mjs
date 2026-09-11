/**
 * Read-only sanity check for stored MCQ questions in pyq_questions.
 *
 * Prompted by a reported content bug: "Which of the following numbers is a
 * perfect square? 64, 50, 72, 81" keyed only A (64) — but 81 (9^2) is ALSO a
 * perfect square, so the question has two valid answers under a single-select
 * format. Neither of the two existing generation-time checks (the free
 * keyContradictsExplanation cross-check, or answerVerification.js's semantic
 * re-solve) would catch this class of bug: both only ask "is the keyed option
 * itself correct," never "is it the ONLY option that's correct." This script
 * is a narrow, illustrative check for a handful of MECHANICALLY VERIFIABLE
 * categories (perfect square/cube, prime, even/odd, multiple of N) — not a
 * general correctness validator, and not a fix. Diagnostic only: makes no
 * writes.
 *
 * 2026-09-11: same category set (plus "multiple of N", added alongside its
 * generation-time sibling `ambiguousOptionsReason` in src/lib/questionGen.js
 * — that function now runs this check automatically on every generated
 * question; this script exists only to sweep what already landed in
 * pyq_questions before that existed) — kept as a standalone Node
 * implementation rather than importing questionGen.js, which pulls in
 * import.meta.env/Supabase/aiProxy and isn't runnable outside Vite.
 *
 *   node scripts/sanity-check-mcq-answers.mjs
 *
 * SCOPE NOTE: only pyq_questions is checked here — it has an open anon-key
 * SELECT policy (`pyq_select`), so this can read it directly. question_history
 * and published_tests are both RPC-only / admin-gated (no direct anon SELECT
 * policy), so a full sweep of those needs either a new admin RPC or the same
 * Firebase-admin-auth bootstrap used in scripts/recompress-figures.mjs — not
 * done here since this is a scoping pass, not the full fix.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

/* ── Mechanically-checkable categories ───────────────────────────────── */

function isPerfectSquare(n) {
  return Number.isInteger(n) && n >= 0 && Number.isInteger(Math.sqrt(n));
}
function isPerfectCube(n) {
  if (!Number.isInteger(n)) return false;
  const r = Math.round(Math.cbrt(n));
  return r * r * r === n;
}
function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}
const isEven = (n) => Number.isInteger(n) && n % 2 === 0;
const isOdd  = (n) => Number.isInteger(n) && Math.abs(n % 2) === 1;

const CATEGORIES = [
  { name: 'perfect square', re: /perfect\s+square/i,        test: isPerfectSquare },
  { name: 'perfect cube',   re: /perfect\s+cube/i,           test: isPerfectCube   },
  { name: 'prime number',   re: /\bprime\s+numbers?\b/i,     test: isPrime         },
  { name: 'even number',    re: /\beven\s+numbers?\b/i,      test: isEven          },
  { name: 'odd number',     re: /\bodd\s+numbers?\b/i,       test: isOdd           },
];

const NEGATION_RE = /\b(not|n't|except|excluding|neither)\b/i;

/** First plain number in a string (no fraction handling needed — these
 *  categories are integer-only by definition). */
function firstNumber(raw) {
  const m = String(raw ?? '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** correct_answer is usually a bare letter ("A", "(A)", "A.") but has been
 *  seen as the full option text too — try both. */
function resolveKeyIndex(correctAnswer, options) {
  const s = String(correctAnswer ?? '').trim();
  const letterMatch = s.match(/^[\s(]*([A-Da-d])[).:\s]/) || s.match(/^([A-Da-d])$/);
  if (letterMatch) return 'ABCD'.indexOf(letterMatch[1].toUpperCase());
  const byText = options.findIndex((o) => String(o).trim().toLowerCase() === s.toLowerCase());
  return byText >= 0 ? byText : null;
}

/* ── Scan ─────────────────────────────────────────────────────────────── */

console.log('Scanning pyq_questions for mechanically-checkable MCQ categories...');

let from = 0;
const step = 1000;
let scanned = 0;
let categoryMatched = 0;
let ambiguous = 0;   // >1 option satisfies the category
let noneValid = 0;   // 0 options satisfy the category
let wrongKey  = 0;   // exactly 1 valid option, but it's not the keyed one
const findings = [];

for (;;) {
  const { data, error } = await supabase
    .from('pyq_questions')
    .select('id, exam_type, subject, chapter, question_text, options, correct_answer, question_type')
    .eq('question_type', 'MCQ')
    .not('options', 'is', null)
    .range(from, from + step - 1);
  if (error) throw new Error(`fetch failed: ${error.message}`);
  if (!data?.length) break;

  for (const row of data) {
    scanned += 1;
    const options = Array.isArray(row.options) ? row.options : [];
    if (options.length < 2) continue;

    const text = row.question_text ?? '';
    const multipleMatch = text.match(/multiples?\s+of\s+(-?\d+)/i);
    const category = multipleMatch
      ? { name: `multiple of ${multipleMatch[1]}`, test: (n) => { const N = Number(multipleMatch[1]); return N !== 0 && Number.isInteger(n) && n % N === 0; } }
      : CATEGORIES.find((c) => c.re.test(text));
    if (!category) continue;
    categoryMatched += 1;

    const negated = NEGATION_RE.test(text);
    const nums = options.map(firstNumber);
    if (nums.some((n) => n === null)) continue; // not all options are plain numbers — skip, not this script's job

    const satisfies = nums.map((n) => (negated ? !category.test(n) : category.test(n)));
    const validCount = satisfies.filter(Boolean).length;
    const keyIdx = resolveKeyIndex(row.correct_answer, options);

    if (validCount > 1) {
      ambiguous += 1;
      findings.push({
        kind: 'ambiguous (multiple valid options)',
        id: row.id, exam_type: row.exam_type, subject: row.subject, chapter: row.chapter,
        question_text: row.question_text, options, correct_answer: row.correct_answer,
        category: category.name, negated,
        validOptions: options.filter((_, i) => satisfies[i]),
      });
    } else if (validCount === 0) {
      noneValid += 1;
      findings.push({
        kind: 'no valid option (key cannot be right)',
        id: row.id, exam_type: row.exam_type, subject: row.subject, chapter: row.chapter,
        question_text: row.question_text, options, correct_answer: row.correct_answer,
        category: category.name, negated,
      });
    } else if (keyIdx !== null && !satisfies[keyIdx]) {
      wrongKey += 1;
      findings.push({
        kind: 'wrong key (a different option is the only valid one)',
        id: row.id, exam_type: row.exam_type, subject: row.subject, chapter: row.chapter,
        question_text: row.question_text, options, correct_answer: row.correct_answer,
        category: category.name, negated,
        actualCorrect: options[satisfies.indexOf(true)],
      });
    }
  }

  if (data.length < step) break;
  from += step;
}

console.log(`\n${'='.repeat(60)}`);
console.log('SANITY CHECK COMPLETE — pyq_questions, MCQ rows only');
console.log('='.repeat(60));
console.log(`total MCQ rows scanned:                    ${scanned}`);
console.log(`rows matching a checkable category:        ${categoryMatched}`);
console.log(`  ambiguous (multiple valid options):      ${ambiguous}`);
console.log(`  no valid option:                         ${noneValid}`);
console.log(`  wrong key (single valid option ≠ key):   ${wrongKey}`);

if (findings.length) {
  console.log(`\n${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.log(`[${f.kind}] ${f.exam_type} / ${f.subject}${f.chapter ? ' / ' + f.chapter : ''} (id=${f.id})`);
    console.log(`  Q: ${f.question_text}`);
    console.log(`  options: ${JSON.stringify(f.options)}`);
    console.log(`  keyed answer: ${f.correct_answer}${f.negated ? '  [negated phrasing detected]' : ''}`);
    if (f.validOptions) console.log(`  ALL valid options: ${JSON.stringify(f.validOptions)}`);
    if (f.actualCorrect) console.log(`  actual single valid option: ${f.actualCorrect}`);
    console.log('');
  }
} else {
  console.log('\nNo findings among the checked categories.\n');
}
