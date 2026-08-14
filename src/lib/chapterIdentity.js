/**
 * Chapter identity — the root-cause fix for the 9.4% chapter-naming defect rate
 * measured on the 2026-08-12/13 non-STEM load.
 *
 * WHAT WENT WRONG, PRECISELY
 * Identity was DERIVED FROM THE NAME. syllabus.js:chapterKeyFor() built
 * 'c11_hornbill_the_portrait_of_a_lady' from the model's chapter title, so a
 * naming error WAS an identity error and there existed no representation in
 * which a name could be wrong. Three failure modes followed, all measured:
 *
 *   rename   'World Climate and Climate Classification' minted a new chapter
 *            instead of matching '...Change'                      (23 rows)
 *   capture  a wrong title landed on a REAL key: keps101 (Political Theory ch1)
 *            was filed as 'Equality' (ch3), silently merging 13 rows into a
 *            valid chapter where no orphan report could ever see them
 *   invent   a section heading was as valid a key as a chapter --
 *            'Critical Reflection' (28 rows), 'Poorvi' (33 rows, a BOOK name)
 *
 * Board, class and subject had a 0% defect rate over the same 4,866 rows. They
 * came from the FILE PATH. Chapter came from model prose. That contrast is the
 * whole design input.
 *
 * THE FIX
 * Identity is ordinal-anchored and book-scoped; the name becomes a mutable
 * label carrying aliases. A chapter can be renamed without becoming a different
 * chapter, and a wrong name can no longer land on a real key.
 *
 * NOTE — this restores the documented intent. 20260812040000 already specifies
 * book-scoped ordinal keys ('c11_hornbill_01'); syllabus.js drifted to
 * name-slugs. The migration comment and the helper have disagreed since.
 */

import { fileOrdinalFrom, candidatesForFile } from './chapterManifest';

/** Ordinal-anchored, book-scoped. `book` stays out of the UNIQUE index
 *  (exam_type, subject, chapter_key) — it is nullable and Postgres treats NULLs
 *  as distinct, which would stop the index guarding single-book subjects. The
 *  key carries the scoping instead. See 20260812040000. */
export function chapterKeyFor({ prefix = 'c', classLevel, book = null, ordinal }) {
  const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error(`chapterKeyFor: ordinal must be a positive integer, got ${JSON.stringify(ordinal)}`);
  }
  const bookSlug = book ? slug(book) : '';
  const ord = `ch${String(ordinal).padStart(2, '0')}`;
  return [`${prefix}${classLevel ?? ''}`, bookSlug, ord].filter(Boolean).join('_');
}

/**
 * DECISION RULES.
 *
 * A file proposes assignments; this decides which may be WRITTEN and which must
 * be held for a human. Nothing here consults a chapter's name: the name is a
 * label, and a label cannot be the thing that decides identity.
 *
 * Signals per proposal:
 *   S1 manifest ordinal chosen   (closed set — cannot invent)
 *   S2 printed chapter number observed in the page headers
 *   S3 file ordinal parsed from the filename
 *
 * NUMBERED entries need all three to agree. That single rule catches `keps101`
 * (file ordinal 1, chose ordinal 3) and every over-split, because a file may
 * carry at most ONE numbered chapter.
 *
 * INTERLEAVED entries are the case a naive "one file, one chapter" rule gets
 * wrong. 20260812040000 records that Hornbill's five poems are unnumbered and
 * sit INSIDE the prose chapter PDFs — 'A Photograph' is in kehb101, 'The
 * Laburnum Top' and 'The Voice of the Rain' are both in kehb103. They have no
 * printed number (S2 cannot exist) and no file of their own (S3 is the host
 * chapter's). Their identity is POSITIONAL: the manifest's page range for the
 * poem must fall inside the pages the file actually covers. Treating them as
 * over-splits would reject correct content; treating any extra entry as
 * interleaved would re-open the over-split hole. The manifest, approved by a
 * human, is what distinguishes the two.
 *
 * A FOURTH SIGNAL, ADDED FOR THE UPLOAD UI: adminSelectedOrdinal. An admin
 * uploading a file can pick its chapter from the approved manifest at upload
 * time — a picker, never free text, because free text is how 'Poorvi' and
 * 'Critical Reflection' got in last time; a picker can only ever offer a real
 * entry. A deliberate human pick is decisive: it settles a numbered proposal
 * regardless of what the ordinal/printed signals say, which matters for
 * hand-named files where a file ordinal cannot be parsed at all. It does NOT
 * touch interleaved entries, which stay purely positional — an admin picking
 * "chapter 1" says nothing about which of chapter 1's interleaved poems a
 * given chunk belongs to, so overriding position there would be a guess
 * wearing the authority of a real signal. And it cannot select an ordinal
 * outside the manifest: the closed set still holds even here.
 */
