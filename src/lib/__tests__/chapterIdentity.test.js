import { describe, it, expect } from 'vitest';
import { chapterKeyFor, decideAssignments, aliasFor, chapterForPage, VERDICT } from '../chapterIdentity';

/* Fixtures are the ACTUAL failures measured on the 2026-08-12/13 load, not
 * invented cases. Each rejection test names the row count it would have
 * prevented, so a future change that weakens a rule shows what it costs. */

const politicalTheory = [
  { ordinal: 1, title: 'Political Theory: An Introduction', pageStart: 1,  pageEnd: 14, numbered: true },
  { ordinal: 2, title: 'Freedom',                           pageStart: 15, pageEnd: 30, numbered: true },
  { ordinal: 3, title: 'Equality',                          pageStart: 31, pageEnd: 46, numbered: true },
];

// Hornbill: poems are unnumbered and sit INSIDE the prose chapter PDFs.
const hornbill = [
  { ordinal: 1, title: 'The Portrait of a Lady',            pageStart: 1,  pageEnd: 12, numbered: true },
  { ordinal: 7, title: 'A Photograph',                      pageStart: 13, pageEnd: 14, numbered: false },
  { ordinal: 3, title: 'Discovering Tut: the Saga Continues', pageStart: 24, pageEnd: 30, numbered: true },
  { ordinal: 8, title: 'The Laburnum Top',                  pageStart: 31, pageEnd: 31, numbered: false },
  { ordinal: 9, title: 'The Voice of the Rain',             pageStart: 32, pageEnd: 32, numbered: false },
];

const computerScience = [
  { ordinal: 1, title: 'Computer System',                   pageStart: 1,  pageEnd: 22, numbered: true },
  { ordinal: 2, title: 'Encoding Schemes and Number System', pageStart: 23, pageEnd: 40, numbered: true },
];

const geography = [
  { ordinal: 11, title: 'World Climate and Climate Change', pageStart: 90, pageEnd: 101, numbered: true },
];

describe('chapterKeyFor — identity is the ordinal, never the name', () => {
  it('is book-scoped and ordinal-anchored', () => {
    expect(chapterKeyFor({ classLevel: '11', book: 'Hornbill', ordinal: 7 })).toBe('c11_hornbill_ch07');
    expect(chapterKeyFor({ classLevel: '11', book: 'Woven Words', ordinal: 7 })).toBe('c11_woven_words_ch07');
  });

  it('keeps single-book subjects unscoped, and honours the Kerala prefix', () => {
    expect(chapterKeyFor({ classLevel: '10', ordinal: 3 })).toBe('c10_ch03');
    expect(chapterKeyFor({ prefix: 'k', classLevel: '10', ordinal: 3 })).toBe('k10_ch03');
  });

  it('gives the SAME key when a chapter is renamed — the rename that cost 23 rows', () => {
    const before = chapterKeyFor({ classLevel: '11', book: 'Fundamentals', ordinal: 11 });
    const after  = chapterKeyFor({ classLevel: '11', book: 'Fundamentals', ordinal: 11 });
    expect(after).toBe(before);
  });

  it('refuses a missing or non-integer ordinal rather than inventing one', () => {
    expect(() => chapterKeyFor({ classLevel: '11', ordinal: undefined })).toThrow(/positive integer/);
    expect(() => chapterKeyFor({ classLevel: '11', ordinal: 'seven' })).toThrow(/positive integer/);
    expect(() => chapterKeyFor({ classLevel: '11', ordinal: 0 })).toThrow(/positive integer/);
  });
});

