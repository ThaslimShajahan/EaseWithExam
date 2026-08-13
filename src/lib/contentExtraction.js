/**
 * PDF -> structured content extraction.
 *
 * Lifted out of AdminContentIntake.jsx so the extraction and classification
 * logic can be exercised directly (see scripts/run-pilot.mjs) instead of only
 * through an admin-authenticated UI flow. Pure logic — no React, no session.
 *
 * The classification fields (content_type / technique / difficulty / confidence)
 * are what make chunks FILTERABLE rather than merely semantically searchable:
 * they land in real columns on knowledge_base and are pushed into
 * match_knowledge_base as WHERE-clause filters.
 */

import { chatComplete } from './aiProxy';
import { splitIntoBatches } from './pdfAnalyzer';


/**
 * Snaps an AI-guessed chapter name onto the real syllabus.
 *
 * Lives here rather than in AdminContentIntake so the intake screen and any
 * headless loader snap identically — a copy that drifted would produce two
 * different chapter vocabularies in the same table.
 *
 * Three passes, narrowest first. The third exists because exact-then-substring
 * matching missed "Human Eye and Colourful World" against the real "The Human
 * Eye and the Colourful World" — an interior "the" is enough to defeat
 * containment, and the near-miss then becomes its own phantom chapter in
 * Blueprint V2's per-chapter counts.
 *
 * Returns the guess untouched when nothing is close enough; callers decide
 * whether that is acceptable.
 */
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'to', 'for', 'on', 'its', 'their', 'with']);
const chapterTokens = (s) => String(s ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  .filter((w) => w && !STOPWORDS.has(w))
  // Crude stem so "reproduce"/"reproduction" and "identities"/"identity" meet.
  .map((w) => w.replace(/(ies|ing|ion|ions|es|s)$/, ''));

/* ── Marks normalisation ──────────────────────────────────────────────
 *
 * `pyq_questions.marks` is an INTEGER column and savePYQRows used to pass the
 * model's value straight into it. A Class X maths model paper came back with a
 * 0.5 and Postgres rejected the whole statement:
 *
 *   invalid input syntax for type integer: "0.5"   (SQLSTATE 22P02)
 *
 * The insert is one multi-row statement, so ONE bad field discarded all ~40
 * questions in the file. That blast radius is the real bug — the 0.5 itself is
 * just the trigger, and any non-integer the model ever returns would do it.
 *
 * Half marks ARE legitimate on real papers, so this is a stopgap, not a verdict:
 * the honest fix is a numeric column, tracked in
 * docs/ACTION_ITEMS_FOR_YOU.md. Until then we round rather than reject, and —
 * critically — every adjustment is REPORTED to the operator. Silently rewriting
 * a mark would be the same silent-degradation pattern that made the vision hang
 * undiagnosable.
 */

/** A single question worth more than this is a model artefact (typically the
 *  paper's total_marks leaking into a question), not a real mark. */
export const MAX_PLAUSIBLE_QUESTION_MARKS = 25;

const FRACTION_GLYPHS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/**
 * Coerces whatever the model returned for `marks` into something the integer
 * column accepts.
 *
 * Returns `{ value, note }`. `note` is non-null ONLY when the stored value
 * differs from what was extracted, so callers can surface exactly the rows a
 * human should re-check and nothing else.
 */
export function normaliseMarks(raw) {
  const clean = (v) => ({ value: v, note: null });
  if (raw === null || raw === undefined || raw === '') return clean(null);

  let n;
  if (typeof raw === 'number') {
    n = raw;
  } else {
    const s = String(raw).trim();
    // "½" and "1½" both appear in Indian board papers and their marking schemes.
    const m = s.match(/^(\d+)?\s*([½¼¾⅓⅔])$/);
    if (m) n = (m[1] ? Number(m[1]) : 0) + FRACTION_GLYPHS[m[2]];
    else n = Number(s.replace(/[^0-9.]/g, ''));
  }

  const shown = JSON.stringify(raw);
  if (!Number.isFinite(n)) return { value: null, note: `unreadable marks ${shown} → left blank` };
  if (n <= 0)              return { value: null, note: `non-positive marks ${shown} → left blank` };
  if (n > MAX_PLAUSIBLE_QUESTION_MARKS) {
    return { value: null, note: `implausible marks ${shown} → left blank` };
  }
  if (Number.isInteger(n)) return clean(n);

  // Round rather than drop: a half-mark question is still a real question, and
  // floor()ing 0.5 to 0 would make it worth nothing. Math.round takes 0.5 up.
  const rounded = Math.max(1, Math.round(n));
  return { value: rounded, note: `marks ${n} → ${rounded}` };
}

/**
 * Syllabi known to be INCOMPLETE, keyed by exam type OR by exam type + subject.
 *
 * For these, runPYQExtraction does NOT send the closed chapter list to the
 * model. A partial closed list is worse than none: it forces every
 * out-of-scope question into the nearest listed chapter, producing a
 * confident wrong tag instead of a visibly unsnapped one.
 *
 * WHY THIS GAINED A SUBJECT DIMENSION
 *
 * It was originally a set of exam types, which was enough while Kerala was the
 * only entry — there, EVERY subject is Part 1. Class 8 and Class 9 broke that:
 * their Social Science books are Part 1 only (Class 8's index jumps Theme B to
 * Theme D; Theme C is in the absent Part 2), while their **Mathematics and
 * Science syllabi are complete and correct**, with 148 loaded files behind them.
 *
 * A bare `CBSE Class 8` entry would have disabled the closed-list rule for
 * Class 8 Maths and Science too — quietly undoing the constraint that exists to
 * stop the model inventing chapter names, on the two subjects that least need
 * loosening. The partial-ness is a property of the SUBJECT, so the key is.
 *
 * Entries:
 *   'Kerala State Class 10'          every subject is SCERT Part 1 only
 *   'CBSE Class 8::Social Science'   Exploring Society: India and Beyond, Part 1
 *   'CBSE Class 9::Social Science'   Understanding Society: India and Beyond, Part 1
 *   'CBSE Class 9::English'          Kaveri, seeded at UNIT level — see below
 *
 * `CBSE Class 9::English` is here for a different reason from the others: the
 * book is complete, but it is the one book of the 26 that prints no contents
 * page, so only its 8 UNIT names could be verified (from NCERT's own audio
 * transcript appendix). Each unit holds 2-3 individual texts, and a font-size
 * heading scan could not establish them reliably — a 20pt threshold silently
 * missed a text in six of eight units, and "Weigh Your Words" reads as an
 * activity heading from the page start and as a poem from the heading itself.
 * So the seeded list is deliberately coarser than the content, which is exactly
 * the condition this gate exists for. Stage F reconciles the per-text rows from
 * what the loader actually found, and this entry comes out then.
 *
 * Remove an entry the moment its Part 2 is seeded, or the model keeps guessing
 * chapter names it did not need to guess.
 */
export const PARTIAL_SYLLABUS = new Set([
  'Kerala State Class 10',
  'CBSE Class 8::Social Science',
  'CBSE Class 9::Social Science',
  'CBSE Class 9::English',
]);

/**
 * True when this exam type + subject has an incomplete syllabus.
 *
 * A whole-exam-type entry wins over the subject key, so 'Kerala State Class 10'
 * still covers all four of its subjects without needing four entries. Passing no
 * subject checks only the exam-type form, which is the honest answer when the
 * caller genuinely has no subject in hand.
 */
export function isPartialSyllabus(examType, subject = null) {
  if (PARTIAL_SYLLABUS.has(examType)) return true;
  return subject ? PARTIAL_SYLLABUS.has(`${examType}::${subject}`) : false;
}

/**
 * The actual matcher, shared by both callers below. Returns the INDEX into
 * `names` of the best match, or -1 on no confident match — never a string,
 * so neither caller has to re-derive a name back into whatever else it also
 * needs (e.g. a chapter_key at the same index, see matchSyllabusChapterKeyed).
 *
 * Exact, then substring, then token-overlap scoring — unchanged from the
 * original single-purpose function this was extracted from. See
 * matchSyllabusChapter's own history for the measured cases the 1/3
 * threshold and the 6-char shared-prefix rule are calibrated against.
 */
function _bestChapterMatchIndex(guess, names) {
  if (!guess || !names?.length) return -1;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const g = norm(guess);

  const exactIdx = names.findIndex((c) => norm(c) === g);
  if (exactIdx !== -1) return exactIdx;

  const partialIdx = names.findIndex((c) => norm(c).includes(g) || g.includes(norm(c)));
  if (partialIdx !== -1) return partialIdx;

  // Token overlap, Jaccard over stemmed content words. Tokens also count as
  // shared when one is a long prefix of the other, which is what lets
  // "trigonometric" meet "trigonometry" — suffix stripping alone does not.
  // Shared COMMON PREFIX, not startsWith: "trigonometric" and "trigonometry"
  // agree for 11 characters and then diverge, so neither is a prefix of the
  // other. Six characters is long enough that "triangle"/"trigonometry" (3)
  // and "simple"/"some" (1) stay apart.
  const shareToken = (a, b) => {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i >= 6;
  };

  const gt = [...new Set(chapterTokens(guess))];
  if (!gt.length) return -1;
  let bestIdx = -1, bestScore = 0;
  for (let i = 0; i < names.length; i++) {
    const ct = [...new Set(chapterTokens(names[i]))];
    if (!ct.length) continue;
    const shared = gt.filter((t) => ct.some((u) => shareToken(t, u))).length;
    const score = shared / (gt.length + ct.length - shared);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // 1/3 is where the measured cases separate, and the separation is narrow:
  //   "Human Eye and Colourful World" -> "The Human Eye and the Colourful World"  1.00
  //   "Trigonometric Identities"      -> "Introduction to Trigonometry"           0.33
  //   "Chemical Bonding"              -> "Chemical Reactions and Equations"       0.25  rejected
  //   "Human Reproduction"            -> "How do Organisms Reproduce?"            0.20  rejected
  //   "Simple Interest"               -> nothing in Class 10 Maths                0.00  rejected
  //
  // "Human Reproduction" IS a real rename of "How do Organisms Reproduce?" and
  // is deliberately not recovered: it scores below "Chemical Bonding" against
  // "Chemical Reactions and Equations", which is a genuinely wrong snap. No
  // purely lexical rule separates them, and a wrong snap is worse than none —
  // it silently attributes a question to a chapter it does not test. Cases like
  // that are what the closed chapter list in runPYQExtraction is for; this
  // backstop only covers uploads with no syllabus to constrain against.
  return bestScore >= 1 / 3 ? bestIdx : -1;
}

/** Unchanged observable behaviour from before the extraction above: returns
 *  the matched name, or the raw guess unconstrained on no match. Used by the
 *  Notes no-manifest fallback path — deliberately NOT given a stricter
 *  reject-on-no-match behaviour here, since that path already has its own
 *  separate, stricter path (assignChapters) for any book with an approved
 *  manifest; this backstop only runs for books that don't have one yet. */
export function matchSyllabusChapter(guess, chapterNames) {
  const i = _bestChapterMatchIndex(guess, chapterNames);
  return i === -1 ? guess : chapterNames[i];
}

/**
 * Content-engine rebuild, Phase 2 PYQ slice (docs/REBUILD_HANDOFF.md).
 * Same matching algorithm as matchSyllabusChapter, but against real
 * syllabus_nodes rows (carrying chapter_key) instead of bare name strings,
 * and returns null rather than the raw guess on no confident match — PYQ's
 * per-question reject-on-no-match behaviour (owner-decided: reject the
 * individual question, not the whole paper) needs to know a match genuinely
 * failed, not silently receive an unconstrained name back.
 *
 * @param {string} guess
 * @param {{key: string, name: string}[]} chapters — from getChapters()
 * @returns {{key: string, name: string} | null}
 */
export function matchSyllabusChapterKeyed(guess, chapters) {
  const names = (chapters ?? []).map((c) => c.name);
  const i = _bestChapterMatchIndex(guess, names);
  return i === -1 ? null : chapters[i];
}

/**
 * PYQ batching and output ceiling, sized from measured question JSON.
 *
 * This call used to reserve `max_tokens: 16000` against a 30,000 TPM org — over
 * half the entire per-minute budget in one request, the same hazard that cost
 * two files during the corpus load (see NOTES_MAX_TOKENS).
 *
 * Measured over 30 real questions, serialised into this extractor's own schema
 * (section, marks, type, chapter, question_text, options, correct_answer,
 * explanation, has_diagram): median 354 chars, max 644 — roughly 90 tokens per
 * question, 160 at the top end. A whole 38-question CBSE board paper is
 * therefore ~3,500 output tokens, not 16,000.
 *
 * 12,000 chars is ~20-25 questions a call, so even at the 160-token end that is
 * ~4,000 tokens of output; 5,000 leaves headroom for a long case-based passage
 * without reserving budget that is never used. Reservation per call drops from
 * ~20,000 to ~8,600, which is the difference between one upload monopolising
 * the minute and several running back to back.
 *
 * RE-MEASURED 2026-08-10 against NEET papers, which are far denser than the
 * CBSE board papers the numbers above came from. A NEET paper is 180-200 MCQs
 * with four options each and no long-answer questions:
 *
 *   measured output      515 bytes/question (~129 tokens), 2021 Physics, 37 Qs
 *   densest source seen  366 source chars/question (2024 combined, 200 Qs)
 *
 * At the old 12,000-char batch that densest case packs ~33 questions into one
 * call — ~4,250 output tokens against a 5,000 ceiling, i.e. 15% headroom before
 * the finish_reason==='length' guard throws and the whole file fails. Dropping
 * the batch to 9,000 chars gives ~25 questions and ~3,200 tokens, restoring
 * ~37% headroom WITHOUT raising the reservation: max_tokens stays 5,000, so
 * per-call TPM cost falls (less input, same ceiling) rather than rising.
 *
 * Lowering the batch is the right lever here, not raising the cap — reserved
 * tokens are what the 30,000 TPM ceiling actually counts.
 *
 * CORRECTED AGAIN, from a real failure rather than a projection. 9,000 threw the
 * truncation guard on NEET 2021 Biology, batch 2/4: that batch carried ~25
 * questions and exceeded 5,000 output tokens, so BIOLOGY runs 200+ tokens per
 * question — the earlier ~130 figure came from Physics and Chemistry, whose
 * questions are short and whose options are symbolic. Biology stems and their
 * explanations are prose, and prose is where the estimate broke.
 *
 * Sized against the worst case actually observed (220 tokens/question):
 *   5,000 chars -> ~16 questions -> ~3,560 tokens against a 6,000 cap (41% clear)
 *   densest source (2024 combined, 366 chars/q) -> ~14 questions -> ~3,000
 *
 * max_tokens goes UP to 6,000 here despite the TPM cost, because this guard
 * throws the whole FILE rather than degrading one batch — the asymmetry is
 * worth ~1 call/min. Net reservation per call is 1,250 input + 6,000 = ~7,250,
 * about 4 calls/min against the org's 30,000 TPM.
 */
const PYQ_BATCH_CHARS = 5000;
const PYQ_MAX_TOKENS  = 6000;

/**
 * `preamble` — text repeated into EVERY batch, not split across them.
 *
 * Exists for papers that print a compact answer key on one page covering the
 * whole paper (NEET 2025 page 26: "1. (2) 2. (2) 3. (2) …" for all 180). Batching
 * is sequential with no cross-batch memory, so a key sitting in the last batch
 * can only ever answer the last batch's questions — the other ~160 come back
 * with correct_answer null despite the key being right there in the PDF.
 *
 * Defaults to '' so every existing caller is unchanged.
 */
export async function runPYQExtraction({ rawText, examType, subject, year, onProgress, syllabusChapters = [], preamble = '' }) {
  const isMixed = subject === 'Mixed';
  const batches = splitIntoBatches(rawText, PYQ_BATCH_CHARS);

  // Constrain, don't clean up afterwards. Left to invent chapter names freely
  // the model produced "Chemical Bonding" and "Exponents and Powers" for a
  // Class 10 paper — chapters that don't exist at that level — plus near-misses
  // like "Human Eye and Colourful World" against the real "The Human Eye and
  // the Colourful World". Measured over two real board papers: 14% of questions
  // landed on a chapter no matcher could rescue, each becoming its own phantom
  // low-frequency chapter in Blueprint V2's allocation. Showing the model the
  // actual chapter list turns that from fuzzy string matching into
  // multiple-choice.
  const chapterList = (syllabusChapters ?? []).filter(Boolean);

  /* The closed list is only safe when the syllabus is COMPLETE. chapterRule
   * tells the model every chapter "MUST be copied EXACTLY" and to fall back to
   * "Other" only if a question "fits none of them at all" — so a half-complete
   * list forces out-of-scope questions into the nearest listed chapter, which
   * is a confident WRONG tag rather than a visible orphan.
   *
   * `Kerala State Class 10` is seeded from the SCERT Part 1 textbooks only;
   * the Part 2 volumes do not exist in the corpus (see
   * scripts/seed-kerala-class10-syllabus.mjs). Class 8 and Class 9 Social
   * Science are Part 1 only for the same reason. Their nodes still drive
   * post-hoc matchSyllabusChapter() snapping and the chapter pickers — they
   * just do not constrain this prompt. Remove an entry once its Part 2 is
   * seeded.
   *
   * Scoped by exam_type AND subject, so CBSE and NEET — and, critically, Class 8
   * and 9 Mathematics and Science, whose syllabi ARE complete — keep the closed
   * list exactly as before. */
  const partialSyllabus = isPartialSyllabus(examType, subject);
  const chapterRule = (chapterList.length && !partialSyllabus)
    ? `\nCHAPTER — this is a CLOSED LIST. Every question's "chapter" MUST be copied
EXACTLY, character for character, from this list of ${chapterList.length} chapters:
${chapterList.map((c) => `  - ${c}`).join('\n')}
Pick the single best fit. Do NOT invent a chapter name, do NOT abbreviate one,
do NOT merge two, and do NOT use a name from a different class's syllabus. If a
question genuinely spans two, choose the one it is mostly testing. Only if a
question fits none of them at all, use "Other".\n`
    : '';
  const allQuestions = [];
  let paperTitle = null, totalMarks = null;

  for (let b = 0; b < batches.length; b++) {
    onProgress(batches.length > 1 ? `AI extracting questions… (part ${b + 1}/${batches.length})` : 'AI extracting questions…');

    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      PYQ_MAX_TOKENS,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert at extracting structured question papers from raw text. Return only valid JSON. Extract every question in the given text — this may be one part of a larger paper split across multiple calls, so only extract what appears in THIS excerpt.' },
        {
          role: 'user',
          content: `Extract ALL questions from this ${examType}${isMixed ? '' : ` ${subject}`} question paper${year ? ` (${year})` : ''}${batches.length > 1 ? ` (excerpt ${b + 1} of ${batches.length})` : ''}.
${isMixed ? '\nThis paper covers multiple subjects. For each question, also identify the subject (Physics, Chemistry, Biology for NEET; Physics, Chemistry, Mathematics for JEE).' : ''}

For CBSE/board papers, section marks: A=1, B=2, C=3, D=5, E=4-5.
For NEET/JEE: all MCQ, 4 marks correct, -1 wrong.
"marks" is the TOTAL for the whole question. Marking schemes award part-marks
step by step ("½ mark for the formula, 1 mark for the substitution") — those are
steps within an answer, never the question's own value. Sum them, or use the
mark printed against the question.

Extract every question. For each include:
- Full question text
- Section label (A/B/C/D/E or blank)
- Marks per question
- Question type (MCQ / Short Answer / Long Answer / Numerical / Assertion-Reason / Case-Based)
- Chapter or topic — identify this from the actual content, as precisely as you can${chapterRule ? ' (SEE THE CLOSED CHAPTER LIST BELOW — it overrides this line)' : ''}
- All 4 options if MCQ (A, B, C, D)
- Correct answer if in answer key
- Brief explanation if available
- has_diagram: true if question references a figure/diagram/graph
${isMixed ? '- subject: Physics / Chemistry / Biology / Mathematics' : ''}

Return JSON:
{
  "paper_title": "title if visible",
  "total_marks": 80,
  "questions": [
    {
      "section": "A", "marks": 1, "type": "MCQ", "chapter": "topic name",
      "question_text": "full question", "options": ["A. opt1","B. opt2","C. opt3","D. opt4"],
      "correct_answer": "A", "explanation": "", "has_diagram": false${isMixed ? ',\n      "subject": "Biology"' : ''}
    }
  ]
}

${chapterRule}${preamble ? `
ANSWER KEY FOR THE WHOLE PAPER — this covers every question in the paper, not
just the excerpt below. Match each question you extract to its number in this
key and use that as "correct_answer". Do NOT guess an answer that is not in this
key, and do NOT treat the key itself as a question:
"""
${preamble}
"""
` : ''}
RAW TEXT:
${batches[b]}`,
        },
      ],
    });

    // Truncation matters more here than in notes: a cut-off response doesn't
    // just shorten a chunk, it silently drops questions off the end of a paper
    // and the upload still looks like it succeeded.
    if (resp.choices[0].finish_reason === 'length') {
      throw new Error(
        `PYQ extraction hit the ${PYQ_MAX_TOKENS}-token output cap on batch ${b + 1}/${batches.length} — questions would be lost. Raise PYQ_MAX_TOKENS or lower PYQ_BATCH_CHARS.`,
      );
    }

    const data = JSON.parse(resp.choices[0].message.content);
    allQuestions.push(...(data.questions ?? []));
    paperTitle = paperTitle || data.paper_title;
    totalMarks = totalMarks || data.total_marks;
  }

  if (!allQuestions.length) throw new Error('No questions found. Check if this is a text-based PDF.');
  return { questions: allQuestions, paperTitle, totalMarks };
}

