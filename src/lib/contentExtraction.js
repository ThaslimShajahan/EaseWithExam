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


export async function runPYQExtraction({ rawText, examType, subject, year, onProgress }) {
  const isMixed = subject === 'Mixed';
  const batches = splitIntoBatches(rawText);
  const allQuestions = [];
  let paperTitle = null, totalMarks = null;

  for (let b = 0; b < batches.length; b++) {
    onProgress(batches.length > 1 ? `AI extracting questions… (part ${b + 1}/${batches.length})` : 'AI extracting questions…');

    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      16000,
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

    const data = JSON.parse(resp.choices[0].message.content);
    allQuestions.push(...(data.questions ?? []));
    paperTitle = paperTitle || data.paper_title;
    totalMarks = totalMarks || data.total_marks;
  }

  if (!allQuestions.length) throw new Error('No questions found. Check if this is a text-based PDF.');
  return { questions: allQuestions, paperTitle, totalMarks };
}

export async function runNotesExtraction({ rawText, pages, examType, subject, onProgress }) {
  const batches = splitIntoBatches(rawText);
  const mergedLessons = []; // preserves first-seen order across batches
  let unit = null;

  for (let b = 0; b < batches.length; b++) {
    onProgress(batches.length > 1 ? `AI structuring study notes… (part ${b + 1}/${batches.length})` : 'AI structuring study notes…');

    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      16000,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You structure textbook/study material PDFs into their real table-of-contents shape (unit, individual lessons/chapters, and the page range each one actually spans) and break each lesson into searchable knowledge chunks. Return only valid JSON. Use the page numbers as they actually appear printed in the PDF — do not invent them. This may be one part of a larger unit split across multiple calls — only extract lessons/chunks whose content appears in THIS excerpt; if a lesson clearly continues from where it left off, reuse the SAME title so it can be merged back together.',
        },
        {
          role: 'user',
          content: `This is ${examType} ${subject} content, possibly spanning one unit with multiple lessons/chapters (like a textbook "Contents" page), or just a single chapter — read the actual content and structure it correctly either way.${batches.length > 1 ? ` (excerpt ${b + 1} of ${batches.length} of a larger unit)` : ''}

Each page in CONTENT below is prefixed with a literal [[PAGE N]] marker.

For each distinct lesson/chapter you find, extract:
- title: its real title, from the content (e.g. a story/chapter name) — not a generic label
- page_start / page_end: the actual printed page numbers this lesson spans, as they visibly appear in the text (e.g. a running header showing "23"). Use null if you can't tell.
- marker_start / marker_end: the [[PAGE N]] marker numbers where this lesson's content begins and ends — NOT the printed page numbers, just which markers it falls between. Always fill these in, they're always visible.
- chunks: 100–300 word self-contained knowledge chunks covering that lesson's content, each with a heading, keywords, and the classification fields described below.

If the whole upload is really just one chapter/topic, return a single lesson.

CHUNK CLASSIFICATION — every chunk needs these, they drive retrieval filtering:
- content_type: exactly one of
    "theorem"        a named, provable statement
    "law"            a stated physical/chemical law or principle
    "formula"        a formula/equation presented for use
    "definition"     a term being defined
    "solved_example" a worked problem WITH its solution
    "derivation"     a step-by-step derivation of a result
    "diagram"        content whose substance is a figure and its explanation
    "prose"          narrative/expository text that fits none of the above
  Use "prose" honestly when nothing else fits — do NOT inflate ordinary
  explanation into "theorem" or "law".
- technique: array of solving techniques this chunk teaches or uses, as
  snake_case (e.g. ["dimensional_analysis","vector_resolution"]). Use [] when
  the chunk teaches no specific technique.
- difficulty: "easy" | "medium" | "hard" — relative to the target exam level.
- confidence: 0.0-1.0, how confident you are in the content_type label. Use a
  low value when the chunk is genuinely mixed rather than forcing a guess.

Return JSON:
{
  "unit": "Unit name if this content is part of a numbered/named unit, else null",
  "lessons": [
    {
      "title": "chapter/lesson title",
      "page_start": 2, "page_end": 8,
      "marker_start": 1, "marker_end": 7,
      "chunks": [ {
        "heading": "concept name",
        "content": "explanation",
        "keywords": ["kw1","kw2"],
        "content_type": "formula",
        "technique": ["vector_resolution"],
        "difficulty": "medium",
        "confidence": 0.9
      } ]
    }
  ]
}

CONTENT:
${batches[b]}`,
        },
      ],
    });

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
  'theorem', 'law', 'formula', 'definition', 'solved_example', 'derivation', 'diagram', 'prose',
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
      has_equations: lessonLatex.length > 0,
      latex:         lessonLatex.slice(0, 25),
      source_ref: {
        source,
        lesson_title: lesson.title ?? chapterName,
        page_start:   lesson.page_start ?? null,
        page_end:     lesson.page_end ?? null,
      },
    };
  });
}
