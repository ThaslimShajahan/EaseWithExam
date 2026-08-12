/**
 * Seeds syllabus_nodes for `Kerala State Class 10` from the OFFICIAL SCERT
 * textbook contents pages.
 *
 *   node scripts/seed-kerala-class10-syllabus.mjs --dry-run
 *   ADMIN_UID=<uid> node scripts/seed-kerala-class10-syllabus.mjs
 *   ADMIN_UID=<uid> node scripts/seed-kerala-class10-syllabus.mjs --undo
 *
 * ⚠ THIS LIST IS PARTIAL — PART 1 ONLY. READ THIS BEFORE USING IT.
 *
 * Source: SCERT Kerala Standard X textbooks, 2025 edition (Hsslive scans in
 * ewe_data/Kerala slybuss notes). Every chapter below was read from the book's
 * OWN table of contents — page 5 in all four — in reading order, not inferred
 * from body text and not guessed by a model.
 *
 * Only the PART 1 textbooks exist in that folder. The Part 2 volumes are absent
 * (the Hsslive file numbering has exactly the gaps: 16/17 Physics, 20/21
 * Chemistry, 24/25 Biology, 36/37 Maths). Maths Part 1 covers pages 7-127 of a
 * 152-page book — roughly half the year.
 *
 * CONSEQUENCE, AND WHY runPYQExtraction'S CLOSED LIST IS DISABLED FOR KERALA
 * chapterRule tells the model the list is CLOSED and that every chapter "MUST
 * be copied EXACTLY", falling back to "Other" only if a question "fits none of
 * them at all". Feed it a half-complete list and every Part 2 question gets
 * forced into the nearest Part 1 chapter — a confident, WRONG tag that looks
 * clean in the data. Today's unsnapped names are at least visibly wrong.
 *
 * So `Kerala State Class 10` is listed in PARTIAL_SYLLABUS_EXAM_TYPES
 * (src/lib/contentExtraction.js). These nodes still power post-hoc snapping via
 * matchSyllabusChapter() and the chapter pickers; they just do not constrain
 * the extraction prompt. Remove it from that set once Part 2 is added.
 *
 * WHY THIS IS WORTH SEEDING EVEN PARTIAL
 * The 472 existing Kerala orphans show the model applying CBSE vocabulary to a
 * Kerala paper: "Arithmetic Progressions" (CBSE) for "Arithmetic Sequences"
 * (Kerala), "Quadratic Equations" for "Second Degree Equations", "Probability"
 * for "Mathematics of Chance", "Coordinate Geometry" for "Coordinates". Having
 * the real vocabulary in place is what lets any of those ever be reconciled.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY  = process.argv.includes('--dry-run');
const UNDO = process.argv.includes('--undo');

const EXAM_TYPE  = 'Kerala State Class 10';
const CLASS_LEVEL = '10';

/* Verified against each textbook's own contents page (page 5), in reading
 * order. Order here IS the printed chapter order, which becomes sort_order. */
const SYLLABUS = {
  Mathematics: [           // Hsslive-35_Maths Eng.pdf, 152pp, "MATHEMATICS PART - 1"
    'Arithmetic Sequences',
    'Circles and Angles',
    'Arithmetic Sequences and Algebra',
    'Mathematics of Chance',
    'Second Degree Equations',
    'Trigonometry',
    'Coordinates',
  ],
  Physics: [               // Hsslive-15_Physics Eng.pdf, 88pp, "PHYSICS Part 1"
    'Sound Waves',
    'Lenses',
    'The World of Colours and Vision',
    'Magnetic Effect of Electric Current',
  ],
  Chemistry: [             // Hsslive-19_Chemistry Eng.pdf, 96pp
    'Nomenclature of Organic Compounds and Isomerism',
    'Chemical Reactions of Organic Compounds',
    'Periodic Table and Electron Configuration',
    'Gas Laws and Mole Concept',
  ],
  Biology: [               // Hsslive-23_Biology Eng.pdf, 104pp
    'Genetics of Life',
    'Paths of Evolution',
    'Behind Sensations',
  ],
};

/* k10_ rather than c10_: CBSE Class 10 already uses c10_*, and although the
 * unique constraint is (exam_type, subject, chapter_key) — so a collision is
 * impossible — a key that reads as CBSE inside a Kerala row is a trap for
 * whoever greps for it later. */
const keyFor = (name) =>
  'k10_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const BASE = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const scope = `exam_type=eq.${encodeURIComponent(EXAM_TYPE)}`;

async function existing() {
  const r = await fetch(`${BASE}/rest/v1/syllabus_nodes?select=chapter_key,chapter_name,subject,is_active&${scope}&limit=500`, { headers: H });
  const b = await r.json();
  if (!Array.isArray(b)) throw new Error(`read failed: ${JSON.stringify(b).slice(0, 200)}`);
  return b;
}

const rows = Object.entries(SYLLABUS).flatMap(([subject, chapters]) =>
  chapters.map((chapter_name, i) => ({
    exam_type: EXAM_TYPE,
    subject,
    chapter_key: keyFor(chapter_name),
    chapter_name,
    class_level: CLASS_LEVEL,
    sort_order: i + 1,
    is_active: true,
  })),
);

const before = await existing();
console.log(`\n${EXAM_TYPE}`);
console.log(`  nodes before : ${before.length}`);
console.log(`  to insert    : ${rows.length}  (Maths 7, Physics 4, Chemistry 4, Biology 3 — PART 1 ONLY)`);

if (UNDO) {
  if (DRY) { console.log('\nDRY RUN (--undo) — nothing written.\n'); process.exit(0); }
  const res = await fetch(`${BASE}/rest/v1/syllabus_nodes?${scope}&chapter_key=like.k10_*`, { method: 'DELETE', headers: { ...H, Prefer: 'return=representation' } });
  if (!res.ok) { console.error(`DELETE failed ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
  console.log(`  removed      : ${(await res.json()).length}`);
  console.log(`  nodes after  : ${(await existing()).length}\n`);
  process.exit(0);
}

// Insert-only, never overwrite: a curated node that already exists wins over
// anything this script would write. Same rule as seed-syllabus-from-corpus.
const seen = new Set(before.map((r) => `${r.subject}::${r.chapter_key}`));
const fresh = rows.filter((r) => !seen.has(`${r.subject}::${r.chapter_key}`));
console.log(`  already present: ${rows.length - fresh.length}`);
console.log(`  will insert    : ${fresh.length}`);
for (const r of fresh) console.log(`     ${r.subject.padEnd(12)} ${String(r.sort_order).padStart(2)}. ${r.chapter_name}`);

if (DRY) { console.log('\nDRY RUN — nothing written.\n'); process.exit(0); }
if (!fresh.length) { console.log('\nNothing to insert.\n'); process.exit(0); }

const res = await fetch(`${BASE}/rest/v1/syllabus_nodes`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(fresh),
});
if (!res.ok) { console.error(`\nINSERT failed ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const inserted = await res.json();

const after = await existing();
console.log(`\n  inserted     : ${inserted.length}`);
console.log(`  nodes after  : ${after.length}`);
const bySubject = {};
for (const r of after) bySubject[r.subject] = (bySubject[r.subject] ?? 0) + 1;
for (const [s, n] of Object.entries(bySubject).sort()) console.log(`     ${s.padEnd(12)} ${n}`);
console.log(`\n⚠ PARTIAL: Part 1 only. Kerala stays in PARTIAL_SYLLABUS_EXAM_TYPES\n  so the closed-list rule does NOT constrain extraction. See the header.\n`);