/**
 * Notes are batched far smaller than the 30,000-char default.
 *
 * Asking one call to cover a whole 22-page chapter reliably produced ~14 chunks
 * of ~170 chars each — the model treats a large input as a request to SUMMARISE
 * and its output-length prior beats any "MUST be 100-300 words" instruction.
 * Measured: telling it to write more moved the median only 169 -> 284 chars.
 * At ~6 pages a call the ask ("one chunk per page") lands inside the length the
 * model will actually produce, so coverage comes from batching, not nagging.
 *
 * The trade-off is call COUNT: a 75k-char chapter goes from 3 calls to ~10, and
 * OpenAI charges max_tokens as RESERVED against TPM, so per-minute pressure
 * rises even though each individual call is smaller. That is what exhausted the
 * org's 30,000 TPM mid-load and cost two files. See NOTES_MAX_TOKENS.
 */
const NOTES_BATCH_CHARS = 8000;

/**
 * Sized from measured output, not padded by guesswork.
 *
 * A batch is ~6 pages and yields ~5-8 chunks. Measured across the two pilot
 * chapters: median chunk 526-630 chars, largest 1,092 — so even a generous
 * 8 x 1,100 chars of content plus the JSON scaffolding (headings, keywords,
 * latex, classification fields) lands near 2,000-2,500 tokens. 6,000 was never
 * reached; it was reserved on every call and thrown away.
 *
 * Since reserved tokens are what the TPM ceiling actually counts, halving this
 * roughly doubles sustainable throughput: at ~3,200 input + 6,000 reserved the
 * org's 30,000 TPM allowed ~3.3 calls/min, which one dense chapter alone
 * exceeds. At 3,000 it allows ~4.8.
 *
 * If output ever does hit this ceiling the response is truncated mid-JSON and
 * the parse fails loudly rather than silently shortening a chunk — a failed
 * file, not a quietly degraded one.
 */
