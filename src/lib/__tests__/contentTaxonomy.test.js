/**
 * Stage A of the non-STEM corpus load: the taxonomy extension.
 *
 * Both halves, deliberately. A test that only proves the new non-STEM values
 * exist would pass just as happily if the change had also altered how the 148
 * already-loaded STEM files classify — which is the actual risk here, since this
 * edits the single prompt every corpus load has ever gone through.
 *
 *   half 1 — PERMITTED/UNCHANGED: every STEM subject still resolves to `stem`,
 *            and the three STEM prompt blocks are byte-identical to the strings
 *            that shipped before this change.
 *   half 2 — DENIED: the new values are genuinely scoped, a value outside the
 *            union is dropped rather than inserted, and the two colliding
 *            chapter-1 rows are distinguishable — with the naive key asserted to
 *            collide, so the test says WHY the fix works and not merely that it
 *            does.
 */
import { describe, it, expect } from 'vitest';
import {
  SUBJECT_FAMILIES, CONTENT_TYPES, familyForSubject, promptGuideFor,
  normaliseClassification,
} from '../contentExtraction';
import { chapterKeyFor } from '../syllabus';

/* The exact strings the prompt carried before this change, lifted from git.
 * Their job is to fail loudly if the STEM path is ever "tidied" — the 148 loaded
 * files were classified by these words, and a reworded menu silently reclassifies
 * every future load against a corpus labelled by the old one. */
const STEM_CONTENT_TYPES_BEFORE = `    "theorem"        a named, provable statement
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
  explanation into "theorem" or "law".`;

const STEM_TECHNIQUE_BEFORE = `- technique: array of solving techniques this chunk teaches or uses, as
  snake_case (e.g. ["dimensional_analysis","vector_resolution"]). Use [] when
  the chunk teaches no specific technique.`;

