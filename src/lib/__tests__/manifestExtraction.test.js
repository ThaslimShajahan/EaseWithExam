/**
 * Issue 1 (fileOrdinal-null bug), fix half 1: a fresh draft must not ship
 * with fileOrdinal: null on every entry — that is the exact state that was
 * approved twice (Poorvi, then CBSE Class 8 Mathematics) and required a
 * hand-written SQL UPDATE both times to unblock uploads. See
 * chapterManifest.test.js for the file_structure inference half, and
 * 20260815030000_manifest_file_structure_and_ordinal_gate.sql for the
 * approval-time gate that makes a null fileOrdinal impossible to approve
 * even if this default is somehow bypassed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../aiProxy', () => ({ chatComplete: vi.fn(), AI_REQUEST_TIMEOUT_MS: 1000 }));
vi.mock('../pdfVision', () => ({ extractPagesWithVision: vi.fn(), MAX_VISION_PAGES: 10 }));

import { chatComplete } from '../aiProxy';
import { extractPagesWithVision } from '../pdfVision';
import { draftManifestFromContentsPage } from '../manifestExtraction';
import { inferFileStructure } from '../chapterManifest';

const modelReply = (entries) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entries }) } }],
});

beforeEach(() => {
  vi.clearAllMocks();
  extractPagesWithVision.mockResolvedValue({ pages: ['contents page text'], pageCount: 1 });
});

describe('draftManifestFromContentsPage — fileOrdinal defaults, never null for a numbered entry', () => {
  it('PERMIT: the predictable case — a "Chapter N" book gets fileOrdinal = printedNumber by default (the real CBSE Class 8 Maths shape)', async () => {
    chatComplete.mockResolvedValue(modelReply([
      { ordinal: 1, title: 'A Square and A Cube', pageStart: 1,  pageEnd: 18,  numbered: true, printedNumber: 1 },
      { ordinal: 2, title: 'Power Play',           pageStart: 19, pageEnd: 47, numbered: true, printedNumber: 2 },
      { ordinal: 3, title: 'A Story of Numbers',   pageStart: 48, pageEnd: 81, numbered: true, printedNumber: 3 },
    ]));
    const { entries } = await draftManifestFromContentsPage(new ArrayBuffer(0), { examType: 'CBSE Class 8', subject: 'Mathematics' });

    expect(entries.map((e) => e.fileOrdinal)).toEqual([1, 2, 3]);
    // The exact real failure this fixes: this used to always be [null, null, null].
    expect(entries.every((e) => e.fileOrdinal != null)).toBe(true);
    // A fresh draft of a predictably-named book is now immediately inferable
    // as per_chapter, without the admin having to type anything first —
    // exactly the "should populate correctly by default" ask.
    expect(inferFileStructure(entries)).toBe('per_chapter');
  });

  it('falls back to ordinal when the model returns no printedNumber', async () => {
    chatComplete.mockResolvedValue(modelReply([
      { ordinal: 1, title: 'First',  pageStart: 1, pageEnd: 5, numbered: true },
      { ordinal: 2, title: 'Second', pageStart: 6, pageEnd: 9, numbered: true },
    ]));
    const { entries } = await draftManifestFromContentsPage(new ArrayBuffer(0), { examType: 'CBSE Class 8', subject: 'Science' });
    expect(entries.map((e) => e.fileOrdinal)).toEqual([1, 2]);
  });

  it('an interleaved (numbered: false) entry still gets no fileOrdinal — it has no file of its own, by design', async () => {
    chatComplete.mockResolvedValue(modelReply([
      { ordinal: 1, title: 'Host Chapter', pageStart: 1, pageEnd: 20, numbered: true, printedNumber: 1 },
      { ordinal: 2, title: 'Embedded Poem', pageStart: 5, pageEnd: 6, numbered: false },
    ]));
    const { entries } = await draftManifestFromContentsPage(new ArrayBuffer(0), { examType: 'CBSE', subject: 'English' });
    expect(entries[0].fileOrdinal).toBe(1);
    expect(entries[1].fileOrdinal).toBeNull();
  });

  it('the Hornbill-style irregular case is NOT silently fixed by the default — it still needs a human, and the default does not paper over the mismatch', async () => {
    // Real corpus fact: Writing Skills prints 1-6 but files are kehb111-116.
    // ordinal here is the manifest's running count (9-14, after 8 Reading
    // Skills chapters), matching neither the printed number nor the real
    // file numbers — proving the default is a starting point, not a promise.
    chatComplete.mockResolvedValue(modelReply([
      { ordinal: 9, title: 'A Letter', pageStart: 100, pageEnd: 110, numbered: true, printedNumber: 1 },
    ]));
    const { entries } = await draftManifestFromContentsPage(new ArrayBuffer(0), { examType: 'CBSE Class 11', subject: 'English', book: 'Hornbill' });
    // Defaults to printedNumber (1), which is WRONG for this book (real file
    // is kehb111, fileOrdinal should be 11) — this is exactly why the admin
    // screen keeps the File # column editable and the approval gate exists
    // regardless of what the default guessed.
    expect(entries[0].fileOrdinal).toBe(1);
    expect(entries[0].fileOrdinal).not.toBe(11);
  });
});
