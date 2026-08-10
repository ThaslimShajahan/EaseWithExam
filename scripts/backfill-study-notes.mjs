/**
 * Backfills study_notes from knowledge_base rows that were written by the bulk
 * corpus loader.
 *
 *   node scripts/backfill-study-notes.mjs --dry-run
 *   ADMIN_UID=<firebase-uid> node scripts/backfill-study-notes.mjs
 *   ... --source=corpus: --unpublished --limit=5
 *
 * WHY THIS EXISTS
 *   scripts/bulk-load-corpus.mjs writes knowledge_base only. The admin Content
 *   Intake screen writes BOTH knowledge_base and one study_notes row per
 *   lesson (see saveNoteChunks in src/admin/AdminContentIntake.jsx) — the bulk
 *   loader can't, because admin_upsert_study_note checks p_caller against the
 *   admins table and the headless loader has no admin identity. So bulk-loaded
 *   chapters are invisible to Admin > Study Notes, Admin > Content Map, the
 *   student Study Hub (NotesBrowser) and getStudyChapters()'s chapter picker.
 *
 * NO RE-EXTRACTION, NO API COST
 *   Everything written here is already sitting in knowledge_base columns:
 *   chapter, subject, exam_type, unit, keywords, content and source_ref
 *   {page_start, page_end}. No PDF is opened, no OpenAI call is made, no
 *   embedding is computed. The only network traffic is PostgREST reads plus one
 *   admin_upsert_study_note RPC per new chapter.
 *
 * IT ONLY ADDS
 *   Every (exam_type, subject, chapter) that already has a study_notes row is
 *   skipped outright, and every write passes p_id: null, so no existing row is
 *   read, updated or deleted. Run it twice and the second run writes nothing.
 *
 * KNOWN LIMITATION — chunk order within a chapter
 *   knowledge_base has no chunk-index column, and created_at is Postgres now(),
 *   which is transaction time — every chunk a loader inserted for one chapter
 *   shares an identical timestamp (verified: 35 rows, 1 distinct value). So
 *   chunk order cannot be reconstructed from any column. This reads the rows
 *   with no ORDER BY, which returns physical row order — insertion order for a
 *   table that is only ever inserted into, as this one is. That is a
 *   best-effort, not a guarantee: if these rows are ever UPDATEd, physical
 *   order can drift from insertion order and a backfilled note would read
 *   out of sequence. Prefer re-running the load through an authenticated path
 *   over re-running this backfill on mutated rows.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const DRY_RUN     = process.argv.includes('--dry-run');
const PUBLISHED   = !process.argv.includes('--unpublished');
const SOURCE_PFX  = arg('source', 'corpus:');
const LIMIT       = Number(arg('limit', Infinity));
const PAGE        = 500;

/* ── Credentials ────────────────────────────────────────────────────── */

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env'); process.exit(1); }

// admin_upsert_study_note resolves p_caller against admins(uid, is_active) —
// the same check every other admin_* RPC makes. Not needed for a dry run.
const ADMIN_UID = process.env.ADMIN_UID || '';
if (!DRY_RUN && !ADMIN_UID) {
  console.error('ADMIN_UID is required to write. Re-run with --dry-run to preview without it.');
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path.slice(0, 60)} — ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const rpc = (fn, body) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });

/* ── Read existing study_notes (the rows we must not disturb) ───────── */

// Via the admin RPC, not a plain select: RLS exposes only published rows to
// anon, and an unpublished row we couldn't see would look like a gap and get a
// duplicate written over the top of it.
async function existingNotes() {
  if (DRY_RUN && !ADMIN_UID) {
    const rows = await rest('study_notes?select=id,title,subject,exam_type,chapter');
    console.log('  (dry run without ADMIN_UID — reading published study_notes only;');
    console.log('   unpublished rows are invisible here, so the real skip-set may be larger)');
    return rows;
  }
  const rows = await rpc('admin_list_study_notes', { p_caller: ADMIN_UID });
  if (!Array.isArray(rows)) throw new Error('admin_list_study_notes did not return a list — is ADMIN_UID an active admin?');
  return rows;
}

/* ── Read the knowledge_base rows to group ──────────────────────────── */

const COLS = 'id,subject,exam_type,chapter,class_level,unit,keywords,content,source_ref';