const NOTES_MAX_TOKENS = 3000;

export async function runNotesExtraction({ rawText, pages, examType, subject, onProgress }) {
  const guide = promptGuideFor(subject);

  /* Verbatim source text is REQUIRED for literature: comprehension questions are
   * generated against the actual passage, and the model paraphrases a passage
   * even when told not to. The [[PAGE N]] marker path below slices the ORIGINAL
   * `pages` array rather than trusting model output — but only when the caller
   * supplies it. A literature load that quietly fell back to rawText would
   * produce chapters that look complete and cannot support an extract question,
   * so this fails loudly instead. */
  if (guide.family === 'literature' && !pages?.length) {
    throw new Error(
      'Literature extraction requires the `pages` array — verbatim source text is sliced from it, never taken from model output. Caller passed rawText only.',
    );
  }

  const batches = splitIntoBatches(rawText, NOTES_BATCH_CHARS);
  const mergedLessons = []; // preserves first-seen order across batches
  let unit = null;

  for (let b = 0; b < batches.length; b++) {
    onProgress(batches.length > 1 ? `AI structuring study notes… (part ${b + 1}/${batches.length})` : 'AI structuring study notes…');

    // Titles already established, so a batch landing mid-chapter continues the
    // existing lesson instead of inventing a section-shaped one of its own.
    const seenTitles = mergedLessons.map((l) => l.title).filter(Boolean);

    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      NOTES_MAX_TOKENS,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You structure textbook/study material PDFs into their real table-of-contents shape (unit, individual lessons/chapters, and the page range each one actually spans) and break each lesson into searchable knowledge chunks. Return only valid JSON. Use the page numbers as they actually appear printed in the PDF — do not invent them. This may be one part of a larger unit split across multiple calls — only extract lessons/chunks whose content appears in THIS excerpt; if a lesson clearly continues from where it left off, reuse the SAME title so it can be merged back together.\n\nYou are TRANSCRIBING AND ORGANISING, not summarising. The chunks are the only record of this material that survives — anything you leave out is lost. A short answer is a failure, not a virtue.',
        },
        {
          role: 'user',
          content: `This is ${examType} ${subject} content, possibly spanning one unit with multiple lessons/chapters (like a textbook "Contents" page), or just a single chapter — read the actual content and structure it correctly either way.${batches.length > 1 ? ` (excerpt ${b + 1} of ${batches.length} of a larger unit)` : ''}

Each page in CONTENT below is prefixed with a literal [[PAGE N]] marker.
${seenTitles.length ? `
ALREADY IN PROGRESS: earlier excerpts of this same upload produced the
lesson(s) ${seenTitles.map((t) => `"${t}"`).join(', ')}. This excerpt is very
likely a CONTINUATION of the last one. If it is, reuse that EXACT title so the
chunks merge back into one chapter — do not coin a new title for what is only a
later section of it. Only introduce a new title if a genuinely new numbered
chapter starts here.
` : ''}

${guide.lessonRule}

For each lesson, extract:
- title: the real chapter title, from the content — not a generic label
- page_start / page_end: the actual printed page numbers this lesson spans, as they visibly appear in the text (e.g. a running header showing "23"). Use null if you can't tell — a guess is worse than null.
- marker_start / marker_end: the [[PAGE N]] marker numbers where this lesson's content begins and ends — NOT the printed page numbers, just which markers it falls between. Always fill these in, they're always visible.
- chunks: see below.

CHUNK LENGTH AND COVERAGE — the most common failure is chunks that are far too
short, so treat this as a hard requirement:
- Each chunk's "content" MUST be 100–300 words (roughly 600–1800 characters).
  A one-line fact such as "The cube roots of 64, 512 and 729 are 4, 8 and 9" is
  NOT a chunk — it is a fragment. Expand it into the full explanation the book
  gives: the reasoning, the method, the worked steps, the numbers, the examples.
- Your chunks must account for essentially ALL of the substantive content in
  THIS excerpt. Expect roughly ONE CHUNK PER [[PAGE N]] MARKER below — count the
  markers, and return about that many chunks. Six pages of content means about
  six chunks, not two.
- Keep the concrete detail: actual numbers, worked calculations, named results,
  puzzle set-ups, tables described in words. Do not compress them away.

CHUNK CLASSIFICATION — every chunk needs these, they drive retrieval filtering:
- content_type: exactly one of
${guide.contentTypes}
${guide.techniqueRule}
- difficulty: "easy" | "medium" | "hard" — relative to the target exam level.
- confidence: 0.0-1.0, how confident you are in the content_type label. Use a
  low value when the chunk is genuinely mixed rather than forcing a guess.
- latex: array of every equation, formula or mathematical expression that
  appears in this chunk's source text, written as LaTeX (no delimiters), e.g.
  ["a^2 + b^2 = c^2", "\\\\sqrt{729} = 27"]. Harvest these from the TEXT you are
  reading — plain-text maths such as "12 x 12 = 144", "5^3 = 125" or a table of
  squares all count. Use [] only when the chunk genuinely contains no maths.

These labels are metadata ABOUT the chunk. They never replace or shorten the
chunk's "content", which must still be the full 100–300 word passage.

Return JSON (the "content" below shows the expected LENGTH and DEPTH — match it):
{
  "unit": "Unit name if this content is part of a numbered/named unit, else null",
  "lessons": [
    {
      "title": "chapter/lesson title",
      "page_start": 2, "page_end": 8,
      "marker_start": 1, "marker_end": 7,
      "chunks": [ {
        "heading": "Finding a square root by prime factorisation",
        "content": "A square root of a number is the value that, multiplied by itself, gives that number. Because 12 x 12 = 144, the square root of 144 is 12. For larger numbers the prime factorisation method is quicker than guessing. Take 1296. Divide repeatedly by the smallest prime that goes in: 1296 = 2 x 648 = 2 x 2 x 324 = 2 x 2 x 2 x 162 = 2 x 2 x 2 x 2 x 81, and 81 = 3 x 3 x 3 x 3. So 1296 = 2^4 x 3^4. Every prime now appears an even number of times, which is exactly what makes a number a perfect square. Pair the factors up — two 2s in each pair, two 3s in each pair — and take one factor from each pair: 2 x 2 x 3 x 3 = 36. Checking, 36 x 36 = 1296. If any prime is left unpaired, the number is not a perfect square, and that leftover factor tells you the smallest number you would have to multiply or divide by to make it one. For example 200 = 2^3 x 5^2 has a spare 2, so 200 x 2 = 400 is a perfect square with square root 20.",
        "keywords": ["square root","prime factorisation","perfect square","factor pairs"],
        "content_type": "derivation",
        "technique": ["prime_factorisation","square_root_calculation"],
        "difficulty": "medium",
        "confidence": 0.9,
        "latex": ["12 \\\\times 12 = 144", "1296 = 2^4 \\\\times 3^4", "\\\\sqrt{1296} = 36"]
      } ]
    }
  ]
}
${guide.family === 'stem' ? '' : `
NOTE ON THE EXAMPLE ABOVE: it is a mathematics chunk, shown for the LENGTH and
DEPTH its "content" demonstrates — match that. Its "content_type" and
"technique" values are NOT available to you. Use only the content_type values
listed above, and follow the technique rule above.
`}
CONTENT:
${batches[b]}`,
        },
      ],
    });

    // A truncated response is a cut-off JSON string, so JSON.parse below would
    // fail with a position offset that says nothing about the cause. Naming it
    // here is the difference between "max_tokens is too low" and a mystery.
    const finish = resp.choices[0].finish_reason;
    if (finish === 'length') {
      throw new Error(
        `Structuring response hit the ${NOTES_MAX_TOKENS}-token output cap on batch ${b + 1}/${batches.length} — raise NOTES_MAX_TOKENS or lower NOTES_BATCH_CHARS.`,
      );
    }
    /* Every other non-'stop' reason cuts the JSON off just as effectively, and
     * the guard above named only one of them. Two Class 11 literature files
     * failed with "Unterminated string in JSON" ending at 1,688 and 2,371
     * chars — roughly 500 tokens against a 3,000 cap, so 'length' was never
     * going to fire and the bare parse error was all that surfaced. */
    if (finish && finish !== 'stop') {
      throw new Error(
        `Structuring response ended with finish_reason='${finish}' on batch ${b + 1}/${batches.length} — the JSON is incomplete.`,
      );
    }

    const rawJson = resp.choices[0].message?.content;
    let data;
    try {
      data = JSON.parse(rawJson);
    } catch (e) {
      /* A parse position on its own says nothing about the cause — recovering
       * that for two files meant calibrating V8's error messages by hand to
       * learn the response had simply stopped early. Carrying the finish
       * reason, the length actually received and the tail makes the next
       * occurrence state its own cause. */
      throw new Error(
        `Structuring response did not parse as JSON on batch ${b + 1}/${batches.length}: ${e.message}. `
        + `finish_reason=${finish ?? 'null'}, received ${rawJson?.length ?? 0} chars, `
        + `ends: ${JSON.stringify(String(rawJson ?? '').slice(-100))}`,
      );
    }
    unit = unit || data.unit || null;

    for (const lesson of (data.lessons ?? [])) {
      if (!lesson.chunks?.length) continue;

      // Verbatim text is sliced directly from the ORIGINAL pages array using the
      // AI-reported marker range — never taken from anything the AI wrote itself,
      // so it can't be paraphrased. Locating a literal [[PAGE N]] marker is a much
      // more reliable task for the model than reproducing a passage verbatim.
      let verbatimText = null;
      if (pages?.length && lesson.marker_start && lesson.marker_end) {
        const start = Math.max(1, Math.min(pages.length, Math.round(lesson.marker_start)));
        const end   = Math.max(start, Math.min(pages.length, Math.round(lesson.marker_end)));
        verbatimText = pages.slice(start - 1, end).join('\n\n').trim() || null;
      }

      const key = (lesson.title || '').trim().toLowerCase();
      const existing = key && mergedLessons.find((l) => (l.title || '').trim().toLowerCase() === key);
      if (existing) {
        existing.chunks.push(...lesson.chunks);
        existing.page_start = existing.page_start != null ? Math.min(existing.page_start, lesson.page_start ?? existing.page_start) : lesson.page_start ?? null;
        existing.page_end   = existing.page_end   != null ? Math.max(existing.page_end,   lesson.page_end   ?? existing.page_end)   : lesson.page_end   ?? null;
        // Markers must widen too. buildKbRows filters figures and equations by
        // this range, so a chapter merged from four batches that kept only the
        // first batch's markers would silently drop every figure and equation
        // past its opening pages.
        existing.marker_start = existing.marker_start != null ? Math.min(existing.marker_start, lesson.marker_start ?? existing.marker_start) : lesson.marker_start ?? null;
        existing.marker_end   = existing.marker_end   != null ? Math.max(existing.marker_end,   lesson.marker_end   ?? existing.marker_end)   : lesson.marker_end   ?? null;
        if (verbatimText) existing.verbatimText = existing.verbatimText ? `${existing.verbatimText}\n\n${verbatimText}` : verbatimText;
      } else {
        mergedLessons.push({ ...lesson, chunks: [...lesson.chunks], verbatimText });
      }
    }
  }

  if (!mergedLessons.length) throw new Error('No content could be extracted.');
  return { unit, lessons: mergedLessons };
}

