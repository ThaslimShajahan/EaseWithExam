/**
 * Chapter manifests — a book's contents page, approved once by a human, used as
 * the closed set that per-file chapter assignment selects from.
 *
 * See supabase/migrations/20260813020000 for why this exists and why an entry
 * carries three different numbers. Short version: `ordinal` is identity and sort
 * order, `printedNumber` is what the book prints, `fileOrdinal` is the number in
 * the filename, and they genuinely differ — Hornbill's Writing Skills files are
 * kehb111-116 while the section prints them as 1-6.
 */

/** Front matter, not a chapter: NCERT short codes end in two DIGITS for a real
 *  chapter; letter suffixes mark answers (an), prelims (ps) and appendices (aN).
 *  Same rule the corpus loader uses to keep "Answers" out of the chapter list. */
const NCERT_CODE = /^([a-z]{4})(\d)([a-z0-9]{2})$/i;

/**
 * The file-ordinal signal. Returns null when no number can be read, which is a
 * legitimate answer — decideAssignments degrades to ACCEPT_WITH_FLAG rather than
 * rejecting a file for being hand-named.
 *
 * Ordered by reliability, not convenience. An NCERT code is unambiguous; a bare
 * leading digit is the weakest reading and goes last, so "Chapter 5 ..." is read
 * as 5 and "THEME B CHAPTER 3 ..." as 3 rather than as whatever number appears
 * first in the string.
 */
export function fileOrdinalFrom(filename) {
  const base = String(filename ?? '').replace(/\.[a-z0-9]+$/i, '').trim();
  if (!base) return null;

  const code = base.match(NCERT_CODE);
  if (code) return /^\d{2}$/.test(code[3]) ? Number(code[3]) : null;  // letter suffix = front matter

  const labelled = base.match(/\b(?:chapter|unit|lesson|theme)\s*[-_]?\s*(\d{1,3})\b/i);
  if (labelled) return Number(labelled[1]);

  const leading = base.match(/^(\d{1,3})(?!\d)/);
  if (leading) return Number(leading[1]);

  return null;
}

const isInt = (v) => Number.isInteger(v);

/**
 * Structural validation. This runs BEFORE a human is asked to approve, so the
 * approval screen never shows a manifest that could not be used anyway.
 *
 * Returns { ok, errors: [...] } rather than throwing: an admin needs every
 * problem at once, not the first one.
 */
export function validateManifest(entries) {
  const errors = [];
  if (!Array.isArray(entries)) return { ok: false, errors: ['entries must be an array'] };
  if (entries.length === 0) return { ok: false, errors: ['manifest is empty'] };

  const seenOrdinal = new Map();
  const numbered = [];

  entries.forEach((e, i) => {
    const at = `entry ${i}${e?.title ? ` ("${e.title}")` : ''}`;
    if (!isInt(e?.ordinal) || e.ordinal < 1) errors.push(`${at}: ordinal must be a positive integer`);
    if (!String(e?.title ?? '').trim()) errors.push(`${at}: title is required`);
    if (!isInt(e?.pageStart) || !isInt(e?.pageEnd)) errors.push(`${at}: pageStart and pageEnd must be integers`);
    else if (e.pageEnd < e.pageStart) errors.push(`${at}: pageEnd ${e.pageEnd} is before pageStart ${e.pageStart}`);

    // `unit` is the book's own grouping heading for this entry ("Unit 1: Wit
    // and Wisdom") and is OPTIONAL — plenty of books have no units at all, and
    // requiring one would reject them. But an entry that carries the key must
    // carry a real label: an empty string would group chapters under a blank
    // heading in every browser that groups by it, which reads as a bug rather
    // than as "this book has no units" (that is what null means).
    if (e?.unit != null) {
      if (typeof e.unit !== 'string') errors.push(`${at}: unit must be a string or null`);
      else if (!e.unit.trim()) errors.push(`${at}: unit is present but empty — use null when the book has no units`);
    }

    if (isInt(e?.ordinal)) {
      if (seenOrdinal.has(e.ordinal)) errors.push(`${at}: duplicate ordinal ${e.ordinal}, already used by "${seenOrdinal.get(e.ordinal)}"`);
      else seenOrdinal.set(e.ordinal, e.title);
    }

    // A numbered entry is one a file maps onto, so it needs the binding that
    // makes corroboration possible. An interleaved one has neither by
    // definition, and claiming either would be a false signal.
    if (e?.numbered === false) {
      if (e.printedNumber != null) errors.push(`${at}: interleaved entries have no printed chapter number`);
      if (e.fileOrdinal != null) errors.push(`${at}: interleaved entries have no file of their own`);
    } else {
      numbered.push(e);
      if (e?.printedNumber != null && !isInt(e.printedNumber)) errors.push(`${at}: printedNumber must be an integer or null`);
      if (e?.fileOrdinal != null && !isInt(e.fileOrdinal)) errors.push(`${at}: fileOrdinal must be an integer or null`);
    }
  });

  // Numbered chapters partition the book, so their page ranges cannot overlap.
  // Two chapters claiming page 40 means one of them will silently swallow the
  // other's chunks under positional assignment.
  const sorted = numbered.filter((e) => isInt(e.pageStart) && isInt(e.pageEnd))
    .slice().sort((a, b) => a.pageStart - b.pageStart);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].pageStart <= sorted[i - 1].pageEnd) {
      errors.push(`page ranges overlap: "${sorted[i - 1].title}" pp${sorted[i - 1].pageStart}-${sorted[i - 1].pageEnd} and "${sorted[i].title}" pp${sorted[i].pageStart}-${sorted[i].pageEnd}`);
    }
  }

  // An interleaved entry with no numbered host is unreachable: nothing will ever
  // supply a file whose span contains it, so it would sit in the manifest
  // forever and never receive content.
  for (const e of entries) {
    if (e?.numbered !== false || !isInt(e.pageStart)) continue;
    const host = numbered.some((n) => isInt(n.pageStart) && e.pageStart >= n.pageStart && e.pageEnd <= n.pageEnd);
    if (!host) errors.push(`interleaved "${e.title}" pp${e.pageStart}-${e.pageEnd} sits inside no numbered chapter — nothing will ever load it`);
  }

  return { ok: errors.length === 0, errors };
}

/** Entries a given file may legitimately claim: its own numbered chapter, plus
 *  any interleaved entries whose pages fall inside the file's span. */
export function candidatesForFile(entries, fileOrdinal, filePageRange) {
  const own = entries.filter((e) => e.numbered !== false && e.fileOrdinal === fileOrdinal);
  const inside = filePageRange
    ? entries.filter((e) => e.numbered === false
        && e.pageStart >= filePageRange[0] && e.pageEnd <= filePageRange[1])
    : [];
  return [...own, ...inside];
}