async function knowledgeRows() {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    // No order= on purpose. See "KNOWN LIMITATION" above: physical order is the
    // only proxy for chunk order this table retains, and adding an ORDER BY on
    // any column would replace it with an arbitrary but confident-looking one.
    // The embedding column is excluded — it is ~1500 floats per row.
    const batch = await rest(
      `knowledge_base?select=${COLS}&source_ref->>source=like.${encodeURIComponent(SOURCE_PFX)}*&offset=${offset}&limit=${PAGE}`,
    );
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/* ── Group into one study_note per chapter ──────────────────────────── */

const keyOf = (r) => [r.exam_type ?? '', r.subject ?? '', r.chapter ?? ''].map((s) => s.trim().toLowerCase()).join('|');

function group(rows) {
  const groups = new Map(); // key -> { …, rows: [] } in first-seen order
  for (const r of rows) {
    if (!r.chapter?.trim()) continue;
    const k = keyOf(r);
    if (!groups.has(k)) {
      groups.set(k, {
        key: k,
        exam_type: r.exam_type ?? null,
        subject:   r.subject ?? null,
        chapter:   r.chapter.trim(),
        unit:      r.unit ?? null,
        rows:      [],
      });
    }
    const g = groups.get(k);
    if (!g.unit && r.unit) g.unit = r.unit;
    g.rows.push(r);
  }
  return dropSelfReferentialUnits([...groups.values()]);
}

/**
 * Drops `unit` where it merely repeats the chapter title.
 *
 * runNotesExtraction asks for "Unit name if this content is part of a
 * numbered/named unit, else null". A bulk-loaded NCERT PDF *is* one chapter, so
 * the model has nothing else to name and answers with the chapter title rather
 * than null. `unit` exists only to GROUP notes into a table of contents, so a
 * unit whose only member is a chapter of the same name renders as an accordion
 * section of exactly one item, repeating its own title twice. 81 rows had to be
 * cleaned out of production this way once already
 * (20260810060000_clear_self_referential_note_units.sql) — this stops the next
 * corpus load from putting them back.
 *
 * The sibling check is NOT optional, and must stay in step with that migration:
 * NCERT genuinely names a unit after its own opening chapter ("Number Play",
 * "Locomotion and Movement", "Proportional Reasoning" are all real units with
 * real sibling chapters). Dropping those would orphan the intro chapter out of a
 * unit that legitimately exists.
 *
 * Scope note: this sees siblings present in knowledge_base (group() runs over
 * every kb row, before the already-has-a-note filter), but not a sibling that
 * exists only as a hand-authored study_notes row. That case would clear a unit
 * the migration would have kept — narrow, and it fails toward "ungrouped",
 * which is the recoverable direction.
 */
function dropSelfReferentialUnits(groups) {
  const norm = (s) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const g of groups) {
    if (!g.unit?.trim() || norm(g.unit) !== norm(g.chapter)) continue;
    const hasSibling = groups.some((o) => o !== g
      && norm(o.exam_type) === norm(g.exam_type)
      && norm(o.subject)   === norm(g.subject)
      && norm(o.unit)      === norm(g.unit));
    if (!hasSibling) g.unit = null;
  }
  return groups;
}

/**
 * Rebuilds the note body in exactly the shape Content Intake writes.
 *
 * buildKbRows stores `${heading}\n\n${content}` in knowledge_base.content;
 * saveNoteChunks joins chunks as `**${heading}**\n${content}`. Splitting on the
 * first blank line recovers the two halves, so a backfilled note is byte-shaped
 * like an intake-written one rather than merely similar.
 */
function noteContent(rows) {
  return rows.map((r) => {
    const text = r.content ?? '';
    const i = text.indexOf('\n\n');
    if (i === -1) return text.trim();
    const heading = text.slice(0, i).trim();
    const body    = text.slice(i + 2).trim();
    return heading ? `**${heading}**\n${body}` : body;
  }).filter(Boolean).join('\n\n');
}

const firstDefined = (rows, pick) => { for (const r of rows) { const v = pick(r); if (v != null) return v; } return null; };

/* ── Main ───────────────────────────────────────────────────────────── */

console.log(`\nsupabase   : ${URL}`);
console.log(`source     : source_ref->>source LIKE '${SOURCE_PFX}%'`);
console.log(`mode       : ${DRY_RUN ? 'DRY RUN — nothing written' : `WRITE (is_published=${PUBLISHED})`}`);

