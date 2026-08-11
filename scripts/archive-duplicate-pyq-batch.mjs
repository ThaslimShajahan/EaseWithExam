/**
 * Archives the EARLIER of two duplicate upload batches for the Class X maths
 * model papers, leaving today's clean re-upload live.
 *
 *   node scripts/archive-duplicate-pyq-batch.mjs --dry-run
 *   node scripts/archive-duplicate-pyq-batch.mjs
 *   node scripts/archive-duplicate-pyq-batch.mjs --restore     # undo
 *
 * WHY THESE ROWS
 *   Set-B and Set-C were each uploaded twice. The first run (2026-08-11
 *   ~18:07-18:12 UTC) happened while we believed the vision timeout fix was
 *   live; it was not, but those uploads succeeded anyway and saved their rows.
 *   Today's re-upload added a second copy of each:
 *
 *     Set-B   126 rows @ 18:12   +   117 rows @ 19:34   = 243
 *     Set-C    78 rows @ 18:07   +    73 rows @ 19:29   = 151
 *     Set-A     -                +    78 rows @ 19:37   =  78   (clean, untouched)
 *
 *   Set-A has one batch only because its earlier attempt died on the 0.5 marks
 *   value, and savePYQRows inserts every row in a single statement — so that
 *   run saved nothing at all. Good corroboration that the failure was truly
 *   all-or-nothing.
 *
 * WHY TEXT DEDUP CANNOT DO THIS
 *   Only 30 of Set-B's 243 rows and 18 of Set-C's 151 are exact text
 *   duplicates: the two vision runs transcribed the same questions with
 *   different wording, whitespace and LaTeX. They are near-duplicates, which is
 *   worse than exact ones — publishPYQPaper's dedup (lowercased,
 *   whitespace-collapsed question_text) would not catch them either. `source`
 *   plus `created_at` separates the two batches exactly, so that is what this
 *   uses.
 *
 * WHY ARCHIVE RATHER THAN DELETE
 *   Reversible, days before launch, and 'archived' is already an allowed value
 *   of pyq_questions.status (CHECK: in_review | published | archived). Every
 *   student-facing and blueprint path filters status = 'published' —
 *   PYQBankSection, chapter_pattern_stats, TemplatePickerPanel and the
 *   Blueprint V2 allocator in generateQuestionPaper — so archiving removes them
 *   from all four without destroying anything. --restore puts them back.
 *
 * NOTE ON HOW THIS WRITES
 *   Originally it PATCHed the table directly with the public anon key, which
 *   worked because pyq_questions carried an RLS policy `pyq_open` (cmd=ALL,
 *   roles=public, qual=true) — i.e. anyone holding the public key could rewrite
 *   or delete the entire question bank. That hole is closed by
 *   20260812020000_lock_pyq_questions_writes.sql, so this now goes through
 *   admin_update_pyq_status like every other writer, and needs ADMIN_UID set to
 *   a real admin's Firebase uid:
 *
 *     ADMIN_UID=<uid> node scripts/archive-duplicate-pyq-batch.mjs
 *
 *   Reads still use the anon key — pyq_select is deliberately still open.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY     = process.argv.includes('--dry-run');
const RESTORE = process.argv.includes('--restore');

// The cutoff sits in the ~75-minute gap between the two runs (18:12 -> 19:29),
// so it cannot clip either batch. Set-A is not listed at all and is untouched.
const CUTOFF  = '2026-08-11T19:00:00Z';
const SOURCES = [
  'drive:01_Std_X_ModelQn_Maths_Set-B_Eng.pdf',
  'drive:02_Std_X_ModelQn_Maths_Set- C_Eng.pdf',   // note: real source string has a space
];

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const BASE = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const inList = `in.(${SOURCES.map((s) => `"${s}"`).join(',')})`;
const scope  = `source=${encodeURIComponent(inList)}`;
const batchFilter = RESTORE
  ? `&created_at=lt.${CUTOFF}&status=eq.archived`
  : `&created_at=lt.${CUTOFF}&status=eq.published`;

async function snapshot() {
  const r = await fetch(
    `${BASE}/rest/v1/pyq_questions?select=source,status,created_at&${scope}&limit=2000`,
    { headers: H },
  );
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error(`read failed: ${JSON.stringify(rows).slice(0, 300)}`);

  const tally = {};
  for (const row of rows) {
    const batch = row.created_at < CUTOFF ? 'earlier' : 'today';
    const k = `${row.source}|${batch}|${row.status}`;
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return { total: rows.length, tally };
}

function show(label, snap) {
  console.log(`\n${label}  (${snap.total} rows across both files)`);
  for (const src of SOURCES) {
    const short = src.replace('drive:', '').replace('_Eng.pdf', '');
    for (const batch of ['earlier', 'today']) {
      const parts = Object.entries(snap.tally)
        .filter(([k]) => k.startsWith(`${src}|${batch}|`))
        .map(([k, n]) => `${k.split('|')[2]}=${n}`);
      if (parts.length) console.log(`  ${short.padEnd(30)} ${batch.padEnd(8)} ${parts.join(' ')}`);
    }
  }
}

const before = await snapshot();
show('BEFORE', before);

const targetStatus = RESTORE ? 'published' : 'archived';
console.log(`\nAction: set status='${targetStatus}' on rows from BEFORE ${CUTOFF}`);
console.log('        (today\'s rows and Set-A are never matched by the filter)');

if (DRY) {
  console.log('\nDRY RUN — nothing written.\n');
  process.exit(0);
}

const ADMIN_UID = process.env.ADMIN_UID;
if (!ADMIN_UID) {
  console.error('\nADMIN_UID is required — direct table writes are closed (20260812020000).');
  console.error('Usage: ADMIN_UID=<firebase-uid> node scripts/archive-duplicate-pyq-batch.mjs\n');
  process.exit(1);
}

// Select the exact ids first (reads are still open), then hand them to the RPC.
const idRes = await fetch(
  `${BASE}/rest/v1/pyq_questions?select=id&${scope}${batchFilter}&limit=2000`,
  { headers: H },
);
const idRows = await idRes.json();
if (!Array.isArray(idRows)) {
  console.error(`\nid lookup failed: ${JSON.stringify(idRows).slice(0, 300)}`);
  process.exit(1);
}
console.log(`\nmatched ${idRows.length} row(s) to re-status`);

const res = await fetch(`${BASE}/rest/v1/rpc/admin_update_pyq_status`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    p_caller: ADMIN_UID,
    p_ids:    idRows.map((r) => r.id),
    p_status: targetStatus,
  }),
});
if (!res.ok) {
  console.error(`\nRPC FAILED ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
console.log(`patched: ${await res.json()} rows`);

const after = await snapshot();
show('AFTER', after);

/* The assertion that matters: today's rows must be untouched and still
 * published, and the earlier batch must be fully archived. Reporting the counts
 * is not the same as checking them. */
const published = Object.entries(after.tally)
  .filter(([k]) => k.endsWith('|published'))
  .reduce((n, [, v]) => n + v, 0);
const todayPublished = Object.entries(after.tally)
  .filter(([k]) => k.includes('|today|') && k.endsWith('|published'))
  .reduce((n, [, v]) => n + v, 0);
const earlierPublished = Object.entries(after.tally)
  .filter(([k]) => k.includes('|earlier|') && k.endsWith('|published'))
  .reduce((n, [, v]) => n + v, 0);

const expectPublished = RESTORE ? published : todayPublished;
const ok = RESTORE ? earlierPublished > 0 : earlierPublished === 0;

console.log(`\n  today's rows still published : ${todayPublished}`);
console.log(`  earlier rows still published : ${earlierPublished}  (expected ${RESTORE ? '>0' : '0'})`);
console.log(ok ? '\nOK — batch separation held.\n' : '\nFAILED — earlier batch not in the expected state.\n');
process.exit(ok ? 0 : 1);
