/**
 * Semantic answer verification — a second model re-solves each question from
 * scratch and its answer is compared against the stored key.
 *
 * WHY THIS EXISTS
 * Generated questions reached students with no correctness check of any kind.
 * Hand-verifying 30 real generated questions measured **10% hard-wrong keys**:
 * a student who answers correctly is marked wrong, loses the XP, and the result
 * feeds `weak_topics` accuracy — so a bad key doesn't just misinform, it teaches
 * the platform to recommend the wrong revision topics, silently.
 *
 * WHY THE FREE CHECK WASN'T ENOUGH
 * `keyContradictsExplanation` (questionGen.js) compares the keyed option against
 * the numbers in its own explanation. It is free and worth keeping, but measured
 * at ~50% precision and catches only ~a quarter of wrong keys — specifically the
 * class where the key disagrees with its own working. The DOMINANT failure mode
 * is a key and an explanation that agree with each other and are both wrong
 * ("10th term of AP 2, 5, 8" keyed 31 with the explanation stating 2 + 9x3 = 31,
 * which is arithmetically false). No logic-only check can see that.
 *
 * WHAT THIS ADDS, AND WHAT IT DOESN'T
 * Measured on the same benchmark, scored against 4 hand-verified wrong keys:
 * this pass caught 2 of 4 with 1 false positive. That is ~50% recall ALONE — the
 * verifier is itself wrong at roughly the generator's rate. Its value is that it
 * is **complementary**: the free cross-check caught an item this misses, and
 * together they reach **~75% combined recall**, at the cost of ~2 sound
 * questions withheld per 30. Neither check alone gets close.
 *
 * gpt-4o, not gpt-4o-mini: identical recall, three times the false positives.
 *
 * COST AND LATENCY (measured, re-confirm against current pricing)
 * ~146 tokens in, ~40 out per question -> ~$0.0008/question (~8c per 100).
 * Median 1.34 s, p90 1.67 s. Generating 15 questions already takes 52-119 s, so
 * at concurrency 5 this adds ~4 s — under 5% of wall clock — and 186 tokens x 15
 * is negligible against the org's 30,000 TPM ceiling.
 *
 * FAILS OPEN, DELIBERATELY
 * A verification error leaves the question exactly as it was. The alternative —
 * withholding questions because an API call blipped — turns a transient fault
 * into an empty quiz. The one exception is AbortError, which propagates so a
 * navigated-away generation stops instead of grinding on.
 *
 * NEVER SEES THE KEY. The prompt carries the question and options only. Showing
 * the model the stored answer turns independent re-solving into agreement bias,
 * which would report a clean rate that isn't real.
 */

import { chatComplete } from './aiProxy';
import { getFeatureFlag, FLAGS } from './featureFlags';

const MODEL = 'gpt-4o';
const DEFAULT_CONCURRENCY = 5;

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Relative tolerance for numeric answers — generated numericals routinely
 *  differ in rounding ("9.8" vs "9.81"), which is not a wrong key. */
const NUMERIC_REL_TOLERANCE = 0.01;

/**
 * Is this question checkable at all?
 *
 * Descriptive types (Short/Long Answer) have no single comparable answer, so
 * running a verifier over them would generate noise, not signal.
 */
export function isVerifiable(q) {
  if (!q || !q.question) return false;
  if (q.type === 'Numerical') {
    return q.correctAnswer != null && String(q.correctAnswer).trim() !== '';
  }
  return Array.isArray(q.options)
    && q.options.length >= 2
    && typeof q.correctOption === 'number'
    && q.correctOption >= 0
    && q.correctOption < q.options.length;
}

