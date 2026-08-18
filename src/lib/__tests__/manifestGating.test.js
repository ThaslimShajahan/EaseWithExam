/**
 * Both-halves cover for the manifest gate — the protection that was fully built,
 * fully unreachable, and therefore absent from every Study Notes upload.
 *
 * The upload that exposed it reported "64 chunks saved across 2 lessons" for a
 * file containing THREE texts, naming one chapter "Poorvi" (the book's title,
 * read off a running header) and merging two texts into one lesson. Nothing
 * errored. So these tests assert both halves everywhere:
 *
 *   DENIED   — no manifest / draft manifest / manifest that disagrees with the
 *              file is REFUSED, and refused before anything is written.
 *   PERMITTED— a correct manifest still produces the right chapters, with the
 *              manifest's titles and page ranges, not the model's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../aiProxy', () => ({ cachedChatComplete: vi.fn(), AI_REQUEST_TIMEOUT_MS: 1000 }));
vi.mock('../pdfVision', () => ({ extractPagesWithVision: vi.fn(), MAX_VISION_PAGES: 10 }));

import { cachedChatComplete } from '../aiProxy';
import { validateManifest, fileOrdinalFrom, candidatesForFile } from '../chapterManifest';
import { requireApprovedManifest } from '../manifestExtraction';
import { extractNotesByManifest } from '../contentExtraction';
import { assignChapters } from '../chapterIdentity';

/* The real Unit 1 of NCERT Class 8 English (Poorvi), as read from the book:
 * three texts, not the two the old pipeline produced. Page ranges are the
 * printed folios, which for that file match the PDF pages 1-48. */
const UNIT1 = [
  { ordinal: 1, title: 'The Wit that Won Hearts', unit: 'Unit 1: Wit and Wisdom', pageStart: 1,  pageEnd: 16, numbered: true, printedNumber: 1, fileOrdinal: 1, band: null },
  { ordinal: 2, title: 'A Concrete Example',      unit: 'Unit 1: Wit and Wisdom', pageStart: 17, pageEnd: 26, numbered: true, printedNumber: 2, fileOrdinal: 1, band: null },
  { ordinal: 3, title: 'Wisdom Paves the Way',    unit: 'Unit 1: Wit and Wisdom', pageStart: 27, pageEnd: 47, numbered: true, printedNumber: 3, fileOrdinal: 1, band: null },
];

const pagesFor = (n) => Array.from({ length: n }, (_, i) => `page ${i + 1} body text`);

/** The model's reply for one slice. Deliberately returns a WRONG title —
 *  'Poorvi', the exact failure being guarded against — so any test that ends up
 *  with the right chapter names proves they came from the manifest, not here. */
const modelReply = (lessons) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ unit: 'Poorvi', lessons }) } }],
});
const oneLesson = () => [{
  title: 'Poorvi', page_start: 99, page_end: 99, marker_start: 1, marker_end: 1,
  chunks: [{ heading: 'h', content: 'c' }],
}];

beforeEach(() => { vi.clearAllMocks(); });