export const VERDICT = { ACCEPT: 'accept', ACCEPT_WITH_FLAG: 'accept_with_flag', REJECT: 'reject' };

export function decideAssignments({ manifest, fileOrdinal, filePageRange, proposals, adminSelectedOrdinal = null }) {
  const byOrdinal = new Map(manifest.map((m) => [m.ordinal, m]));
  if (adminSelectedOrdinal != null && !byOrdinal.has(adminSelectedOrdinal)) {
    // Defence in depth: a UI picker only ever offers manifest entries, but this
    // is library code and must not trust its caller to have enforced that.
    throw new Error(`adminSelectedOrdinal ${adminSelectedOrdinal} is not in the manifest`);
  }
  const out = [];

  const numbered = proposals.filter((p) => byOrdinal.get(p.ordinal)?.numbered !== false);
  const tooManyNumbered = numbered.length > 1;

  for (const p of proposals) {
    const entry = byOrdinal.get(p.ordinal);

    // S1 failed: not a manifest ordinal at all. This is where 'Poorvi' and
    // 'Critical Reflection' die — a closed set has no room for a book name or a
    // section heading.
    if (!entry) {
      out.push({ ...p, verdict: VERDICT.REJECT, reason: `ordinal ${p.ordinal} is not in the manifest` });
      continue;
    }

    if (entry.numbered === false) {
      // Positional only. Must sit inside the pages this file covers.
      const inside = filePageRange
        && entry.pageStart >= filePageRange[0]
        && entry.pageEnd <= filePageRange[1];
      out.push(inside
        ? { ...p, entry, verdict: VERDICT.ACCEPT, reason: 'interleaved, page range inside file span' }
        : { ...p, entry, verdict: VERDICT.REJECT, reason: `interleaved entry pp${entry.pageStart}-${entry.pageEnd} outside file span ${filePageRange?.join('-') ?? 'unknown'}` });
      continue;
    }

    // A decisive human pick resolves this proposal outright, ahead of the
    // over-split check — it is exactly what settles a model that proposed the
    // wrong chapter, or more than one, once an admin has looked at the file.
    if (adminSelectedOrdinal != null) {
      out.push(p.ordinal === adminSelectedOrdinal
        ? { ...p, entry, verdict: VERDICT.ACCEPT, reason: 'admin-selected chapter at upload — corroboration signals overridden' }
        : { ...p, entry, verdict: VERDICT.REJECT, reason: `admin selected ordinal ${adminSelectedOrdinal} at upload; this proposal (ordinal ${p.ordinal}) conflicts` });
      continue;
    }

    if (tooManyNumbered) {
      out.push({ ...p, entry, verdict: VERDICT.REJECT, reason: `${numbered.length} numbered chapters proposed from one file — over-split` });
      continue;
    }

    /* The manifest carries the binding; it is NOT inferred from `ordinal`.
     * Hornbill's Writing Skills files are kehb111-116 while the section prints
     * them as 1-6, so `fileOrdinal === ordinal` would reject all six. Falling
     * back to `ordinal` keeps the simple books — where all three coincide —
     * working without every manifest having to restate it. */
    const expectedFileOrd = entry.fileOrdinal ?? entry.ordinal;
    const expectedPrinted = entry.printedNumber ?? entry.ordinal;

    const ordinalAgrees = fileOrdinal == null || expectedFileOrd == null || expectedFileOrd === fileOrdinal;
    const printedAgrees = p.observedNumber == null || expectedPrinted == null || p.observedNumber === expectedPrinted;

    if (!ordinalAgrees) {
      out.push({ ...p, entry, verdict: VERDICT.REJECT, reason: `chose ordinal ${entry.ordinal} (file ${expectedFileOrd}) but filename says ${fileOrdinal}` });
    } else if (!printedAgrees) {
      out.push({ ...p, entry, verdict: VERDICT.REJECT, reason: `chose ordinal ${entry.ordinal} (printed ${expectedPrinted}) but printed header says ${p.observedNumber}` });
    } else if (p.observedNumber == null || fileOrdinal == null) {
      // Two of three agree; the third could not be read. Writable, but a human
      // should see which corroboration was unavailable.
      out.push({ ...p, entry, verdict: VERDICT.ACCEPT_WITH_FLAG, reason: p.observedNumber == null ? 'no printed chapter number readable' : 'no ordinal in filename' });
    } else {
      out.push({ ...p, entry, verdict: VERDICT.ACCEPT, reason: 'all three signals agree' });
    }
  }
  return out;
}