describe('DENIED — the exact failures measured on the wiped corpus', () => {
  it('keps101 filed as "Equality": ordinal disagrees with filename (13 rows contaminating a real chapter)', () => {
    const [d] = decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: 1,                                  // keps101
      filePageRange: [1, 14],
      proposals: [{ ordinal: 3, observedNumber: 1 }],  // model chose Equality
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
    expect(d.reason).toMatch(/filename says 1/);
  });

  it('kecs101 over-split into 7 sections: a file carries at most one numbered chapter (37 rows)', () => {
    const decided = decideAssignments({
      manifest: computerScience,
      fileOrdinal: 1,
      filePageRange: [1, 22],
      proposals: [{ ordinal: 1, observedNumber: 1 }, { ordinal: 2, observedNumber: 1 }],
    });
    expect(decided.every((d) => d.verdict === VERDICT.REJECT)).toBe(true);
    expect(decided[0].reason).toMatch(/over-split/);
  });

  it('"Poorvi" — a BOOK name cannot be selected, because the set is closed (33 rows)', () => {
    const [d] = decideAssignments({
      manifest: computerScience,
      fileOrdinal: 1,
      filePageRange: [1, 22],
      proposals: [{ ordinal: 99, observedNumber: null }],   // no such manifest entry
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
    expect(d.reason).toMatch(/not in the manifest/);
  });

  it('"Critical Reflection" — a section heading is equally unselectable (28 rows)', () => {
    const [d] = decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: 8,
      filePageRange: [1, 20],
      proposals: [{ ordinal: 42, observedNumber: null }],
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
  });

  it('rejects a printed header that contradicts the chosen ordinal', () => {
    const [d] = decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: null,
      filePageRange: [31, 46],
      proposals: [{ ordinal: 3, observedNumber: 5 }],
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
    expect(d.reason).toMatch(/printed header says 5/);
  });

  it('rejects an interleaved entry whose pages fall outside the file', () => {
    const [d] = decideAssignments({
      manifest: hornbill,
      fileOrdinal: 1,
      filePageRange: [1, 12],
      proposals: [{ ordinal: 8, observedNumber: null }],   // Laburnum Top lives on p31
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
    expect(d.reason).toMatch(/outside file span/);
  });
});

describe('PERMITTED — correct content must still be written', () => {
  it('accepts when all three signals agree', () => {
    const [d] = decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: 1,
      filePageRange: [1, 14],
      proposals: [{ ordinal: 1, observedNumber: 1 }],
    });
    expect(d.verdict).toBe(VERDICT.ACCEPT);
  });

  it('kehb101: one numbered chapter PLUS an interleaved poem inside its pages — not an over-split', () => {
    const decided = decideAssignments({
      manifest: hornbill,
      fileOrdinal: 1,
      filePageRange: [1, 14],
      proposals: [
        { ordinal: 1, observedNumber: 1 },     // The Portrait of a Lady
        { ordinal: 7, observedNumber: null },  // A Photograph, unnumbered
      ],
    });
    expect(decided.map((d) => d.verdict)).toEqual([VERDICT.ACCEPT, VERDICT.ACCEPT]);
  });

  it('kehb103: two interleaved poems in one prose chapter both survive', () => {
    const decided = decideAssignments({
      manifest: hornbill,
      fileOrdinal: 3,
      filePageRange: [24, 32],
      proposals: [
        { ordinal: 3, observedNumber: 3 },
        { ordinal: 8, observedNumber: null },
        { ordinal: 9, observedNumber: null },
      ],
    });
    expect(decided.every((d) => d.verdict === VERDICT.ACCEPT)).toBe(true);
  });

  it('kegy211: a differing printed title is an ALIAS on the same key, not a new chapter', () => {
    const [d] = decideAssignments({
      manifest: geography,
      fileOrdinal: 11,
      filePageRange: [90, 101],
      proposals: [{ ordinal: 11, observedNumber: 11 }],
    });
    expect(d.verdict).toBe(VERDICT.ACCEPT);
    expect(aliasFor(d.entry, 'World Climate and Climate Classification'))
      .toBe('World Climate and Climate Classification');
    expect(aliasFor(d.entry, 'World Climate and Climate Change')).toBeNull();
  });

  it('accepts with a flag when one signal is unreadable, rather than discarding the file', () => {
    const [noPrinted] = decideAssignments({
      manifest: politicalTheory, fileOrdinal: 2, filePageRange: [15, 30],
      proposals: [{ ordinal: 2, observedNumber: null }],
    });
    expect(noPrinted.verdict).toBe(VERDICT.ACCEPT_WITH_FLAG);

    const [noFileOrd] = decideAssignments({
      manifest: politicalTheory, fileOrdinal: null, filePageRange: [15, 30],
      proposals: [{ ordinal: 2, observedNumber: 2 }],
    });
    expect(noFileOrd.verdict).toBe(VERDICT.ACCEPT_WITH_FLAG);
  });
});

describe('positional chunk assignment — headings cannot capture content', () => {
  const accepted = [
    { ordinal: 1, title: 'The Portrait of a Lady', pageStart: 1, pageEnd: 12 },
    { ordinal: 7, title: 'A Photograph',           pageStart: 13, pageEnd: 14 },
  ];

  it('files a chunk by its printed page, not by the nearest heading', () => {
    expect(chapterForPage(accepted, 5).title).toBe('The Portrait of a Lady');
    expect(chapterForPage(accepted, 13).title).toBe('A Photograph');
  });

  it('returns null off the end rather than guessing the last chapter', () => {
    expect(chapterForPage(accepted, 99)).toBeNull();
    expect(chapterForPage(accepted, null)).toBeNull();
  });
});