/* ── validateManifest: the `unit` field ─────────────────────────────── */
describe('validateManifest — unit', () => {
  const base = { ordinal: 1, title: 'T', pageStart: 1, pageEnd: 2, numbered: true, printedNumber: 1, fileOrdinal: 1 };

  it('PERMIT: absent or null unit is fine — most books have no units', () => {
    expect(validateManifest([{ ...base }]).ok).toBe(true);
    expect(validateManifest([{ ...base, unit: null }]).ok).toBe(true);
  });

  it('PERMIT: a real unit label passes', () => {
    expect(validateManifest([{ ...base, unit: 'Unit 1: Wit and Wisdom' }]).ok).toBe(true);
  });

  it('DENY: an empty/whitespace unit is rejected, not silently kept', () => {
    // '' would group every such chapter under a blank heading in the student
    // notes browser, which reads as a bug rather than as "no unit".
    const r = validateManifest([{ ...base, unit: '   ' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unit is present but empty/);
  });

  it('DENY: a non-string unit is rejected', () => {
    expect(validateManifest([{ ...base, unit: 7 }]).ok).toBe(false);
  });

  it('the real Unit 1 manifest is structurally valid', () => {
    expect(validateManifest(UNIT1)).toEqual({ ok: true, errors: [] });
  });
});

/* ── requireApprovedManifest: the fail-closed gate ───────────────────── */
describe('requireApprovedManifest — the gate saveNoteChunks now calls first', () => {
  it('DENY: no manifest at all', () => {
    expect(() => requireApprovedManifest(null)).toThrow(/No manifest found/i);
  });

  it('DENY: a draft is not an approval — this is the state the old code treated as "fine"', () => {
    expect(() => requireApprovedManifest({ status: 'draft', entries: UNIT1 }))
      .toThrow(/is 'draft', not 'approved'/);
  });

  it('DENY: approved but structurally broken fails loudly rather than loading', () => {
    expect(() => requireApprovedManifest({ status: 'approved', entries: [{ ordinal: 1 }] }))
      .toThrow(/failed structural validation/);
  });

  it('PERMIT: an approved, valid manifest passes and is returned unchanged', () => {
    const row = { status: 'approved', entries: UNIT1 };
    expect(requireApprovedManifest(row)).toBe(row);
  });
});

/* ── extractNotesByManifest: the split ───────────────────────────────── */
describe('extractNotesByManifest — the manifest decides the split, not the model', () => {
  it('PERMIT: 3 manifest entries produce exactly 3 chapters, with the MANIFEST titles', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));

    const { lessons, unit } = await extractNotesByManifest({
      pages: pagesFor(48), entries: UNIT1, examType: 'CBSE Class 8', subject: 'English',
    });

    // The old pipeline produced 2 lessons from this exact file. The count is
    // now a property of the manifest, not of how the model batched the text.
    expect(lessons).toHaveLength(3);
    expect(lessons.map((l) => l.title)).toEqual([
      'The Wit that Won Hearts', 'A Concrete Example', 'Wisdom Paves the Way',
    ]);
    // The model said 'Poorvi' every single time and it reached nothing.
    expect(lessons.some((l) => l.title === 'Poorvi')).toBe(false);
    expect(unit).toBe('Unit 1: Wit and Wisdom');
  });

  it('PERMIT: page ranges and ordinals come from the manifest, overriding model output', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));   // claims pages 99-99
    const { lessons } = await extractNotesByManifest({
      pages: pagesFor(48), entries: UNIT1, examType: 'CBSE Class 8', subject: 'English',
    });
    expect(lessons.map((l) => [l.page_start, l.page_end])).toEqual([[1, 16], [17, 26], [27, 47]]);
    expect(lessons.map((l) => l.manifestOrdinal)).toEqual([1, 2, 3]);
    expect(lessons.every((l) => l.unit === 'Unit 1: Wit and Wisdom')).toBe(true);
  });

  it('PERMIT: each chapter is extracted from ONLY its own pages', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    await extractNotesByManifest({
      pages: pagesFor(48), entries: UNIT1, examType: 'CBSE Class 8', subject: 'English',
    });
    // One model call per chapter, each seeing a different slice — this is what
    // makes cross-chapter merging impossible rather than merely unlikely.
    expect(cachedChatComplete).toHaveBeenCalledTimes(3);
    const sent = cachedChatComplete.mock.calls.map((c) => c[0].messages[1].content);
    expect(sent[0]).toContain('page 1 body text');
    expect(sent[0]).not.toContain('page 17 body text');
    expect(sent[1]).toContain('page 17 body text');
    expect(sent[1]).not.toContain('page 27 body text');
  });

  it('DENY: a manifest whose pages fall outside the file is refused, not clamped', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    // 20-page file, but the manifest claims content up to page 47.
    await expect(extractNotesByManifest({
      pages: pagesFor(20), entries: UNIT1, examType: 'CBSE Class 8', subject: 'English',
    })).rejects.toThrow(/outside this 20-page file/);
    // Refused during the FIRST out-of-range chapter, so no later chapter is
    // half-extracted on the way to failing.
    expect(cachedChatComplete.mock.calls.length).toBeLessThan(3);
  });

  it('DENY: no entries and no pages are both refused before any model call', async () => {
    await expect(extractNotesByManifest({ pages: pagesFor(10), entries: [] })).rejects.toThrow(/at least one manifest entry/);
    await expect(extractNotesByManifest({ pages: [], entries: UNIT1 })).rejects.toThrow(/requires the `pages` array/);
    expect(cachedChatComplete).not.toHaveBeenCalled();
  });

  it('DENY: a chapter whose slice yields no chunks fails rather than writing an empty chapter', async () => {
    cachedChatComplete.mockResolvedValue(modelReply([{ title: 'x', chunks: [] }]));
    await expect(extractNotesByManifest({
      pages: pagesFor(48), entries: UNIT1, examType: 'CBSE Class 8', subject: 'English',
    // Refused either by runNotesExtraction's own empty check or by the
    // per-entry one — what matters is that an empty chapter is never written.
    })).rejects.toThrow(/No content/);
  });
});

