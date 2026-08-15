/**
 * Draws a DRAFT chapter manifest from a book's own contents page.
 *
 * This is Phase 1 of the rebuild: turn "what chapters does this book have" from
 * something 372 independent per-file extractions each guessed at into one
 * extraction, read against the source that actually enumerates them, reviewed
 * by a human exactly once. See chapterManifest.js and
 * supabase/migrations/20260813020000 for why identity then becomes checkable
 * instead of asserted.
 *
 * Deliberately produces a DRAFT, never a write. admin_upsert_chapter_manifest /
 * admin_approve_chapter_manifest are the only path to `status = 'approved'`,
 * and per-file loading refuses to run against anything else — see
 * requireApprovedManifest() in this file.
 */

import { extractPagesWithVision } from './pdfVision';
import { chatComplete } from './aiProxy';
import { validateManifest } from './chapterManifest';

const MANIFEST_MAX_TOKENS = 4000; // a contents page is short; this is not the 3000-token wall NOTES_MAX_TOKENS hit

const SYSTEM_PROMPT = `You read a textbook's own Contents / Table of Contents page(s) and transcribe
its chapter list EXACTLY as printed. You do not invent, merge, split, reorder or
rename anything the page does not show.

Return JSON: { "entries": [ { "ordinal", "title", "unit", "pageStart", "pageEnd", "numbered", "printedNumber", "band" } ] }

- ordinal: your own running count starting at 1, in the order printed. This is
  the chapter's IDENTITY going forward, so it must be stable and sequential —
  never skip, never reuse.
- title: the printed title verbatim. Do not paraphrase, expand abbreviations,
  or "fix" spelling.
- pageStart / pageEnd: the printed page range for that chapter, from the
  contents page itself if it prints ranges, otherwise pageStart only and infer
  pageEnd from the next entry's pageStart minus 1 (last chapter: null).
- numbered: true for a chapter the contents page gives its own number
  (1, 2, 3...). false ONLY for something explicitly listed but NOT numbered in
  the sequence — an unnumbered poem inside a numbered prose section is the
  textbook example. If you are not looking at that exact situation, use true.
- printedNumber: the number actually printed next to this entry (a section can
  restart at 1 partway through a book — Hornbill's Writing Skills does exactly
  this after 8 numbered Reading Skills chapters). null if numbered is false.
- unit: the book's own grouping heading this entry sits under, transcribed as
  printed, including its number if it has one ("Unit 1: Wit and Wisdom",
  "Theme 2: The Living World"). Every entry inside that heading repeats the SAME
  string exactly — this is what groups them together downstream, so an
  inconsistent rendering splits one unit into several. null if the contents page
  shows no such grouping. Do not invent a unit from the chapter's subject
  matter: transcribe a heading the page actually prints, or return null.
- band: a short lowercase word for which SECTION of the book this entry is in,
  if the contents page shows sections (e.g. "reading", "writing"). null if the
  book has no sections. This is a coarse structural bucket, NOT the printed unit
  heading — when the page shows both, they are different fields.

If the page lists supplementary/appendix/answer material with no chapter
number, DO NOT include it as an entry — that is exactly the front matter this
process exists to keep out of the chapter list.

If you cannot find a genuine contents page in this excerpt, return
{ "entries": [], "noContentsPage": true } rather than guessing at chapters from
other pages.`;

/**
 * @param {ArrayBuffer} arrayBuffer  the book's front-matter PDF (or the pages
 *   containing its Contents page)
 * @param {{ examType, subject, book }} ctx
 * @returns {{ entries: object[], raw: object, pageCount: number }}
 */
export async function draftManifestFromContentsPage(arrayBuffer, ctx = {}) {
  const { examType, subject, book } = ctx;

  // extractFigures:false — a contents page is text, not a figure; vision only
  // needs to fire on the (common) case of a scanned/thin-text contents page.
  const ex = await extractPagesWithVision(arrayBuffer, { subject, examType }, { extractFigures: false });
  const marked = ex.pages.map((t, i) => `[[PAGE ${i + 1}]]\n${t}`).join('\n\n');

  const resp = await chatComplete({
    model:           'gpt-4o',
    max_tokens:      MANIFEST_MAX_TOKENS,
    temperature:     0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${examType ?? ''} ${subject ?? ''}${book ? ` — ${book}` : ''}\n\nCONTENT:\n${marked}` },
    ],
  });

  const finish = resp.choices[0].finish_reason;
  if (finish && finish !== 'stop') {
    throw new Error(`Manifest extraction ended with finish_reason='${finish}' — response is incomplete.`);
  }

  const raw = resp.choices[0].message?.content;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Manifest response did not parse as JSON: ${e.message}. finish_reason=${finish ?? 'null'}, received ${raw?.length ?? 0} chars, ends: ${JSON.stringify(String(raw ?? '').slice(-100))}`);
  }

  if (data.noContentsPage) {
    throw new Error('No contents page found in this excerpt — supply the front-matter pages that contain it.');
  }

  const entries = normaliseEntries(data.entries ?? []);
  return { entries, raw: data, pageCount: ex.pageCount };
}