// chapters becomes 3 study_notes rows sharing the same `unit`, each with its
// own title and real page range, instead of one flattened blob.

/* ── Subject families ────────────────────────────────────────────────────
 *
 * The original content_type list describes STEM. Nothing in it fits a poem, a
 * primary-source extract or a balance-sheet format, so the 372 non-STEM files
 * would land almost entirely in 'prose' — the same hole 'exercise'/'activity'/
 * 'summary' were added to fill, at three times the scale.
 *
 * Rather than offer every subject all 21 values, each family gets the subset it
 * can actually use. A Physics chunk is never a 'poem' and offering the label is
 * pure downside: more ways to be wrong, and a split bucket for anything that
 * later filters on content_type.
 *
 * Scoping happens HERE, in the prompt, not in the DB. kb_content_type_chk is the
 * flat union of all four families (20260812050000) because a CHECK constraint
 * cannot see the row's subject without a much heavier trigger — and the prompt is
 * where a wrong label is prevented rather than merely rejected. Same shape as
 * PARTIAL_SYLLABUS_EXAM_TYPES scoping the closed-list rule per exam type.
 */

// Offered to every family: these describe a chunk's SHAPE, which is not a
// property of the subject. Every book has definitions, question sets, practical
// tasks, recaps, figures — and needs an honest catch-all.
const CORE_TYPES = ['definition', 'exercise', 'activity', 'summary', 'diagram', 'prose'];