/* ── extractNotesByManifest: fileStructure — 'combined' vs 'per_chapter' ──
 *
 * Real incident, same night: CBSE Class 8 Mathematics is 7 separate
 * per-chapter files (Chapter 1..7), not one combined PDF. Its manifest's
 * page ranges are BOOK-WIDE printed numbers (pp19-47 for "Power Play"), but
 * the real "Chapter 2 Power Play.pdf" file is 46 pages on its own — the
 * combined-mode page-range check (correctly, for a combined book) refused
 * it: "claims printed pages 19-47 ... outside this 46-page file". For a
 * per_chapter book that check is not meaningful at all — fileOrdinal having
 * already selected exactly this one file IS the corroboration. */
const MATHS_CH2 = [
  { ordinal: 2, title: 'Power Play', unit: null, pageStart: 19, pageEnd: 47, numbered: true, printedNumber: 2, fileOrdinal: 2, band: null },
];

describe('extractNotesByManifest — fileStructure: per_chapter skips the page-range check', () => {
  it('PERMIT: the real Power Play case — book-wide page range does not fit the 46-page file, but per_chapter extracts anyway', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    const { lessons, warnings } = await extractNotesByManifest({
      pages: pagesFor(46), entries: MATHS_CH2, examType: 'CBSE Class 8', subject: 'Mathematics',
      fileStructure: 'per_chapter',
    });
    expect(lessons).toHaveLength(1);
    expect(lessons[0].title).toBe('Power Play');
    // Whole file consumed, not a slice bounded by the (irrelevant) pageStart/pageEnd.
    expect(cachedChatComplete).toHaveBeenCalledTimes(1);
    expect(cachedChatComplete.mock.calls[0][0].messages[1].content).toContain('page 46 body text');
    expect(warnings).toEqual([]);
  });

  it('DENY (combined, unchanged): the exact real incident reproduced — two entries sharing one fileOrdinal (a mistaken combined-style read of a per-chapter book) still gets caught by the page-range check', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    // What was ACTUALLY live for a few minutes during this incident: chapter
    // 1 and chapter 2 both pointing at fileOrdinal 2, so candidatesForFile
    // returns both and offset comes from chapter 1's pageStart (1), not
    // chapter 2's own (19) — chapter 2 then needs file page 47, one past the
    // real file's 46. A single-entry `covered` list (MATHS_CH2 alone) cannot
    // reproduce this: offset always equals that one entry's own pageStart,
    // so the math trivially fits regardless of file length. Two entries
    // sharing a file is what makes the offset — and the mismatch — real.
    const chapter1And2ShareAFile = [
      { ordinal: 1, title: 'A Square and A Cube', pageStart: 1,  pageEnd: 18, numbered: true, printedNumber: 1, fileOrdinal: 2 },
      ...MATHS_CH2,
    ];
    await expect(extractNotesByManifest({
      pages: pagesFor(46), entries: chapter1And2ShareAFile, examType: 'CBSE Class 8', subject: 'Mathematics',
      // fileStructure omitted — defaults to 'combined', proving the default
      // preserves the existing, still-correct behaviour for combined books.
    })).rejects.toThrow(/outside this 46-page file/);
  });

  it('FLAG, DO NOT BLOCK: an implausibly short per_chapter file is warned, not refused', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    const { lessons, warnings } = await extractNotesByManifest({
      pages: pagesFor(1), entries: MATHS_CH2, examType: 'CBSE Class 8', subject: 'Mathematics',
      fileStructure: 'per_chapter',
    });
    expect(lessons).toHaveLength(1);   // still extracted — a flag, not a gate
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/1 page\(s\).*short/);
  });

  it('FLAG, DO NOT BLOCK: an implausibly long per_chapter file is warned, not refused', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    const { warnings } = await extractNotesByManifest({
      pages: pagesFor(400), entries: MATHS_CH2, examType: 'CBSE Class 8', subject: 'Mathematics',
      fileStructure: 'per_chapter',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/400 page\(s\).*long/);
  });

  it('no warning for a normal-length per_chapter file', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    const { warnings } = await extractNotesByManifest({
      pages: pagesFor(29), entries: MATHS_CH2, examType: 'CBSE Class 8', subject: 'Mathematics',
      fileStructure: 'per_chapter',
    });
    expect(warnings).toEqual([]);
  });

  it('DENY: a per_chapter file matching more than one entry is a manifest inconsistency, refused rather than silently duplicated', async () => {
    cachedChatComplete.mockResolvedValue(modelReply(oneLesson()));
    const twoEntriesSameFile = [
      { ordinal: 1, title: 'A Square and A Cube', pageStart: 1,  pageEnd: 18, numbered: true, printedNumber: 1, fileOrdinal: 2 },
      { ordinal: 2, title: 'Power Play',          pageStart: 19, pageEnd: 47, numbered: true, printedNumber: 2, fileOrdinal: 2 },
    ];
    await expect(extractNotesByManifest({
      pages: pagesFor(46), entries: twoEntriesSameFile, examType: 'CBSE Class 8', subject: 'Mathematics',
      fileStructure: 'per_chapter',
    })).rejects.toThrow(/matched 2 manifest entries.*per_chapter/s);
    expect(cachedChatComplete).not.toHaveBeenCalled();
  });
});

