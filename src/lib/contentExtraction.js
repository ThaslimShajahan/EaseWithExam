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
 */
const PYQ_BATCH_CHARS = 12000;
const PYQ_MAX_TOKENS  = 5000;

export async function runPYQExtraction({ rawText, examType, subject, year, onProgress }) {
  const isMixed = subject === 'Mixed';
  const batches = splitIntoBatches(rawText, PYQ_BATCH_CHARS);
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

Extract every question. For each include:
- Full question text
- Section label (A/B/C/D/E or blank)
- Marks per question
- Question type (MCQ / Short Answer / Long Answer / Numerical / Assertion-Reason / Case-Based)
- Chapter or topic — identify this from the actual content, as precisely as you can
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

WHAT COUNTS AS A LESSON — read this before splitting anything:
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

Section headings belong in chunk headings. They never create a new lesson.

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
    "theorem"        a named, provable statement
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
  explanation into "theorem" or "law".
- technique: array of solving techniques this chunk teaches or uses, as
  snake_case (e.g. ["dimensional_analysis","vector_resolution"]). Use [] when
  the chunk teaches no specific technique.
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

CONTENT:
${batches[b]}`,
        },
      ],
    });

    // A truncated response is a cut-off JSON string, so JSON.parse below would
    // fail with a position offset that says nothing about the cause. Naming it
    // here is the difference between "max_tokens is too low" and a mystery.
    if (resp.choices[0].finish_reason === 'length') {
      throw new Error(
        `Structuring response hit the ${NOTES_MAX_TOKENS}-token output cap on batch ${b + 1}/${batches.length} — raise NOTES_MAX_TOKENS or lower NOTES_BATCH_CHARS.`,
      );
    }

    const data = JSON.parse(resp.choices[0].message.content);
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
export const CONTENT_TYPES = new Set([
  'theorem', 'law', 'formula', 'definition', 'solved_example', 'derivation', 'diagram',
  // Added after the full corpus load: NCERT spends real page area on unsolved
  // question sets, practical activities and end-of-chapter recaps, and with no
  // bucket for them all three were landing in 'prose'.
  'exercise', 'activity', 'summary',
  'prose',
]);
export const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

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
  lesson, chapterName, unit, subject, examType, source,
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