/** A title that differs from the manifest is an ALIAS, never a new chapter.
 *  This is what turns the 23-row 'World Climate and Climate Classification'
 *  rename from a duplicate chapter into a second label on the same key. */
export function aliasFor(entry, observedTitle) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!observedTitle || norm(observedTitle) === norm(entry.title)) return null;
  return observedTitle;
}

/** Positional chunk→chapter assignment. A chunk belongs to whichever accepted
 *  entry's page range contains its printed page — never to the nearest heading
 *  above it. Headings are what captured 28 rows under 'Critical Reflection';
 *  pages cannot be captured that way. */
export function chapterForPage(acceptedEntries, pageNo) {
  if (pageNo == null) return null;
  return acceptedEntries.find((e) => pageNo >= e.pageStart && pageNo <= e.pageEnd) ?? null;
}

/**
 * PHASE 2 INTEGRATION POINT. Given an approved manifest and one uploaded
 * file's extracted chunks (each carrying the page it came from), decide real
 * chapter identity for every chunk — or refuse to write any of them.
 *
 * Returns data, never touches Supabase — same separation buildKbRows()
 * already uses in contentExtraction.js, so this stays unit-testable without a
 * live database and the caller (AdminContentIntake.jsx) owns the actual
 * insert/RPC calls.
 *
 * Deliberately does NOT let a chunk propose its own ordinal (the old pipeline's
 * failure mode — a model guess IS the free-form proposal that produced
 * 'Poorvi' and the keps101 capture). Proposals here come only from
 * candidatesForFile(), i.e. only from what the filename and the approved
 * manifest can jointly support — the closed set holds before decideAssignments
 * even runs, not just inside it.
 *
 * S2 (printed chapter number in page headers) is not read in this slice — no
 * caller supplies observedNumber, so decideAssignments' own ACCEPT_WITH_FLAG
 * path (two of three signals agree, third unavailable) is the expected normal
 * result, not an error. `flagged: true` surfaces that to the caller.
 *
 * A REJECT on ANY candidate blocks the WHOLE file — REBUILD_HANDOFF.md's rule
 * is "disagree: do not write, flag for owner review", not "write everything
 * except the one you're unsure about". A chunk whose page falls outside every
 * accepted entry's range is the same refusal, not a guess at the nearest one.
 */