export const SUBJECT_FAMILIES = {
  stem:       [...CORE_TYPES, 'theorem', 'law', 'formula', 'solved_example', 'derivation'],
  /* 'procedure' is shared with commerce, and it is here because a reader is not
   * only literature: Hornbill's second half is a WRITING SKILLS section —
   * Note-making, Summarising, Sub-titling, Essay-writing, Letter-writing,
   * Creative Writing (files kehb111-116, read from the book's own contents page
   * in Stage B). "How to make notes" is a method, not a literary text, and
   * without this it would have been forced into 'prose' or 'literary_prose' —
   * the second of which would have corrupted the very distinction
   * literary_prose exists to draw. Costs no migration: 'procedure' is already
   * in the 21-value union via commerce. */
  literature: [...CORE_TYPES, 'literary_prose', 'poem', 'drama', 'author_note', 'procedure'],
  social:     [...CORE_TYPES, 'event', 'case_study', 'source_extract', 'map_work'],
  // 'formula' and 'solved_example' are shared with stem, not duplicated concepts:
  // Statistics for Economics computes real means and Accountancy works real
  // problems. `commerce` names the CONTENT taxonomy, not the academic stream —
  // Computer Science and Informatics Practices sit here because their chunks are
  // procedures and worked problems, which is what the label has to describe.
  commerce:   [...CORE_TYPES, 'formula', 'solved_example', 'procedure', 'format_template'],
};