/** Coerces model output into the shape validateManifest expects, without
 *  silently repairing anything invalid — normalisation fixes TYPES, not
 *  CONTENT. A garbled entry still fails validateManifest and blocks approval;
 *  it does not get quietly patched into something that looks fine. */
function normaliseEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    const numbered = e?.numbered !== false;
    const printedNumber = numbered
      ? (Number.isFinite(Number(e?.printedNumber)) ? Math.trunc(Number(e.printedNumber)) : null)
      : null;
    const ordinal = Number.isFinite(Number(e?.ordinal)) ? Math.trunc(Number(e.ordinal)) : null;

    return {
      ordinal,
      title:         String(e?.title ?? '').trim(),
      // Trimmed to null rather than kept as '' — validateManifest rejects an
      // empty unit precisely so a blank grouping heading can never reach the
      // browsers, and "the model returned whitespace" means "no unit", not
      // "a unit whose name is nothing".
      unit:          String(e?.unit ?? '').trim() || null,
      // Page numbers are 1-indexed and can never legitimately be 0 or
      // negative — a model reply of 0 is its own "unknown", not a real page,
      // most often the last chapter's pageEnd (the prompt asks for null
      // there; some replies send 0 instead). Coercing to null rather than
      // trusting Number.isFinite(0) === true matters: an uncaught 0 makes
      // pageEnd < pageStart look like a real "page range" error rather than
      // what it actually is — a missing value.
      pageStart:     Number.isFinite(Number(e?.pageStart)) && Number(e.pageStart) >= 1 ? Math.trunc(Number(e.pageStart)) : null,
      pageEnd:       Number.isFinite(Number(e?.pageEnd)) && Number(e.pageEnd) >= 1 ? Math.trunc(Number(e.pageEnd)) : null,
      numbered,
      printedNumber,
      // Defaults to what the book prints next to the chapter (or, failing
      // that, this manifest's own running ordinal) — a real starting value
      // instead of null, because the overwhelming common case in this corpus
      // is a filename that embeds exactly that number ("Chapter 2 Power
      // Play.pdf" -> printedNumber 2). This is a DEFAULT, never a silent
      // final answer: the admin reviews and can correct every File # in the
      // manifest screen before saving, same as every other field here. It
      // does NOT fix the irregular case (Hornbill's Writing Skills print
      // 1-6 but file kehb111-116) — nothing can guess that blind, and the
      // admin still has to type the real numbers for books like that. What
      // it fixes is the twice-repeated failure mode: a normal, predictably-
      // named book shipping with every File # simply forgotten as null.
      fileOrdinal:   numbered ? (printedNumber ?? ordinal) : null,
      band:          e?.band ? String(e.band).trim().toLowerCase() : null,
    };
  });
}

/**
 * The gate every per-file loader must call before writing a single row. No
 * chapter identity may be used from anything but an approved manifest — that
 * is the whole point of the table being separate from a draft.
 */
export function requireApprovedManifest(manifestRow) {
  if (!manifestRow) throw new Error('No manifest found for this book — extract and approve one before loading its chapters.');
  if (manifestRow.status !== 'approved') {
    throw new Error(`Manifest for this book is '${manifestRow.status}', not 'approved' — an admin must review and approve it before content can load.`);
  }
  const { ok, errors } = validateManifest(manifestRow.entries);
  if (!ok) {
    // An approved manifest should never fail this — it means the immutability
    // guarantee in admin_upsert_chapter_manifest was bypassed somehow. Fail
    // loudly rather than load against a manifest that cannot be trusted.
    throw new Error(`Approved manifest failed structural validation (this should be impossible): ${errors.join('; ')}`);
  }
  return manifestRow;
}
