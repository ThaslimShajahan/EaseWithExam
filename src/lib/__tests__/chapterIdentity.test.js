import { describe, it, expect } from 'vitest';
import { chapterKeyFor, decideAssignments, aliasFor, chapterForPage, assignChapters, VERDICT } from '../chapterIdentity';

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

describe('adminSelectedOrdinal — the upload-time picker signal', () => {
  it('accepts a hand-named file the other signals cannot corroborate, once an admin picks its chapter', () => {
    // "Poorvi" carried no parseable file ordinal and no printed number was
    // read — exactly the shape that produced the 33-row failure. An admin
    // PICKING the real chapter from the manifest should now settle it.
    const [d] = decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: null,
      filePageRange: null,
      proposals: [{ ordinal: 1, observedNumber: null }],
      adminSelectedOrdinal: 1,
    });
    expect(d.verdict).toBe(VERDICT.ACCEPT);
    expect(d.reason).toMatch(/admin-selected/);
  });

  it('rejects a model proposal that conflicts with what the admin picked', () => {
    const [d] = decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: 1,
      filePageRange: [1, 14],
      proposals: [{ ordinal: 3, observedNumber: 1 }],   // model still says "Equality"
      adminSelectedOrdinal: 1,                          // admin says chapter 1
    });
    expect(d.verdict).toBe(VERDICT.REJECT);
    expect(d.reason).toMatch(/admin selected ordinal 1.*conflicts/);
  });

  it('refuses an admin selection outside the manifest — the closed set still holds', () => {
    expect(() => decideAssignments({
      manifest: politicalTheory,
      fileOrdinal: 1,
      filePageRange: [1, 14],
      proposals: [{ ordinal: 1, observedNumber: 1 }],
      adminSelectedOrdinal: 99,
    })).toThrow(/not in the manifest/);
  });

  it('does NOT override an interleaved entry — position still decides which poem a chunk belongs to', () => {
    const decided = decideAssignments({
      manifest: hornbill,
      fileOrdinal: 1,
      filePageRange: [1, 14],
      proposals: [
        { ordinal: 1, observedNumber: 1 },     // host chapter
        { ordinal: 8, observedNumber: null },  // Laburnum Top, pp31 — outside this file
      ],
      adminSelectedOrdinal: 1,
    });
    expect(decided[0].verdict).toBe(VERDICT.ACCEPT);   // admin-confirmed host chapter
    expect(decided[1].verdict).toBe(VERDICT.REJECT);   // still fails on page range, unaffected by the admin pick
    expect(decided[1].reason).toMatch(/outside file span/);
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

/* Phase 2 slice: assignChapters() is the actual integration point
 * AdminContentIntake.jsx calls — everything above it is already proven; these
 * tests are what proves the WIRING, not the engine underneath it again.
 *
 * fileOrdinal is set explicitly on every numbered entry here (unlike the
 * shared fixtures above), because candidatesForFile() matches on it strictly
 * — it does not fall back to `ordinal` the way decideAssignments does. Kept
 * as its own fixture rather than editing the shared ones above, which
 * deliberately test that fallback path directly. */
// Non-overlapping host/interleaved page ranges, deliberately — matches the
// convention the 'positional chunk assignment' fixture above already uses.
// A real manifest with genuinely overlapping ranges (a poem's pages are also
// claimed by its host chapter's own pageEnd) is an existing, pre-Phase-2
// ambiguity in chapterForPage()'s plain array .find() — out of scope to fix
// here; not exercised by this fixture on purpose.
const fixtureBook = [
  { ordinal: 1, title: 'FIXTURE Chapter One', pageStart: 1, pageEnd: 1, numbered: true, fileOrdinal: 1 },
  { ordinal: 9, title: 'FIXTURE Interleaved Poem', pageStart: 2, pageEnd: 2, numbered: false },
  { ordinal: 2, title: 'FIXTURE Chapter Two', pageStart: 4, pageEnd: 6, numbered: true, fileOrdinal: 2 },
];

describe('assignChapters — the Phase 2 integration point', () => {
  it('PERMIT: a real file, real chunks, produces the right chapter_key and one syllabus entry', () => {
    const chunks = [{ pageNo: 1, content: 'a' }, { pageNo: 1, content: 'b' }];
    const r = assignChapters({ manifest: fixtureBook, filename: '1-fixture-book.pdf', chunks, classLevel: '11', book: 'Fixture Book' });
    expect(r.ok).toBe(true);
    expect(r.chunks.every((c) => c.chapterKey === 'c11_fixture_book_ch01')).toBe(true);
    expect(r.chunks.every((c) => c.chapterName === 'FIXTURE Chapter One')).toBe(true);
    expect(r.syllabusEntries).toEqual([{ chapterKey: 'c11_fixture_book_ch01', chapterName: 'FIXTURE Chapter One', sortOrder: 1 }]);
    // S2 (printed header) is never read in this slice, so every accept is
    // flagged by design — decideAssignments' own "two of three, third unread" path.
    expect(r.flagged).toBe(true);
  });

  it('PERMIT: an interleaved chunk inside the numbered chapter gets its OWN chapter_key, not the host\'s', () => {
    const chunks = [{ pageNo: 1, content: 'prose' }, { pageNo: 2, content: 'poem' }];
    const r = assignChapters({ manifest: fixtureBook, filename: '1-fixture-book.pdf', chunks, classLevel: '11', book: 'Fixture Book' });
    expect(r.ok).toBe(true);
    expect(r.chunks[0].chapterKey).toBe('c11_fixture_book_ch01');
    expect(r.chunks[1].chapterKey).toBe('c11_fixture_book_ch09');
    expect(r.syllabusEntries).toHaveLength(2);
  });

  it('REJECT: a file whose filename ordinal matches no manifest entry — nothing to write, clear reason, no guess', () => {
    const r = assignChapters({ manifest: fixtureBook, filename: '99-fixture-book.pdf', chunks: [{ pageNo: 1 }], classLevel: '11', book: 'Fixture Book' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no approved manifest entry has file ordinal 99/i);
    expect(r.chunks).toBeUndefined();
    expect(r.syllabusEntries).toBeUndefined();
  });

  it('REJECT: an unparseable filename with no admin override — refuses rather than guessing', () => {
    const r = assignChapters({ manifest: fixtureBook, filename: 'scan_final_v2.pdf', chunks: [{ pageNo: 1 }], classLevel: '11', book: 'Fixture Book' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not read a chapter number/i);
  });

  it('REJECT: a chunk whose page sits outside every accepted entry — refuses rather than assigning the nearest one', () => {
    const chunks = [{ pageNo: 999 }];
    const r = assignChapters({ manifest: fixtureBook, filename: '1-fixture-book.pdf', chunks, classLevel: '11', book: 'Fixture Book' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/falls outside every accepted chapter/i);
  });

  it('PERMIT: an admin override on an unparseable filename settles it, same as a real ordinal would', () => {
    const r = assignChapters({
      manifest: fixtureBook, filename: 'scan_final_v2.pdf', chunks: [{ pageNo: 4 }],
      classLevel: '11', book: 'Fixture Book', adminSelectedOrdinal: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.chunks[0].chapterKey).toBe('c11_fixture_book_ch02');
  });
});
