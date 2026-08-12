/**
 * Corpus file -> (exam_type, subject, book) resolution.
 *
 * `subjectForFolder()` in scripts/bulk-load-corpus.mjs answers "is this STEM?"
 * with a handful of substring tests and returns null for everything else. That
 * was correct while only STEM was loaded. It cannot express the three things the
 * non-STEM corpus needs:
 *
 *   1. WHICH BOOK a file belongs to, for the subjects taught from two separate
 *      textbooks that each number chapters from 1.
 *   2. That a file's content belongs to a DIFFERENT book's chapters — the
 *      workbook case below.
 *   3. That some books are absent, so a present book must still be labelled.
 *
 * Every entry here was verified in Stage B by reading the book's own contents
 * page and reconciling it against the file count. No entry is inferred from a
 * folder name, because folder names in this corpus are wrong often enough to
 * matter: `KRITHIKA 2/` holds Kshitij, `GEOGRAPHY/` holds kegy2* codes for a
 * book NCERT codes kegy1, and `full unit.pdf` is an audio-transcript appendix.
 *
 * PURE. No fs, no network — so the loader and the tests exercise one code path.
 */

/* ── The workbook case ───────────────────────────────────────────────────
 *
 * Words and Expressions II is not a set of texts. Its 9 units carry the SAME
 * TITLES as First Flight's 9 chapters because it is exercises ON those texts.
 * Owner decision 2026-08-12: it gets NO chapter rows of its own — its content
 * attaches to First Flight's chapters as content_type 'exercise'.
 *
 * Giving it its own rows would have been one line of config, and would have put
 * every Class 10 English title in front of the student twice.
 */

/** First Flight's units, in printed order, from its own contents page.
 *
 * `chapters` is a LIST because chapter 3 is one printed chapter containing two
 * distinct stories, split into two chapter rows per the per-text ruling. Every
 * other unit has exactly one. A workbook file therefore resolves to a unit
 * deterministically, and to a chapter deterministically EXCEPT at unit 3, where
 * the two candidates are handed to matchSyllabusChapter rather than guessed. */
export const FIRST_FLIGHT_UNITS = [
  { unit: 'A Letter to God',                     chapters: ['A Letter to God'] },
  { unit: 'Nelson Mandela: Long Walk to Freedom', chapters: ['Nelson Mandela: Long Walk to Freedom'] },
  { unit: 'Two Stories about Flying',            chapters: ['His First Flight', 'Black Aeroplane'] },
  { unit: 'From the Diary of Anne Frank',        chapters: ['From the Diary of Anne Frank'] },
  { unit: 'Glimpses of India',                   chapters: ['Glimpses of India'] },
  { unit: 'Mijbil the Otter',                    chapters: ['Mijbil the Otter'] },
  { unit: 'Madam Rides the Bus',                 chapters: ['Madam Rides the Bus'] },
  { unit: 'The Sermon at Benares',               chapters: ['The Sermon at Benares'] },
  { unit: 'The Proposal',                        chapters: ['The Proposal'] },
];

/* ── Book table ──────────────────────────────────────────────────────────
 *
 * `folder` is matched against the corpus-relative path. Order matters only where
 * one pattern would also match another's path; the patterns are written to be
 * mutually exclusive instead of relying on order.
 *
 * `book: null` means a single-book subject — the case for all STEM and for the
 * subjects whose two volumes number continuously (Accountancy Part I/II).
 */