export function assignChapters({ manifest, filename, chunks, classLevel, book = null, prefix = 'c', adminSelectedOrdinal = null }) {
  const fileOrdinal = fileOrdinalFrom(filename);
  const pages = (chunks ?? []).map((c) => c.pageNo).filter((p) => p != null);
  const filePageRange = pages.length ? [Math.min(...pages), Math.max(...pages)] : null;

  let candidates = candidatesForFile(manifest, fileOrdinal, filePageRange);

  // A decisive human pick NARROWS the candidate set to exactly that entry — it
  // does not merely supply one when the file produced none.
  //
  // It used to only fill an EMPTY candidate list, which quietly made
  // multi-chapter files unassignable: one file covering three manifest entries
  // yields three candidates, and decideAssignments rejects every proposal that
  // is not the selected ordinal, while any REJECT here blocks the whole file.
  // The pick could therefore never resolve the one case it exists for — an
  // over-split file where an admin has looked and said which chapter this is.
  // A unit PDF holding three texts is exactly that case, and it is now the
  // normal path: extractNotesByManifest splits by the manifest and hands each
  // resulting lesson its own manifestOrdinal to corroborate against.
  //
  // The entry still has to be real — decideAssignments throws on an ordinal the
  // manifest does not contain, so this narrows within the closed set, never out
  // of it.
  if (adminSelectedOrdinal != null) {
    const picked = manifest.find((m) => m.ordinal === adminSelectedOrdinal);
    if (picked) candidates = [picked];
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: fileOrdinal == null
        ? `Could not read a chapter number from "${filename}", and it matches no manifest entry by page range. This file's chapter must be picked manually.`
        : `No approved manifest entry has file ordinal ${fileOrdinal} (parsed from "${filename}"). This file does not match any chapter in the approved manifest.`,
    };
  }

  const proposals = candidates.map((c) => ({ ordinal: c.ordinal, observedNumber: null }));
  const decided = decideAssignments({ manifest, fileOrdinal, filePageRange, proposals, adminSelectedOrdinal });

  const rejected = decided.filter((d) => d.verdict === VERDICT.REJECT);
  if (rejected.length > 0) {
    return { ok: false, reason: rejected[0].reason, allReasons: [...new Set(rejected.map((r) => r.reason))] };
  }

  const acceptedEntries = decided.map((d) => d.entry);
  const flagged = decided.some((d) => d.verdict === VERDICT.ACCEPT_WITH_FLAG);

  const chapterKeysByOrdinal = new Map();
  const syllabusEntries = [];
  const chunksOut = [];
  for (const chunk of chunks) {
    // Positional lookup first. But when there is only ONE accepted entry —
    // the overwhelming common case, a single-chapter file with no interleaved
    // poems — there is no actual ambiguity to resolve positionally: the whole
    // file belongs to that one chapter regardless of which page a chunk
    // starts on. Requiring an exact page match here was found to reject real
    // uploads whose extraction genuinely couldn't infer page_start (a bare,
    // short lesson gives the model nothing to anchor a page number to) even
    // though there was nothing to disambiguate. Positional assignment stays
    // MANDATORY once there is more than one accepted entry (a host chapter
    // plus an interleaved poem) — that IS a real ambiguity, and a missing
    // page number there must still refuse rather than guess which one.
    const entry = chapterForPage(acceptedEntries, chunk.pageNo)
      ?? (acceptedEntries.length === 1 ? acceptedEntries[0] : null);
    if (!entry) {
      return { ok: false, reason: `Chunk on page ${chunk.pageNo ?? '?'} falls outside every accepted chapter's page range for this file, and more than one chapter is accepted for it — cannot tell which one it belongs to.` };
    }
    if (!chapterKeysByOrdinal.has(entry.ordinal)) {
      const chapterKey = chapterKeyFor({ prefix, classLevel, book, ordinal: entry.ordinal });
      chapterKeysByOrdinal.set(entry.ordinal, chapterKey);
      // `unit` rides along from the approved manifest entry rather than from
      // the operator's single Unit field on the intake form. Both exist, and
      // they disagree the moment one file spans two units — the manifest is
      // per-entry and human-approved, so it wins.
      syllabusEntries.push({ chapterKey, chapterName: entry.title, sortOrder: entry.ordinal, unit: entry.unit ?? null });
    }
    chunksOut.push({
      ...chunk,
      chapterKey:  chapterKeysByOrdinal.get(entry.ordinal),
      chapterName: entry.title,
      unit:        entry.unit ?? null,
    });
  }

  return { ok: true, flagged, chunks: chunksOut, syllabusEntries };
}