/* Derived, never hand-maintained: the union IS the families. A value that exists
 * in one but not here would be nulled by normaliseClassification() before the
 * insert — silently, with no error, just a NULL column. Deriving it makes that
 * class of drift impossible in this direction; the DB CHECK is the other half
 * and 20260812050000 carries the matching warning. */
export const CONTENT_TYPES = new Set(Object.values(SUBJECT_FAMILIES).flat());
export const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

/**
 * Which family a subject belongs to.
 *
 * Substring matching, most specific first — but note that no rule tests for
 * "science", because `stem` is the FALLBACK. That is deliberate: it removes the
 * ordering hazard that bit subjectForFolder(), where "Computer Science",
 * "Political Science" and "Social Science" were all swept up by a generic
 * /science/ match and had to be excluded by hand ahead of it.
 *
 * Unknown subjects fall to 'stem', which is exactly today's behaviour — this
 * change must not alter the classification of a single one of the 148 loaded
 * STEM files.
 *
 * AMBIGUOUS, AND LEFT TO STAGE D: Class 10 "Economics" is a book INSIDE Social
 * Science (jess2*, Understanding Economic Development), not the Class 11
 * commerce subject. It is Stage D's job to emit subject 'Social Science' with
 * book 'Economics' for that folder — if it emits 'Economics' this maps it to
 * commerce, which is the wrong family for a Class 10 social science book.
 */
export function familyForSubject(subject) {
  const s = String(subject ?? '').toLowerCase();

  if (/english|hindi|sanskrit|urdu|arabic|malayalam|tamil|literature/.test(s)) return 'literature';
  if (/history|geograph|political|sociolog|psycholog|social/.test(s))          return 'social';
  if (/account|business|economic|commerce|informatic|computer|entrepreneur/.test(s)) return 'commerce';

  return 'stem';
}

