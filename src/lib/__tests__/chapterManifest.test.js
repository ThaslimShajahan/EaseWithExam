import { describe, it, expect } from 'vitest';
import { fileOrdinalFrom, validateManifest, candidatesForFile, inferFileStructure } from '../chapterManifest';
import { decideAssignments, VERDICT } from '../chapterIdentity';

/* ── inferFileStructure — the Issue 2 suggestion, always admin-overridable ── */
describe('inferFileStructure', () => {
  const numbered = (fileOrdinal, ordinal = fileOrdinal) => ({ ordinal, numbered: true, fileOrdinal });

  it('per_chapter: every numbered entry has its own distinct fileOrdinal (CBSE Class 8 Maths shape — 7 files, 7 entries)', () => {
    const entries = [1, 2, 3, 4, 5, 6, 7].map((n) => numbered(n));
    expect(inferFileStructure(entries)).toBe('per_chapter');
  });

  it('combined: a fileOrdinal is shared by more than one numbered entry (Poorvi shape — 5 files, 15 entries, 3 sharing each)', () => {
    const entries = [
      numbered(1, 1), numbered(1, 2), numbered(1, 3),
      numbered(2, 4), numbered(2, 5), numbered(2, 6),
    ];
    expect(inferFileStructure(entries)).toBe('combined');
  });

  it('interleaved entries (numbered: false) are excluded from the count either way', () => {
    const entries = [
      numbered(1, 1), numbered(2, 2),
      { ordinal: 3, numbered: false, fileOrdinal: null },
    ];
    expect(inferFileStructure(entries)).toBe('per_chapter');
  });

  it('returns null — not a guess — when some numbered entries have no fileOrdinal yet', () => {
    expect(inferFileStructure([numbered(1, 1), { ordinal: 2, numbered: true, fileOrdinal: null }])).toBeNull();
  });

  it('returns null for an empty manifest', () => {
    expect(inferFileStructure([])).toBeNull();
  });
});

/* Filenames are the REAL ones from the corpus, including their typos. */
describe('fileOrdinalFrom — the third corroboration signal', () => {
  it('reads NCERT short codes', () => {
    expect(fileOrdinalFrom('keps101.pdf')).toBe(1);
    expect(fileOrdinalFrom('keps103.pdf')).toBe(3);
    expect(fileOrdinalFrom('kehb113.pdf')).toBe(13);
    expect(fileOrdinalFrom('kegy211.pdf')).toBe(11);
  });

  it('rejects NCERT front matter, which is a letter suffix not a chapter number', () => {
    expect(fileOrdinalFrom('kehs1ps.pdf')).toBeNull();   // prelims
    expect(fileOrdinalFrom('kemh1an.pdf')).toBeNull();   // answers
    expect(fileOrdinalFrom('keec1a1.pdf')).toBeNull();   // appendix
  });

  it('reads hand-named files, including the ones with no space and stray words', () => {
    expect(fileOrdinalFrom('UNIT 1 WIT AND WISDOM.pdf')).toBe(1);
    expect(fileOrdinalFrom('UNIT2 VALUES AND DISPOSITION.pdf')).toBe(2);
    expect(fileOrdinalFrom('Chapter 5 Bank Reconciliation Statement.pdf')).toBe(5);
    expect(fileOrdinalFrom('8 Follow that dream.pdf')).toBe(8);
    expect(fileOrdinalFrom('3 Winds of  Change.pdf')).toBe(3);
  });

  it('prefers the labelled number over a stray leading letter/number', () => {
    // "THEME B CHAPTER 3" must read as 3, not as anything earlier in the string.
    expect(fileOrdinalFrom('THEME B CHAPTER 3 RISE OF THE MARATHAS.pdf')).toBe(3);
    expect(fileOrdinalFrom('THEME  E CHAPTER 7 FACTORS OF PRODUCTION.pdf')).toBe(7);
  });

  it('returns null rather than guessing when there is no number', () => {
    expect(fileOrdinalFrom('Poorvi.pdf')).toBeNull();
    expect(fileOrdinalFrom('')).toBeNull();
    expect(fileOrdinalFrom(null)).toBeNull();
  });
});

const hornbill = [
  { ordinal: 1,   title: 'The Portrait of a Lady', pageStart: 1,  pageEnd: 14, numbered: true,  printedNumber: 1, fileOrdinal: 1 },
  { ordinal: 7,   title: 'A Photograph',           pageStart: 13, pageEnd: 14, numbered: false },
  { ordinal: 101, title: 'Note-making',            pageStart: 70, pageEnd: 74, numbered: true,  printedNumber: 1, fileOrdinal: 11 },
  { ordinal: 105, title: 'Letter-writing',         pageStart: 86, pageEnd: 92, numbered: true,  printedNumber: 5, fileOrdinal: 15 },
];