/* ── assignChapters still corroborates, and now carries unit ─────────── */
describe('assignChapters — corroboration after the manifest-driven split', () => {
  it('PERMIT: a split lesson corroborates against its own entry and carries the unit through', () => {
    const r = assignChapters({
      manifest: UNIT1, filename: 'UNIT 1 WIT AND WISDOM.pdf', classLevel: '8', book: null,
      adminSelectedOrdinal: 2,
      chunks: [{ pageNo: 17 }],
    });
    expect(r.ok).toBe(true);
    expect(r.chunks[0].chapterName).toBe('A Concrete Example');
    expect(r.chunks[0].unit).toBe('Unit 1: Wit and Wisdom');
    expect(r.syllabusEntries[0].unit).toBe('Unit 1: Wit and Wisdom');
  });

  /* The exact real-world input that hit "adminSelectedOrdinal is not defined".
   * The crash was a ReferenceError in AdminContentIntake's upload loop, not a
   * logic error — but it fired on the branch taken when candidatesForFile()
   * returns NOTHING, so this pins down that for this file it returns all three
   * entries and that branch is never reached at all. */
  it('PERMIT: the real unit file resolves to all 3 entries via File #', () => {
    expect(fileOrdinalFrom('UNIT 1 WIT AND WISDOM.pdf')).toBe(1);
    const covered = candidatesForFile(UNIT1, 1, null);
    expect(covered).toHaveLength(3);
    expect(covered.map((e) => e.title)).toEqual([
      'The Wit that Won Hearts', 'A Concrete Example', 'Wisdom Paves the Way',
    ]);
  });

  it('DENY: a filename with no readable ordinal covers nothing, so the upload refuses', () => {
    // This is the branch the removed dead code sat on. It must resolve to an
    // empty list and let the caller throw a real message — not a ReferenceError.
    expect(fileOrdinalFrom('poorvi-scan-final.pdf')).toBeNull();
    expect(candidatesForFile(UNIT1, null, null)).toHaveLength(0);
  });

  it('DENY: a file matching no manifest entry is refused', () => {
    const r = assignChapters({
      manifest: UNIT1, filename: 'UNIT 9 SOMETHING ELSE.pdf', classLevel: '8', book: null,
      chunks: [{ pageNo: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/file ordinal 9/);
  });
});
