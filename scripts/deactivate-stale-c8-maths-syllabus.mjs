/**
 * Deactivates the 10 CBSE Class 8 Mathematics syllabus_nodes rows that belong to
 * the OLD NCERT chapter list, and reactivates them again on demand.
 *
 *   node scripts/deactivate-stale-c8-maths-syllabus.mjs --dry-run
 *   node scripts/deactivate-stale-c8-maths-syllabus.mjs
 *   node scripts/deactivate-stale-c8-maths-syllabus.mjs --reactivate    # undo
 *
 * WHY THESE TEN ROWS
 *   The 427 Class 8 Mathematics chunks in knowledge_base are the NEW NCERT book
 *   (Ganita Prakash Part 1 + Part 2). These ten rows name chapters from the book
 *   it replaced, and no chunk carries any of these names — they are snapping
 *   targets with nothing behind them.
 *
 *   That is not cosmetic. Content Intake runs every extracted chapter name
 *   through matchSyllabusChapter(), which snaps onto a syllabus_nodes name when
 *   one exists. Several of these are near-synonyms of real chapters —
 *   "Squares and Square Roots" vs "Understanding Perfect Squares", "Playing with
 *   Numbers" vs "Number Play", "Understanding Quadrilaterals" vs
 *   "Quadrilaterals" — so a Class 8 Maths PYQ can snap onto one of them and be
 *   filed under a chapter with no retrievable content. Nothing reports it.
 *
 * WHY DEACTIVATE RATHER THAN DELETE
 *   Reversible, and close enough to launch that permanently destroying rows buys
 *   nothing a flag does not. getChapters() filters on is_active, so a deactivated
 *   row stops being a snapping target while the row itself survives. Pass
 *   --reactivate to put them back exactly as they were.
 *
 * NOT INCLUDED — c8_cubes_and_cube_roots
 *   It looks like an eleventh old-book row, but knowledge_base really does carry
 *   3 chunks under that name, from the duplicate ingestion of Chapter 1. Turning
 *   it off would orphan them, so it stays active. See ACTION_ITEMS_FOR_YOU.md.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const ACTIVE = process.argv.includes('--reactivate');

const EXAM = 'CBSE Class 8';
const SUBJECT = 'Mathematics';

// The old NCERT Class 8 Mathematics chapter list, minus cubes_and_cube_roots.
const STALE = [
  'c8_rational_numbers',
  'c8_linear_equations_in_one_variable',
  'c8_understanding_quadrilaterals',
  'c8_practical_geometry',
  'c8_data_handling',
  'c8_squares_and_square_roots',
  'c8_algebraic_expressions_and_identities',
  'c8_mensuration',
  'c8_introduction_to_graphs',
  'c8_playing_with_numbers',
];

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const scope = `exam_type=eq.${encodeURIComponent(EXAM)}&subject=eq.${encodeURIComponent(SUBJECT)}`;

const fetchRows = async () => {
  const r = await fetch(`${URL}/rest/v1/syllabus_nodes?select=chapter_key,chapter_name,is_active&${scope}&order=sort_order`, { headers: H });
  const b = await r.json();
  if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 300));
  return b;
};

const before = await fetchRows();
const targets = before.filter((r) => STALE.includes(r.chapter_key));
const missing = STALE.filter((k) => !before.some((r) => r.chapter_key === k));

console.log(`${EXAM} / ${SUBJECT}`);
console.log(`  rows total        : ${before.length}`);
console.log(`  active before     : ${before.filter((r) => r.is_active).length}`);
console.log(`  targets matched   : ${targets.length} of ${STALE.length}`);
if (missing.length) console.error(`  MISSING KEYS      : ${missing.join(', ')}`);
targets.forEach((r) => console.log(`     ${r.is_active ? 'ON ' : 'off'} → ${ACTIVE ? 'ON ' : 'off'}  ${r.chapter_name}`));

if (!DRY && targets.length) {
  const keys = STALE.map((k) => `"${k}"`).join(',');
  const res = await fetch(`${URL}/rest/v1/syllabus_nodes?${scope}&chapter_key=in.(${encodeURIComponent(keys)})`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ is_active: ACTIVE }),
  });
  if (!res.ok) { console.error(`  PATCH FAILED ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  console.log(`  patched           : ${(await res.json()).length}`);
}

const after = await fetchRows();
const act = after.filter((r) => r.is_active);
console.log(`\n  rows total        : ${after.length}`);
console.log(`  ACTIVE after      : ${act.length}`);
act.forEach((r, i) => console.log(`     ${String(i + 1).padStart(2)}. ${r.chapter_name}`));
console.log(DRY ? '\nDRY RUN — nothing written.\n' : '');