describe('validateManifest — bad manifests never reach the approval screen', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(hornbill)).toEqual({ ok: true, errors: [] });
  });

  it('rejects empty / non-array', () => {
    expect(validateManifest([]).errors).toContain('manifest is empty');
    expect(validateManifest(null).ok).toBe(false);
  });

  it('rejects duplicate ordinals — two chapters cannot share an identity', () => {
    const dup = [...hornbill, { ordinal: 1, title: 'Impostor', pageStart: 200, pageEnd: 210, numbered: true }];
    const r = validateManifest(dup);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate ordinal 1/);
  });

  it('rejects overlapping numbered page ranges — positional assignment would swallow chunks', () => {
    const overlap = [
      { ordinal: 1, title: 'A', pageStart: 1,  pageEnd: 20, numbered: true, printedNumber: 1, fileOrdinal: 1 },
      { ordinal: 2, title: 'B', pageStart: 15, pageEnd: 30, numbered: true, printedNumber: 2, fileOrdinal: 2 },
    ];
    expect(validateManifest(overlap).errors.join(' ')).toMatch(/page ranges overlap/);
  });

  it('rejects an interleaved entry with no numbered host — it could never load', () => {
    const orphanPoem = [
      { ordinal: 1, title: 'A',      pageStart: 1,  pageEnd: 12, numbered: true, printedNumber: 1, fileOrdinal: 1 },
      { ordinal: 9, title: 'Stray',  pageStart: 90, pageEnd: 91, numbered: false },
    ];
    expect(validateManifest(orphanPoem).errors.join(' ')).toMatch(/sits inside no numbered chapter/);
  });

  it('rejects an interleaved entry that claims a printed number or a file', () => {
    const bad = [
      { ordinal: 1, title: 'A', pageStart: 1, pageEnd: 12, numbered: true, printedNumber: 1, fileOrdinal: 1 },
      { ordinal: 7, title: 'P', pageStart: 5, pageEnd: 6,  numbered: false, printedNumber: 7, fileOrdinal: 7 },
    ];
    const e = validateManifest(bad).errors.join(' ');
    expect(e).toMatch(/no printed chapter number/);
    expect(e).toMatch(/no file of their own/);
  });

  it('reports every problem at once, not just the first', () => {
    expect(validateManifest([{ ordinal: 0, title: '', pageStart: 9, pageEnd: 2 }]).errors.length).toBeGreaterThan(2);
  });
});

/* Item 7 — per_chapter matching must not depend on page numbers at all. */
describe('validateManifest — per_chapter books need no page numbers', () => {
  const perChapterNoPages = [
    { ordinal: 1, title: 'Rational Numbers', pageStart: null, pageEnd: null, numbered: true, printedNumber: 1, fileOrdinal: 1 },
    { ordinal: 2, title: 'Linear Equations', pageStart: null, pageEnd: null, numbered: true, printedNumber: 2, fileOrdinal: 2 },
  ];

  it('accepts numbered entries with no page numbers at all when fileStructure is per_chapter', () => {
    expect(validateManifest(perChapterNoPages, 'per_chapter')).toEqual({ ok: true, errors: [] });
  });

  it('still rejects the SAME manifest when fileStructure is combined (default/strict)', () => {
    expect(validateManifest(perChapterNoPages, 'combined').ok).toBe(false);
    // Omitted fileStructure keeps existing strict behaviour for old callers.
    expect(validateManifest(perChapterNoPages).ok).toBe(false);
  });

  it('still catches a real typo — a half-filled range — even when per_chapter', () => {
    const halfFilled = [{ ...perChapterNoPages[0], pageStart: 10, pageEnd: null }];
    const r = validateManifest(halfFilled, 'per_chapter');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/both be set/);
  });

  it('still catches a backwards range when per_chapter and pages ARE given', () => {
    const backwards = [{ ...perChapterNoPages[0], pageStart: 20, pageEnd: 5 }];
    expect(validateManifest(backwards, 'per_chapter').errors.join(' ')).toMatch(/pageEnd 5 is before pageStart 20/);
  });

  it('interleaved entries still require page numbers even in a per_chapter manifest', () => {
    const withInterleaved = [
      ...perChapterNoPages,
      { ordinal: 3, title: 'A Poem', numbered: false, pageStart: null, pageEnd: null },
    ];
    const r = validateManifest(withInterleaved, 'per_chapter');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/pageStart and pageEnd must be integers/);
  });
});

describe('banded books — the case that would silently reject correct content', () => {
  it('accepts Writing Skills, where file ordinal 11 backs printed chapter 1', () => {
    const [d] = decideAssignments({
      manifest: hornbill,
      fileOrdinal: fileOrdinalFrom('kehb111.pdf'),   // 11
      filePageRange: [70, 74],
      proposals: [{ ordinal: 101, observedNumber: 1 }],   // book prints "1"
    });
    expect(d.verdict).toBe(VERDICT.ACCEPT);
  });

  it('still rejects a genuine mismatch inside the same banded book', () => {
    const [d] = decideAssignments({
      manifest: hornbill,
      fileOrdinal: fileOrdinalFrom('kehb111.pdf'),   // 11 -> Note-making
      filePageRange: [70, 74],
      proposals: [{ ordinal: 105, observedNumber: 1 }],   // chose Letter-writing
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
    expect(d.reason).toMatch(/filename says 11/);
  });

  it('candidatesForFile offers a file its own chapter plus interleaved items inside it', () => {
    const c = candidatesForFile(hornbill, 1, [1, 14]).map((e) => e.title);
    expect(c).toEqual(['The Portrait of a Lady', 'A Photograph']);
    expect(candidatesForFile(hornbill, 11, [70, 74]).map((e) => e.title)).toEqual(['Note-making']);
  });
});