const before = await existingNotes();
const skip = new Set(before.map(keyOf));
console.log(`study_notes: ${before.length} existing rows -> ${skip.size} (exam_type, subject, chapter) keys protected`);

const kb = await knowledgeRows();
console.log(`knowledge_base: ${kb.length} rows matching source`);

const groups = group(kb);
const todo   = groups.filter((g) => !skip.has(g.key)).slice(0, LIMIT);
const already = groups.length - groups.filter((g) => !skip.has(g.key)).length;

console.log(`chapters   : ${groups.length} distinct  (${already} already have a note, ${groups.length - already} missing)`);
console.log(`to write   : ${todo.length}\n`);

// sort_order mirrors Content Intake's: position within its own exam_type+subject.
const seq = new Map();
for (const g of todo) {
  const bucket = `${g.exam_type}|${g.subject}`;
  const n = seq.get(bucket) ?? 0;
  g.sort_order = n;
  seq.set(bucket, n + 1);
}

const bySubject = {};
for (const g of todo) {
  const k = `${g.exam_type} ${g.subject}`;
  bySubject[k] = (bySubject[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(bySubject).sort()) console.log(`  ${k.padEnd(30)} ${v}`);
console.log();

if (DRY_RUN) {
  const s = todo[0];
  if (s) {
    const body = noteContent(s.rows);
    console.log('sample note that WOULD be written:');
    console.log(`  title      : ${s.chapter}`);
    console.log(`  subject    : ${s.subject}   exam_type: ${s.exam_type}   unit: ${s.unit ?? 'null'}`);
    console.log(`  chunks     : ${s.rows.length}   content: ${body.length} chars`);
    console.log(`  tags       : ${JSON.stringify([...new Set(s.rows.flatMap((r) => r.keywords ?? []))].slice(0, 10))}`);
    console.log(`  body head  : ${body.slice(0, 220).replace(/\n/g, ' ⏎ ')}…`);
  }
  console.log('\nDRY RUN — no study_notes row was created or modified.\n');
  process.exit(0);
}
if (!todo.length) { console.log('Nothing to write.\n'); process.exit(0); }

let ok = 0, failed = 0;
const failures = [];

for (let i = 0; i < todo.length; i++) {
  const g = todo[i];
  const label = `[${String(i + 1).padStart(3)}/${todo.length}]`;
  try {
    await rpc('admin_upsert_study_note', {
      p_caller:       ADMIN_UID,
      p_id:           null,              // always a create — never targets an existing row
      p_title:        g.chapter,
      p_subject:      g.subject,
      p_exam_type:    g.exam_type,
      p_chapter:      g.chapter,
      p_content:      noteContent(g.rows),
      p_pdf_url:      null,
      p_centre_id:    null,
      p_is_published: PUBLISHED,
      p_tags:         [...new Set(g.rows.flatMap((r) => r.keywords ?? []).filter(Boolean))].slice(0, 10),
      p_unit:         g.unit,
      p_page_start:   firstDefined(g.rows, (r) => r.source_ref?.page_start),
      p_page_end:     firstDefined(g.rows.slice().reverse(), (r) => r.source_ref?.page_end),
      p_sort_order:   g.sort_order,
      p_source_text:  null,              // verbatim lesson text was never stored in knowledge_base
    });
    ok++;
    console.log(`${label} OK   ${g.exam_type} / ${g.subject} / ${g.chapter}  (${g.rows.length} chunks)`);
  } catch (e) {
    failed++;
    failures.push({ chapter: `${g.exam_type} / ${g.subject} / ${g.chapter}`, error: String(e.message ?? e).slice(0, 160) });
    console.log(`${label} FAIL ${g.exam_type} / ${g.subject} / ${g.chapter}\n        ${String(e.message ?? e).slice(0, 160)}`);
  }
}

const after = await existingNotes();
console.log('\n─── report ───────────────────────────────────────────────');
console.log(`  chapters written : ${ok} ok, ${failed} failed`);
console.log(`  study_notes      : ${before.length} before -> ${after.length} after  (+${after.length - before.length})`);
if (failures.length) {
  console.log('\n  failures:');
  failures.forEach((f) => console.log(`    ${f.chapter}\n      ${f.error}`));
  console.log('\n  Re-run to retry only these — written chapters are skipped automatically.');
}
console.log();