export const BOOKS = [
  /* Class 11 — English */
  { folder: /ENGLISH HORN BILL/i,   examType: 'CBSE Class 11', subject: 'English', book: 'Hornbill' },
  { folder: /ENGLISH WOOVEN WORDS/i, examType: 'CBSE Class 11', subject: 'English', book: 'Woven Words' },

  /* Class 11 — the separate-book pairs */
  { folder: /ECONOMICS - ECONOMIC DEVELOPMENT/i,      examType: 'CBSE Class 11', subject: 'Economics',         book: 'Indian Economic Development' },
  { folder: /ECONOMICS 2 STATITICS FOR ECONOMICS/i,   examType: 'CBSE Class 11', subject: 'Economics',         book: 'Statistics for Economics' },
  { folder: /POLITICAL SCIENCE POLITICAL THEORY/i,    examType: 'CBSE Class 11', subject: 'Political Science', book: 'Political Theory' },
  { folder: /POLITICAL SCIENCE INDIAN CONSTITUTION/i, examType: 'CBSE Class 11', subject: 'Political Science', book: 'Constitution at Work' },
  { folder: /SOCIOLOGY UNDERSTANDING SOCIETY/i,       examType: 'CBSE Class 11', subject: 'Sociology',         book: 'Understanding Society' },
  /* Trailing slash, not `$`: the pattern is matched against the whole relative
   * path, so "SOCIOLOGY" is never at the end of it. "SOCIOLOGY/" appears only in
   * this book's path — the sibling folder reads "SOCIOLOGY UNDERSTANDING
   * SOCIETY/" — which keeps the two mutually exclusive rather than
   * order-dependent. */
  { folder: /SOCIOLOGY\//i,                           examType: 'CBSE Class 11', subject: 'Sociology',         book: 'Introducing Sociology' },

  /* Class 11 — single-book subjects.
   * Geography is labelled even though only one book is present: NCERT pairs it
   * with `India: Physical Environment`, which is absent from this corpus. See
   * the rule in ACTION_ITEMS — labelling now costs nothing, and NOT labelling
   * costs a chapter_key rewrite when the second book arrives, on keys that
   * flashcards and the syllabus tracker point at. */
  { folder: /11 NCRT SC\/GEOGRAPHY/i,     examType: 'CBSE Class 11', subject: 'Geography',   book: 'Fundamentals of Physical Geography' },
  { folder: /HISTORY- THEMES IN WORLD/i,  examType: 'CBSE Class 11', subject: 'History',     book: null },
  { folder: /PSYCHOLOGY/i,                examType: 'CBSE Class 11', subject: 'Psychology',  book: null },
  { folder: /BUSINESS STUDIES/i,          examType: 'CBSE Class 11', subject: 'Business Studies',      book: null },
  { folder: /COMPUTER SCIENCE/i,          examType: 'CBSE Class 11', subject: 'Computer Science',      book: null },
  { folder: /INFORMATIC PRACTICES/i,      examType: 'CBSE Class 11', subject: 'Informatics Practices', book: null },

  /* Accountancy is ONE book in two volumes, not a pair: Part I runs chapters
   * 1-7 ending page 268 and Part II runs 8-9 starting page 277. Continuous
   * chapters AND continuous pagination, so `book` stays null and the two
   * folders resolve identically — exactly like `chemistry part 1`/`part 2`. */
  { folder: /accountancy ii/i, examType: 'CBSE Class 11', subject: 'Accountancy', book: null },
  { folder: /ACCOUNTANCY/i,    examType: 'CBSE Class 11', subject: 'Accountancy', book: null },

  /* Class 10 — English. The workbook attaches to the reader. */
  { folder: /english first flight/i,     examType: 'CBSE Class 10', subject: 'English', book: 'First Flight' },
  { folder: /FOOTPRINT WITHOUT FEET/i,   examType: 'CBSE Class 10', subject: 'English', book: 'Footprints Without Feet' },
  {
    folder: /word and expression ii/i,
    examType: 'CBSE Class 10', subject: 'English',
    book: 'First Flight',              // the chunks land on FIRST FLIGHT's rows
    attachesTo: 'First Flight',        // ...and this says so explicitly
    contentTypeOverride: 'exercise',
    units: FIRST_FLIGHT_UNITS,
  },

  /* Class 10 — Social Science is four separate books under one subject. */
  { folder: /10 social\/GEOGRAPHY/i, examType: 'CBSE Class 10', subject: 'Social Science', book: 'Contemporary India II' },
  { folder: /10 social\/ECONOMICS/i, examType: 'CBSE Class 10', subject: 'Social Science', book: 'Understanding Economic Development' },
  { folder: /10 social\/HISTORY/i,   examType: 'CBSE Class 10', subject: 'Social Science', book: 'India and the Contemporary World II' },
  { folder: /10 social\/POLITICS/i,  examType: 'CBSE Class 10', subject: 'Social Science', book: 'Democratic Politics II' },

  /* Classes 8 and 9 — NEP-2020 editions, each a single book. Both Social
   * volumes are PART 1; Part 2 is absent from the corpus. */
  { folder: /9 ENGLISH/i,               examType: 'CBSE Class 9', subject: 'English',        book: 'Kaveri' },
  { folder: /9 SOCIAL/i,                examType: 'CBSE Class 9', subject: 'Social Science', book: 'Understanding Society: India and Beyond' },
  { folder: /CLASS 8 ENGLISH/i,         examType: 'CBSE Class 8', subject: 'English',        book: 'Poorvi' },
  { folder: /CLASS 8 SOCIAL/i,          examType: 'CBSE Class 8', subject: 'Social Science', book: 'Exploring Society: India and Beyond' },
];

/**
 * Resolves a corpus-relative path to its book.
 *
 * Returns null when nothing matches — which is how STEM and the deferred Hindi
 * books fall through. A null is "not mine to load", never an error.
 */
export function resolveCorpusFile(relPath) {
  const p = String(relPath ?? '').split('\\').join('/');
  const hit = BOOKS.find((b) => b.folder.test(p));
  if (!hit) return null;

  return {
    examType:            hit.examType,
    subject:             hit.subject,
    book:                hit.book ?? null,
    attachesTo:          hit.attachesTo ?? null,
    contentTypeOverride: hit.contentTypeOverride ?? null,
  };
}

/**
 * For a workbook file, the reader unit its content belongs to.
 *
 * Ordinal, not title-matched: `jewe203.pdf` is Words and Expressions Unit 3, and
 * Unit N always covers reader chapter N. Title matching would ALSO work for 8 of
 * the 9 — and would silently fail on unit 3, whose printed title ("Two Stories
 * about Flying") matches neither of the two chapter rows it split into.
 *
 * `chapters` therefore carries one candidate for units 1-2 and 4-9, and TWO for
 * unit 3. Callers must pass a multi-candidate list to matchSyllabusChapter
 * rather than taking [0] — taking the first would file every Black Aeroplane
 * exercise under His First Flight.
 */
export function workbookUnitFor(filename, units = FIRST_FLIGHT_UNITS) {
  // `[.\s]*` rather than a single optional dot: two of the nine files in this
  // corpus are named `jewe204..pdf` and `jewe209..pdf`, with a doubled dot.
  const n = Number(String(filename ?? '').match(/(\d{2})[.\s]*pdf$/i)?.[1]?.slice(-2));
  if (!Number.isInteger(n) || n < 1 || n > units.length) return null;
  return { ordinal: n, ...units[n - 1] };
}