/** First real number in a string, tolerating units, commas and unicode minus. */
export function firstNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? '').replace(/[−–—]/g, '-').replace(/,(?=\d{3}\b)/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?(?:\s*[eE]\s*-?\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Numeric agreement within a relative tolerance.
 *
 * Compares the leading number of each side, so "20 J" and "20" agree and
 * "20 J" and "50 J" do not. Returns null when either side has no number at all,
 * meaning "not comparable" rather than "disagrees" — an uncomparable pair must
 * not be reported as a wrong key.
 */
export function numericAgrees(a, b, tol = NUMERIC_REL_TOLERANCE) {
  const x = firstNumber(a);
  const y = firstNumber(b);
  if (x === null || y === null) return null;
  if (x === y) return true;
  const scale = Math.max(Math.abs(x), Math.abs(y));
  if (scale === 0) return true;
  return Math.abs(x - y) / scale <= tol;
}

const SYSTEM = `You are a meticulous exam marker. Solve the question yourself, from first principles, and report the answer you actually derive.

Do not try to guess what an answer key might say. If your working leads to a value that is not among the options, say so — that is useful information, not a failure.

Return ONLY valid JSON.`;

function buildPrompt(q) {
  const isNumerical = q.type === 'Numerical';
  const optionBlock = isNumerical
    ? ''
    : `\nOptions:\n${q.options.map((o, i) => `${LETTERS[i]}. ${String(o).replace(/^\s*[A-F][).]\s*/, '')}`).join('\n')}\n`;

  return `Solve this ${q.subject ?? ''} question.

Question: ${q.question}${optionBlock}
${isNumerical
    ? `Return JSON: {"answer": "<the final numeric value, with unit if any>", "confidence": "high" | "low"}`
    : `Return JSON: {"answer": "<the single letter of the option you derived>", "none_match": <true if your derived answer matches NO option>, "confidence": "high" | "low"}`}

Keep any reasoning out of the JSON. Answer only.`;
}

/**
 * Verifies one question. Resolves to a verdict rather than throwing, so one bad
 * response cannot take down a whole generation.
 *
 * @returns {Promise<{status:'agree'|'disagree'|'skipped'|'error', reason?:string, modelAnswer?:string}>}
 */
export async function verifyOne(q, { signal, model = MODEL } = {}) {
  if (!isVerifiable(q)) return { status: 'skipped' };

  try {
    const resp = await chatComplete({
      model,
      max_tokens: 120,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildPrompt(q) },
      ],
    }, { signal });

    const raw = resp?.choices?.[0]?.message?.content;
    if (!raw) return { status: 'error', reason: 'empty verifier response' };

    const parsed = JSON.parse(raw);
    const answer = parsed?.answer;
    if (answer == null || String(answer).trim() === '') {
      return { status: 'error', reason: 'verifier returned no answer' };
    }

    if (q.type === 'Numerical') {
      const agrees = numericAgrees(answer, q.correctAnswer);
      // null = neither side yielded a number, so there is nothing to compare.
      if (agrees === null) return { status: 'skipped' };
      return agrees
        ? { status: 'agree', modelAnswer: String(answer) }
        : {
            status: 'disagree',
            modelAnswer: String(answer),
            reason: `verifier re-solved to ${String(answer).slice(0, 40)}, key says ${String(q.correctAnswer).slice(0, 40)}`,
          };
    }

    // MCQ: compare option letters.
    const letter = String(answer).trim().toUpperCase().replace(/^[([{\s]+/, '').charAt(0);
    const idx = LETTERS.indexOf(letter);
    if (idx === -1) return { status: 'error', reason: `unparseable verifier answer ${JSON.stringify(answer)}` };

    if (parsed?.none_match === true) {
      return {
        status: 'disagree',
        modelAnswer: letter,
        reason: `verifier derived an answer matching no option (closest ${letter}, key ${LETTERS[q.correctOption]})`,
      };
    }
    if (idx === q.correctOption) return { status: 'agree', modelAnswer: letter };

    return {
      status: 'disagree',
      modelAnswer: letter,
      reason: `verifier chose ${letter}, key says ${LETTERS[q.correctOption]}`,
    };
  } catch (e) {
    // Navigated away — stop the whole run rather than verifying into the void.
    if (e?.name === 'AbortError') throw e;
    return { status: 'error', reason: String(e?.message ?? e).slice(0, 120) };
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Verifies a batch of engine-format questions, returning a NEW array with
 * `needs_review` / `review_reason` set on the ones that failed.
 *
 * An existing needs_review (from the free cross-check) is never cleared — the
 * two checks are complementary and each catches items the other misses, so the
 * union is the point.
 *
 * @param {Array}  questions engine-format questions (post toEngineFormat)
 * @param {{signal?:AbortSignal, concurrency?:number, model?:string}} opts
 * @returns {Promise<{questions:Array, stats:object}>}
 */
export async function verifyQuestions(questions, { signal, concurrency = DEFAULT_CONCURRENCY, model = MODEL } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const stats = { total: list.length, checked: 0, agreed: 0, flagged: 0, skipped: 0, errored: 0, alreadyFlagged: 0 };

  if (!list.length) return { questions: list, stats };

  // Opt-OUT flag: a safety check should be on unless deliberately turned off,
  // and a missing flag row reads as false. Set answer_verification_off = true
  // to disable without a deploy.
  let disabled = false;
  try { disabled = await getFeatureFlag(FLAGS.ANSWER_VERIFICATION_OFF); } catch { disabled = false; }
  if (disabled) return { questions: list, stats: { ...stats, skipped: list.length, disabled: true } };

  const verdicts = await mapLimit(list, concurrency, (q) => verifyOne(q, { signal, model }));

  const out = list.map((q, i) => {
    const v = verdicts[i] ?? { status: 'error', reason: 'no verdict' };
    if (q.needs_review) stats.alreadyFlagged++;

    if (v.status === 'skipped') { stats.skipped++; return q; }
    if (v.status === 'error')   { stats.errored++; return q; }   // fail open
    stats.checked++;
    if (v.status === 'agree')   { stats.agreed++; return q; }

    stats.flagged++;
    return {
      ...q,
      needs_review:  true,
      // Keep both reasons when the free check already fired — a question the two
      // independent checks agree on is far likelier to be genuinely wrong, and
      // that is worth being able to see later.
      review_reason: q.review_reason ? `${q.review_reason}; ${v.reason}` : v.reason,
      verifier_answer: v.modelAnswer ?? null,
    };
  });

  return { questions: out, stats };
}
