/**
 * Detects a file's real printed page range from its own text, and matches it
 * against an approved manifest's entries by page overlap — a corroboration
 * signal for the multi-file upload review screen (AdminContentIntake.jsx).
 *
 * WHY DETECTION IS DETERMINISTIC, NOT A SECOND AI PASS
 * runNotesExtraction already asks the model for printed page_start/page_end
 * per lesson (contentExtraction.js's SYSTEM_PROMPT: "the actual printed page
 * numbers... as they visibly appear in the text"), but calling it here — before
 * we know which manifest entry a file belongs to — would mean the model
 * decides where a lesson (and so a chapter) starts and ends, which is exactly
 * the un-anchored guess the manifest-driven split exists to prevent. This
 * module reads the SAME signal a human would (a running header/footer number
 * printed on the page) directly off the text layer already produced by
 * extractPagesWithVision — no extra AI call, no chapter-boundary guessing,
 * and it costs nothing to run before a human has looked at anything.
 *
 * Never a decision-maker. matchFileToManifest() returns a suggestion and a
 * reason string; the caller (the review screen) still requires an explicit
 * human confirmation regardless of confidence tier — same "picker, never
 * free text" discipline as chapterIdentity.js's adminSelectedOrdinal.
 */

import { fileOrdinalFrom } from './chapterManifest';

const PAGE_NUM_RE = /^\d{1,4}$/;

/** A page's own candidate printed-page number: a bare short digit run sitting
 *  near either edge of the page's text, which is where a running header or
 *  footer actually prints one. Null — never a guess — when nothing plausible
 *  is there. */
function candidateFromPage(text) {
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const edge = [...tokens.slice(0, 3), ...tokens.slice(-3)];
  for (const t of edge) {
    if (PAGE_NUM_RE.test(t)) return Number(t);
  }
  return null;
}

/**
 * Detects the real printed page range a file's content falls in.
 *
 * Real detection, not a guess: takes one candidate number per page, then
 * keeps only the LONGEST run of pages whose candidates increase by exactly 1
 * page-over-page. A stray short number in prose (a year, a footnote, a verse
 * number) never forms a multi-page increasing run the way a genuine page
 * footer does, so it gets discarded rather than trusted — requiring at least
 * 2 agreeing pages before returning a range at all is what makes that
 * discrimination possible.
 *
 * @param {string[]} pages  per-page text, as extractPagesWithVision returns
 * @returns {{ firstPage: number|null, lastPage: number|null, runLength: number }}
 */
export function detectPrintedPageRange(pages) {
  const candidates = (pages ?? []).map(candidateFromPage);
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] == null) { curStart = -1; curLen = 0; continue; }
    if (curStart === -1 || candidates[i] !== candidates[i - 1] + 1) { curStart = i; curLen = 1; }
    else { curLen++; }
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
  }

  if (bestLen < 2) return { firstPage: null, lastPage: null, runLength: 0 };
  const firstPage = candidates[bestStart];
  return { firstPage, lastPage: firstPage + bestLen - 1, runLength: bestLen };
}

/** Overlap of range A inside range B, as a fraction of A's own length. 0 if
 *  either range is unknown or they don't overlap at all. */
function overlapFraction(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return 0;
  const lo = Math.max(aStart, bStart), hi = Math.min(aEnd, bEnd);
  if (hi < lo) return 0;
  return (hi - lo + 1) / (aEnd - aStart + 1);
}

/**
 * Suggests which manifest entry (or entries) a file belongs to, from two
 * independent, checkable signals: the detected printed-page range (content)
 * and fileOrdinalFrom(filename) (the existing filename signal, unchanged).
 * Agreement is the only thing that produces a confident single suggestion;
 * disagreement or absence is reported honestly rather than resolved.
 *
 * @param {{firstPage:number|null,lastPage:number|null}} detectedRange
 * @param {string} filename
 * @param {object[]} entries  the approved manifest's entries
 * @returns {{ suggested: object[], confidence: 'confirmed'|'content'|'filename'|'conflict'|'multiple'|'none', reason: string }}
 */
export function matchFileToManifest({ detectedRange, filename, entries }) {
  const numbered = (entries ?? []).filter((e) => e.numbered !== false);
  const byOverlap = numbered
    .map((e) => ({ entry: e, overlap: overlapFraction(detectedRange?.firstPage, detectedRange?.lastPage, e.pageStart, e.pageEnd) }))
    .filter((c) => c.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const fileOrd = fileOrdinalFrom(filename);
  const fileOrdMatch = fileOrd != null ? numbered.find((e) => e.fileOrdinal === fileOrd) ?? null : null;

  if (byOverlap.length === 1 && fileOrdMatch === byOverlap[0].entry) {
    return { suggested: [byOverlap[0].entry], confidence: 'confirmed', reason: 'detected page range and the filename both point to this chapter' };
  }
  if (byOverlap.length === 1 && !fileOrdMatch) {
    return { suggested: [byOverlap[0].entry], confidence: 'content', reason: `detected pages ${detectedRange.firstPage}-${detectedRange.lastPage} overlap only this chapter's range` };
  }
  if (byOverlap.length === 0 && fileOrdMatch) {
    return { suggested: [fileOrdMatch], confidence: 'filename', reason: 'no readable printed page numbers in this file — matched by filename only' };
  }
  if (byOverlap.length >= 1 && fileOrdMatch && !byOverlap.some((c) => c.entry === fileOrdMatch)) {
    return {
      suggested: [], confidence: 'conflict',
      reason: `detected pages point to "${byOverlap[0].entry.title}" but the filename points to "${fileOrdMatch.title}" — pick manually`,
    };
  }
  if (byOverlap.length > 1) {
    return {
      suggested: byOverlap.map((c) => c.entry), confidence: 'multiple',
      reason: `detected pages ${detectedRange.firstPage}-${detectedRange.lastPage} overlap ${byOverlap.length} chapters — pick which one`,
    };
  }
  return {
    suggested: [], confidence: 'none',
    reason: detectedRange?.firstPage == null
      ? 'no printed page numbers could be read from this file — pick manually'
      : `detected pages ${detectedRange.firstPage}-${detectedRange.lastPage} don't overlap any chapter in the manifest — pick manually`,
  };
}