/* ── Per-family prompt blocks ────────────────────────────────────────────
 *
 * Three blocks vary by family: the content_type menu, the technique rule, and
 * what counts as a lesson. The `stem` text is byte-identical to what shipped
 * before this change — the 148 loaded STEM files must keep classifying exactly
 * as they did, so the STEM path is not "equivalent", it is the same string.
 *
 * Every new value carries a when-NOT-to-use line. That is what stopped 'prose'
 * swallowing exercises and activities, and the new values have the same failure
 * mode: a label with no boundary gets applied to everything adjacent to it.
 */

const LESSON_RULE_DEFAULT = `WHAT COUNTS AS A LESSON — read this before splitting anything:
A lesson is a WHOLE TEXTBOOK CHAPTER, the kind that appears as one line in a
Contents page ("A Square and A Cube", "Laws of Motion"). It is NOT a section,
sub-heading, worked-example block or topic within a chapter.

  Most uploads are ONE chapter. Default to returning a SINGLE lesson.
  Return more than one ONLY if the excerpt genuinely contains two or more
  separate numbered chapters.

  WRONG: one chapter split into "A Square and A Cube", "Understanding Perfect
         Squares", "Cubes and Cube Roots" — the last two are sections of the
         first, and splitting them corrupts chapter-level analytics downstream.
  RIGHT: one lesson "A Square and A Cube", whose CHUNKS carry those section
         names in their "heading" field.

Section headings belong in chunk headings. They never create a new lesson.`;

/* Literature is the one family where the granularity genuinely inverts. A reader
 * groups texts into units, and the unit is NOT the thing a student picks — the
 * individual text is. Feeding it LESSON_RULE_DEFAULT would return one lesson per
 * unit and bury three stories inside it, which is precisely the shape that had to
 * be retired from the Class 8 English syllabus last session. */
const LESSON_RULE_LITERATURE = `WHAT COUNTS AS A LESSON — read this before splitting anything:
A lesson is ONE TEXT: a single story, poem, essay or play — the kind that appears
as one line in a Contents page ("A Letter to God", "Dust of Snow").

  A literature reader groups its texts into UNITS or SECTIONS ("Wit and Wisdom",
  "Poetry"). A unit is NOT a lesson. Put its name in the top-level "unit" field
  and return each text inside it as its OWN lesson.

  WRONG: one lesson "Wit and Wisdom" containing three stories — that buries the
         three texts a student actually picks between.
  RIGHT: unit "Wit and Wisdom", and three lessons, one per story, each with its
         own title and its own page range.

  So: an upload of a single text returns ONE lesson. An upload of a whole unit
  returns ONE LESSON PER TEXT in it.

Divisions WITHIN a single text (scene numbers, stanza groups, parts) belong in
chunk headings. They never create a new lesson.`;

const TECHNIQUE_RULE_STEM = `- technique: array of solving techniques this chunk teaches or uses, as
  snake_case (e.g. ["dimensional_analysis","vector_resolution"]). Use [] when
  the chunk teaches no specific technique.`;

/* Owner decision, carried from the taxonomy handoff: `techniques` is free-text
 * STEM problem-solving vocabulary and is meaningless for prose. Left empty
 * rather than repurposed — an invented "technique" for a poem would be noise in
 * a column that is a real retrieval filter. normaliseClassification() already
 * coerces a missing/non-array value to [], so this instruction and the code
 * agree without a schema change. */
const TECHNIQUE_RULE_NON_STEM = `- technique: always return []. This field records STEM problem-solving methods
  and has no meaning for this material. Do not invent one.`;

const CONTENT_TYPE_GUIDES = {
  stem: `    "theorem"        a named, provable statement
    "law"            a stated physical/chemical law or principle
    "formula"        a formula/equation presented for use
    "definition"     a term being defined
    "solved_example" a worked problem WITH its solution
    "derivation"     a step-by-step derivation of a result
    "diagram"        content whose substance is a figure and its explanation
    "exercise"       UNSOLVED questions set for the student — a numbered
                     question list, "Exercises", "Questions", end-of-chapter
                     problems with no worked solution shown
    "activity"       a practical procedure to carry out — "Activity 6.3",
                     an experiment, an observation task
    "summary"        an end-of-chapter recap of points already covered
    "prose"          narrative/expository text that fits none of the above
  "exercise" vs "solved_example": if the solution is shown it is a
  solved_example; if the student is being asked to do it, it is an exercise.
  Use "prose" honestly when nothing else fits — do NOT inflate ordinary
  explanation into "theorem" or "law".`,

  literature: `    "literary_prose" the story or essay text ITSELF — the thing being studied
    "poem"           the poem text itself, or a stanza of it
    "drama"          the play text itself — a scene, or a passage of dialogue
    "author_note"    the "About the author" / "About the poet" box
    "procedure"      a composition or study METHOD being taught — "Note-making",
                     "Summarising", "Letter-writing". A reader's Writing Skills
                     section is procedures, not literature
    "definition"     a term being defined — a literary device, a glossed word
    "diagram"        content whose substance is an illustration and its caption
    "exercise"       UNSOLVED questions set for the student — comprehension
                     questions, "Thinking about the text", "Talk about it"
    "activity"       a task to carry out — a speaking, writing or project task
    "summary"        an end-of-chapter recap PRINTED IN THE BOOK
    "prose"          editorial text ABOUT the book that fits none of the above —
                     a preface, a note on how to use the reader
  THE DISTINCTION THAT MATTERS MOST: "literary_prose" is the text being STUDIED;
  "prose" is writing ABOUT the book. A story is literary_prose. An editor's
  foreword is prose. NEVER label the literary text itself as "prose".
  "summary" means a recap the book prints. If the book prints none, there is
  none — do not write a plot summary and label it that.
  "procedure" vs "exercise": teaching the student HOW to summarise is a
  procedure; asking them to summarise a given passage is an exercise.`,

  social: `    "event"          a dated historical happening, narrated as such
    "case_study"     a named, bounded real-world example the chapter reasons
                     FROM — "The Bhopal Gas Tragedy", "Amul: a cooperative"
    "source_extract" a PRIMARY SOURCE reproduced in the book — a treaty clause,
                     a census table, a speech, a letter, an eyewitness account.
                     Usually boxed and attributed to a person, document or year
    "map_work"       a map and the geographical reading it is used for
    "definition"     a term being defined — a concept, an -ism, a technical term
    "diagram"        content whose substance is a figure, chart or photograph
                     and its explanation
    "exercise"       UNSOLVED questions set for the student
    "activity"       a task to carry out — fieldwork, a survey, a debate
    "summary"        an end-of-chapter recap of points already covered
    "prose"          narrative/expository text that fits none of the above
  "source_extract" vs "prose": a source is the book QUOTING evidence, normally
  attributed. The textbook's OWN narration is "event" if it is a dated
  happening, otherwise "prose".
  "case_study" vs "event": a case study is reasoned from to make a general
  point; an event is narrated as part of the historical account.`,

  commerce: `    "procedure"       an ordered method to carry out — passing a journal entry,
                      preparing a bank reconciliation, normalising a table
    "format_template" a ruled LAYOUT to be reproduced — a trial balance, a
                      ledger account, a balance sheet skeleton, a table schema
    "solved_example"  a worked problem WITH its solution
    "formula"         a formula or ratio presented for use
    "definition"      a term being defined
    "diagram"         content whose substance is a figure, chart or screenshot
                      and its explanation
    "exercise"        UNSOLVED questions set for the student
    "activity"        a practical task to carry out
    "summary"         an end-of-chapter recap of points already covered
    "prose"           narrative/expository text that fits none of the above
  "procedure" vs "solved_example": a procedure is the general METHOD with no
  specific figures attached; a solved_example applies it to real numbers and
  shows the result.
  "format_template" is the EMPTY shape — the ruled form itself. Once it is filled
  with a particular firm's numbers and worked through, it is a solved_example.`,
};

