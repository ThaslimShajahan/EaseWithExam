import { describe, it, expect } from 'vitest';
import { detectPrintedPageRange, matchFileToManifest } from '../pageRangeMatch';

/* ── detectPrintedPageRange ─────────────────────────────────────────────
 * Fixtures below mirror the real text-layer shape verified live against
 * "9 NCRT/9 ENGLISH/1 How I Taught My Grandmother to Read.pdf" — each page's
 * footer prints its own page number as a bare token at the page edge. */

const pageWithFooter = (n, body = 'some prose here') => `${body} ${n}`;
const pageNoFooter = (body = 'some prose with no footer number') => body;

describe('detectPrintedPageRange', () => {
  it('detects a clean run of footer page numbers (the real Kaveri chapter-1 shape)', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => pageWithFooter(n));
    expect(detectPrintedPageRange(pages)).toEqual({ firstPage: 1, lastPage: 5, runLength: 5 });
  });

  it('a single stray number in prose (a year, a footnote) does not count as a range', () => {
    const pages = [pageNoFooter('published in 1998'), pageNoFooter('see note 42 above'), pageNoFooter()];
    expect(detectPrintedPageRange(pages).firstPage).toBeNull();
  });

  it('keeps the LONGEST increasing run when a stray number breaks the true sequence early', () => {
    // page 1 has a stray "7" (not part of the real footer sequence), pages
    // 2-6 are the real, longer run of genuine footers.
    const pages = ['stray reference 7', pageWithFooter(10), pageWithFooter(11), pageWithFooter(12), pageWithFooter(13), pageWithFooter(14)];
    expect(detectPrintedPageRange(pages)).toEqual({ firstPage: 10, lastPage: 14, runLength: 5 });
  });

  it('a real footer sequence that starts partway through the file is detected from where it starts', () => {
    // Mirrors the real "Bharat Our Land" page 23 case: a fresh section's
    // first page sometimes carries no footer number at all (title page),
    // but the run resumes cleanly on the next page.
    const pages = [pageNoFooter('Bharat Our Land'), pageWithFooter(24), pageWithFooter(25), pageWithFooter(26)];
    expect(detectPrintedPageRange(pages)).toEqual({ firstPage: 24, lastPage: 26, runLength: 3 });
  });

  it('a single page with no run at all is never trusted alone', () => {
    expect(detectPrintedPageRange([pageWithFooter(1)]).firstPage).toBeNull();
  });

  it('empty pages array returns no detection', () => {
    expect(detectPrintedPageRange([])).toEqual({ firstPage: null, lastPage: null, runLength: 0 });
  });
});

/* ── matchFileToManifest ─────────────────────────────────────────────── */

// The real, corrected Kaveri manifest shape (fileOrdinal 1-8, matching the
// real filenames, verified live against production).
const kaveriEntries = [
  { ordinal: 1, title: 'How I Taught My Grandmother to Read', numbered: true, pageStart: 1, pageEnd: 32, fileOrdinal: 1 },
  { ordinal: 2, title: 'The Pot Maker', numbered: true, pageStart: 33, pageEnd: 68, fileOrdinal: 2 },
  { ordinal: 3, title: 'Winds of Change', numbered: true, pageStart: 69, pageEnd: 96, fileOrdinal: 3 },
];

describe('matchFileToManifest', () => {
  it('confirmed: detected page range and filename both point to the same entry', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: 1, lastPage: 32 },
      filename: '1 How I Taught My Grandmother to Read.pdf',
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('confirmed');
    expect(r.suggested).toEqual([kaveriEntries[0]]);
  });

  it('content: page range matches exactly one entry, filename gives no signal', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: 33, lastPage: 68 },
      filename: 'scan_004.pdf', // no parseable ordinal
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('content');
    expect(r.suggested).toEqual([kaveriEntries[1]]);
  });

  it('filename: no readable page numbers, filename ordinal matches exactly one entry', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: null, lastPage: null },
      filename: '3 Winds of Change.pdf',
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('filename');
    expect(r.suggested).toEqual([kaveriEntries[2]]);
  });

  it('conflict: content and filename disagree — refuses to suggest either, forces a manual pick', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: 69, lastPage: 96 }, // really "Winds of Change"
      filename: '2 The Pot Maker.pdf', // filename says entry 2
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('conflict');
    expect(r.suggested).toEqual([]);
    expect(r.reason).toMatch(/Winds of Change/);
    expect(r.reason).toMatch(/Pot Maker/);
  });

  it('multiple: detected range spans more than one manifest entry (a genuinely combined file)', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: 30, lastPage: 40 }, // overlaps both entry 1 (ends 32) and entry 2 (starts 33)
      filename: 'unit1.pdf',
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('multiple');
    expect(r.suggested.length).toBe(2);
  });

  it('none: no page numbers readable and no filename signal — the honest fallback', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: null, lastPage: null },
      filename: 'IMG_scan_final.pdf',
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('none');
    expect(r.suggested).toEqual([]);
  });

  it('none: detected range is real but overlaps nothing in the manifest', () => {
    const r = matchFileToManifest({
      detectedRange: { firstPage: 500, lastPage: 520 },
      filename: 'appendix.pdf',
      entries: kaveriEntries,
    });
    expect(r.confidence).toBe('none');
  });
});