const STEM_LESSON_RULE_BEFORE = `WHAT COUNTS AS A LESSON — read this before splitting anything:
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

/* The 11 values every one of the ~4,363 loaded chunks was classified against. */
const ORIGINAL_TYPES = [
  'theorem', 'law', 'formula', 'definition', 'solved_example', 'derivation',
  'diagram', 'exercise', 'activity', 'summary', 'prose',
];

/* ── HALF 1: the STEM path is unchanged ──────────────────────────────── */

describe('STEM classification is untouched by the non-STEM extension', () => {
  // Every subject that actually has loaded content today (docs/content-index.csv).
  it.each([
    'Mathematics', 'Science', 'Physics', 'Chemistry', 'Biology', 'Biotechnology',
  ])('%s still resolves to the stem family', (subject) => {
    expect(familyForSubject(subject)).toBe('stem');
  });

  it('offers STEM exactly the 11 original values — no more, no fewer', () => {
    expect([...SUBJECT_FAMILIES.stem].sort()).toEqual([...ORIGINAL_TYPES].sort());
  });

  it('keeps the STEM prompt blocks byte-identical', () => {
    const g = promptGuideFor('Physics');
    expect(g.contentTypes).toBe(STEM_CONTENT_TYPES_BEFORE);
    expect(g.techniqueRule).toBe(STEM_TECHNIQUE_BEFORE);
    expect(g.lessonRule).toBe(STEM_LESSON_RULE_BEFORE);
  });

  it('still accepts every originally-valid content_type', () => {
    for (const t of ORIGINAL_TYPES) {
      expect(normaliseClassification({ content_type: t }).content_type).toBe(t);
    }
  });

  it('leaves single-book chapter_keys in their existing shape', () => {
    // These are real keys already in syllabus_nodes. A change here would orphan
    // every flashcard and syllabus-tracker row keyed on them.
    expect(chapterKeyFor({ classLevel: '10', chapterName: 'Real Numbers' }))
      .toBe('c10_real_numbers');
    expect(chapterKeyFor({ prefix: 'k', classLevel: '10', chapterName: 'Arithmetic Sequences' }))
      .toBe('k10_arithmetic_sequences');
  });
});

/* ── HALF 2: the new behaviour genuinely fires ───────────────────────── */

describe('non-STEM subjects reach their own family', () => {
  it.each([
    ['English', 'literature'], ['Hindi', 'literature'],
    ['History', 'social'], ['Geography', 'social'], ['Political Science', 'social'],
    ['Sociology', 'social'], ['Psychology', 'social'], ['Social Science', 'social'],
    ['Accountancy', 'commerce'], ['Business Studies', 'commerce'],
    ['Economics', 'commerce'], ['Informatics Practices', 'commerce'],
    ['Computer Science', 'commerce'],
  ])('%s -> %s', (subject, family) => {
    expect(familyForSubject(subject)).toBe(family);
  });

  /* The ordering hazard that bit subjectForFolder(), where a generic /science/
   * match swept up all three and they had to be excluded by hand ahead of it.
   * Here `stem` is the fallback and no rule tests for "science" at all, so these
   * cannot regress the same way — but assert it, because the next person to add
   * a rule is the one who could break it. */
  it('does not mistake the three "... Science" subjects for STEM', () => {
    expect(familyForSubject('Computer Science')).not.toBe('stem');
    expect(familyForSubject('Political Science')).not.toBe('stem');
    expect(familyForSubject('Social Science')).not.toBe('stem');
  });

  it('falls back to stem for an unknown subject', () => {
    // Preserves today's behaviour for anything not yet mapped, rather than
    // failing a load or inventing a family for it.
    expect(familyForSubject('Physical Education')).toBe('stem');
    expect(familyForSubject('')).toBe('stem');
    expect(familyForSubject(undefined)).toBe('stem');
  });
});

describe('content_type scoping', () => {
  it('offers each family only its own values', () => {
    expect(SUBJECT_FAMILIES.literature).toContain('poem');
    expect(SUBJECT_FAMILIES.social).toContain('source_extract');
    expect(SUBJECT_FAMILIES.commerce).toContain('format_template');

    // The point of scoping: a Physics chunk is never offered "poem".
    expect(SUBJECT_FAMILIES.stem).not.toContain('poem');
    expect(SUBJECT_FAMILIES.stem).not.toContain('source_extract');
    expect(SUBJECT_FAMILIES.literature).not.toContain('theorem');
    expect(SUBJECT_FAMILIES.social).not.toContain('poem');
  });

  /* Stage B, from Hornbill's own contents page: files kehb111-116 are a WRITING
   * SKILLS section (Note-making, Summarising, Letter-writing...), not the poems
   * an earlier reading of the file codes assumed. A reader is not only
   * literature, and without 'procedure' those six would have been forced into
   * 'literary_prose' — corrupting the exact distinction it exists to draw. */
  it('offers literature `procedure` for a reader\'s Writing Skills section', () => {
    expect(SUBJECT_FAMILIES.literature).toContain('procedure');
    expect(promptGuideFor('English').contentTypes).toContain('Writing Skills');
    // Shared with commerce, so it adds nothing to the union and needs no migration.
    expect(SUBJECT_FAMILIES.commerce).toContain('procedure');
  });

  it('is a union of exactly 21 values, adding 10 to the original 11', () => {
    expect(CONTENT_TYPES.size).toBe(21);
    for (const t of ORIGINAL_TYPES) expect(CONTENT_TYPES.has(t)).toBe(true);
    const added = [...CONTENT_TYPES].filter((t) => !ORIGINAL_TYPES.includes(t));
    expect(added.sort()).toEqual([
      'author_note', 'case_study', 'drama', 'event', 'format_template',
      'literary_prose', 'map_work', 'poem', 'procedure', 'source_extract',
    ]);
  });

  /* The values the original sketch proposed that were deliberately NOT added,
   * because each is a near-synonym of one already in use and a redundant value
   * is a coin-flip for the classifier. */
  it('does not add near-synonyms of existing values', () => {
    expect(CONTENT_TYPES.has('concept')).toBe(false);           // -> definition
    expect(CONTENT_TYPES.has('worked_problem')).toBe(false);    // -> solved_example
    expect(CONTENT_TYPES.has('comprehension_exercise')).toBe(false); // -> exercise
  });

  it('keeps literature narrative OUT of the prose catch-all', () => {
    // 'prose' share is the diagnostic that justified adding exercise/activity/
    // summary. If stories land in it, that number stops meaning anything.
    expect(CONTENT_TYPES.has('literary_prose')).toBe(true);
    const g = promptGuideFor('English');
    expect(g.contentTypes).toContain('NEVER label the literary text itself as "prose"');
  });

  it('drops a value outside the union instead of inserting it', () => {
    // normaliseClassification runs before the insert; the DB CHECK is the second
    // line of defence, not the first. An unknown label becomes NULL, which is a
    // retrieval-quality problem — not a rejected insert that loses the upload.
    expect(normaliseClassification({ content_type: 'poem_extract' }).content_type).toBeNull();
    expect(normaliseClassification({ content_type: 'concept' }).content_type).toBeNull();
  });
});

describe('non-STEM prompt rules', () => {
  it('tells non-STEM to leave technique empty', () => {
    for (const s of ['English', 'History', 'Accountancy']) {
      expect(promptGuideFor(s).techniqueRule).toContain('always return []');
    }
  });

  it('coerces a missing technique to [] so the instruction and the code agree', () => {
    expect(normaliseClassification({ content_type: 'poem' }).techniques).toEqual([]);
    expect(normaliseClassification({ content_type: 'poem', technique: null }).techniques).toEqual([]);
  });

  /* Owner decision: a literature "chapter" is the individual text, not the book
   * unit. LESSON_RULE_DEFAULT would return one lesson per unit and bury the three
   * stories inside it — the exact shape retired from the Class 8 English
   * syllabus last session. */
  it('inverts the lesson rule for literature only', () => {
    const lit = promptGuideFor('English').lessonRule;
    expect(lit).toContain('A lesson is ONE TEXT');
    expect(lit).toContain('A unit is NOT a lesson');

    for (const s of ['Physics', 'History', 'Accountancy']) {
      expect(promptGuideFor(s).lessonRule).toBe(STEM_LESSON_RULE_BEFORE);
    }
  });
});

/* ── HALF 2b: the collision the whole `book` dimension exists to stop ── */

describe('multi-book chapter_key collision', () => {
  // The eight subjects that are two separate textbooks, each numbering from 1.
  const PAIRS = [
    { classLevel: '11', books: ['Hornbill', 'Woven Words'],      chapter: 'Chapter 1' },
    { classLevel: '11', books: ['Political Theory', 'Constitution at Work'], chapter: 'Introduction' },
    { classLevel: '11', books: ['Indian Economic Development', 'Statistics for Economics'], chapter: 'Introduction' },
    { classLevel: '11', books: ['Sociology', 'Understanding Society'], chapter: 'Introduction' },
    { classLevel: '11', books: ['Accountancy', 'Accountancy II'], chapter: 'Introduction to Accounting' },
    { classLevel: '10', books: ['Sparsh', 'Sanchayan'],          chapter: 'Chapter 1' },
  ];

  it.each(PAIRS)('$books distinguishes its chapter-1 rows', ({ classLevel, books, chapter }) => {
    const [a, b] = books.map((book) => chapterKeyFor({ classLevel, book, chapterName: chapter }));
    expect(a).not.toBe(b);
  });

  /* The half that says WHY. Without the book in the key these two rows collide
   * under UNIQUE (exam_type, subject, chapter_key) and the second insert is
   * silently lost — which is the failure this stage exists to prevent, not a
   * hypothetical. */
  it('collides without the book — the naive key is the bug', () => {
    const naive = (chapterName) => chapterKeyFor({ classLevel: '11', chapterName });
    expect(naive('Introduction')).toBe(naive('Introduction'));

    const scoped = (book) => chapterKeyFor({ classLevel: '11', book, chapterName: 'Introduction' });
    expect(scoped('Political Theory')).toBe('c11_political_theory_introduction');
    expect(scoped('Constitution at Work')).toBe('c11_constitution_at_work_introduction');
    expect(scoped('Political Theory')).not.toBe(scoped('Constitution at Work'));
  });
});