/** The three prompt blocks that vary by subject family. */
export function promptGuideFor(subject) {
  const family = familyForSubject(subject);
  return {
    family,
    contentTypes:  CONTENT_TYPE_GUIDES[family],
    techniqueRule: family === 'stem' ? TECHNIQUE_RULE_STEM : TECHNIQUE_RULE_NON_STEM,
    lessonRule:    family === 'literature' ? LESSON_RULE_LITERATURE : LESSON_RULE_DEFAULT,
  };
}

/**
 * The classification fields are model output going straight into CHECK-
 * constrained columns, so anything unrecognised becomes NULL rather than
 * failing the insert. A mislabelled chunk is a retrieval-quality problem;
 * a rejected insert loses the whole upload.
 */
export function normaliseClassification(c) {
  const ct = String(c.content_type ?? '').toLowerCase().trim();
  const df = String(c.difficulty ?? '').toLowerCase().trim();
  const conf = Number(c.confidence);
  return {
    content_type: CONTENT_TYPES.has(ct) ? ct : null,
    difficulty:   DIFFICULTIES.has(df) ? df : null,
    techniques:   Array.isArray(c.technique)
      ? c.technique.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 8)
      : [],
    confidence:   Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null,
  };
}

/**
 * Equations the structuring pass harvested from a chunk's TEXT layer.
 *
 * Vision only runs on pages that trip the thin-text or raster-image gate, so on
 * a clean typeset chapter it never fires and every equation in the book would
 * otherwise be lost. This is the text-layer half of that pair; buildKbRows
 * unions the two.
 */
export function chunkLatex(c) {
  return Array.isArray(c?.latex)
    ? c.latex.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim()).slice(0, 25)
    : [];
}

/** Class level as a bare string ("10"), parsed out of "CBSE Class 10". */
export function classLevelFromExamType(examType) {
  return examType?.match(/Class\s+(\d+)/i)?.[1] ?? null;
}

/** Figures that fall inside a lesson's [[PAGE N]] marker range. */
export function figuresForLesson(lesson, figures = []) {
  const mStart = lesson.marker_start ?? null;
  const mEnd   = lesson.marker_end ?? null;
  return figures.filter(
    (f) => mStart == null || mEnd == null || (f.page_no >= mStart && f.page_no <= mEnd),
  );
}

/**
 * Maps figures onto content_figures rows. Figures are recorded whether or not
 * any chunk claimed one — they're a per-chapter asset, not a per-chunk one.
 */
export function buildFigureRows(figures, { sourceTable = 'knowledge_base', sourceId = null, examType, subject, chapter }) {
  return figures.map((f) => ({
    source_table: sourceTable,
    source_id:    sourceId,
    exam_type:    examType || null,
    subject:      subject || null,
    chapter:      chapter || null,
    page_no:      f.page_no,
    image_url:    f.image_url,
    caption:      f.caption,
    kind:         f.kind,
    bbox:         f.bbox,
  }));
}

/**
 * Maps one lesson's chunks onto knowledge_base rows.
 *
 * Figures and equations are discovered per PAGE, but chunks are semantic and
 * carry no page number of their own — the lesson's [[PAGE N]] marker range is
 * the only link between the two. So a lesson inherits whatever fell inside its
 * range. That is page-level association, not per-chunk; precise chunk-to-figure
 * binding is a later refinement.
 */
export function buildKbRows({
  lesson, chapterName, chapterKey = null, book = null, unit, subject, examType, source,
  figures = [], equationsByPage = {},
}) {
  const classLevel = classLevelFromExamType(examType);
  const mStart = lesson.marker_start ?? null;
  const mEnd   = lesson.marker_end ?? null;
  const inRange = (p) => mStart == null || mEnd == null || (p >= mStart && p <= mEnd);

  const lessonFigures = figuresForLesson(lesson, figures);
  const lessonLatex = Object.entries(equationsByPage)
    .filter(([p]) => inRange(Number(p)))
    .flatMap(([, list]) => list);

  return (lesson.chunks ?? []).map((c) => {
    const cls = normaliseClassification(c);
    // Only bind a figure to a chunk when the attribution is defensible: the
    // chunk IS a diagram, or the lesson has exactly one figure so there is
    // nothing to get wrong. Everything else is left to content_figures, which
    // is queryable by chapter + page.
    const figure = cls.content_type === 'diagram' || lessonFigures.length === 1
      ? lessonFigures[0] ?? null
      : null;

    // Text-layer equations are per-chunk and precise; vision equations are only
    // known per-page, so the lesson's whole set is inherited. Chunk-level wins
    // the head of the list because it is the better-attributed of the two.
    const latex = [...new Set([...chunkLatex(c), ...lessonLatex])].slice(0, 25);

    return {
      content:       `${c.heading}\n\n${c.content}`,
      subject,
      exam_type:     examType || null,
      chapter:       chapterName,
      // Ordinal-anchored identity (Phase 2 of the rebuild, src/lib/
      // chapterIdentity.js assignChapters()) — null for any book without an
      // approved manifest yet, meaning "no chapter_key system available for
      // this book", not "unknown". `chapter` (above) stays the display label
      // either way. See docs/REBUILD_HANDOFF.md Phase 2.
      chapter_key:   chapterKey,
      book,
      class_level:   classLevel,
      unit:          unit || null,
      keywords:      Array.isArray(c.keywords) ? c.keywords.filter(Boolean).slice(0, 12) : [],
      ...cls,
      page_no:       mStart ?? null,
      figure_url:    figure?.image_url ?? null,
      has_equations: latex.length > 0,
      latex,
      source_ref: {
        source,
        lesson_title: lesson.title ?? chapterName,
        page_start:   lesson.page_start ?? null,
        page_end:     lesson.page_end ?? null,
      },
    };
  });
}
