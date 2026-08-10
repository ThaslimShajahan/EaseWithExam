/**
 * Seeds the NEET chapters that CANNOT come from the corpus.
 *
 *   node scripts/seed-neet-static-chapters.mjs --dry-run
 *   node scripts/seed-neet-static-chapters.mjs
 *
 * WHY A SECOND SEEDER
 *   seed-syllabus-from-corpus.mjs reads chapter names out of knowledge_base, so
 *   the syllabus and the corpus share one vocabulary and chapter snapping can
 *   actually reach the chunks. That only works where a corpus exists. It does
 *   not for either group here:
 *
 *   1. CLASS 12 — the corpus has zero Class 12 chunks, but NEET is Class 11+12
 *      and roughly half of every NEET paper is Class 12. Without these, half of
 *      each paper snaps to nothing, keeps its raw AI-guessed chapter string, and
 *      scatters chapter attribution across spelling variants — the exact failure
 *      the Class 10 seeding was built to prevent.
 *
 *   2. PRE-RATIONALISATION CHAPTERS — the loaded corpus is the post-2023
 *      rationalised NCERT, but the papers being uploaded are 2018 and 2022.
 *      Both predate rationalisation and ask about chapters the current books no
 *      longer contain.
 *
 *   These names are therefore NOT corpus-derived. They are the NCERT chapter
 *   titles, reviewed by the project owner before this was run.
 *
 * SNAPPING ONLY — THERE IS NO CONTENT BEHIND THESE
 *   A syllabus row makes a chapter NAME available to matchSyllabusChapter(). It
 *   does not create knowledge_base chunks. Retrieval and generation for these
 *   chapters will still find nothing until Class 12 content is actually loaded.
 *   The win is clean, consistent chapter ATTRIBUTION on the PYQs.
 *
 * WHY LEGACY ROWS ARE is_active = true
 *   Because getChapters() filters on is_active, and Content Intake snaps against
 *   exactly that list — an inactive row is invisible to snapping, which would
 *   defeat the entire purpose. The cost is that students see these in the
 *   chapter picker with no content behind them, so every non-current chapter
 *   gets a high sort_order and lands at the BOTTOM of every picker.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

/* ── sort_order bands, so ordering is intentional rather than incidental ──
 * Class 11 core occupies 1..~20 already (written by the corpus seeder).      */
const BAND = { class12: 100, legacy11: 900, legacy12: 950 };

/* ── Current (post-2023 rationalised) NCERT Class 12 ─────────────────────── */
const CLASS_12 = {
  Physics: [
    'Electric Charges and Fields',
    'Electrostatic Potential and Capacitance',
    'Current Electricity',
    'Moving Charges and Magnetism',
    'Magnetism and Matter',
    'Electromagnetic Induction',
    'Alternating Current',
    'Electromagnetic Waves',
    'Ray Optics and Optical Instruments',
    'Wave Optics',
    'Dual Nature of Radiation and Matter',
    'Atoms',
    'Nuclei',
    'Semiconductor Electronics: Materials, Devices and Simple Circuits',
  ],
  Chemistry: [
    'Solutions',
    'Electrochemistry',
    'Chemical Kinetics',
    'The d- and f-Block Elements',
    'Coordination Compounds',
    'Haloalkanes and Haloarenes',
    'Alcohols, Phenols and Ethers',
    'Aldehydes, Ketones and Carboxylic Acids',
    'Amines',
    'Biomolecules',
  ],
  Biology: [
    'Sexual Reproduction in Flowering Plants',
    'Human Reproduction',
    'Reproductive Health',
    'Principles of Inheritance and Variation',
    'Molecular Basis of Inheritance',
    'Evolution',
    'Human Health and Disease',
    'Microbes in Human Welfare',
    'Biotechnology: Principles and Processes',
    'Biotechnology and its Applications',
    'Organisms and Populations',
    'Ecosystem',
    'Biodiversity and Conservation',
  ],
};

/* ── Dropped by the 2023-24 rationalisation, still asked in 2018 / 2022 ──── */
const LEGACY_12 = {
  Physics:   ['Communication Systems'],
  Chemistry: [
    'The Solid State',
    'Surface Chemistry',
    'General Principles and Processes of Isolation of Elements',
    'The p-Block Elements',
    'Polymers',
    'Chemistry in Everyday Life',
  ],
  Biology: [
    'Reproduction in Organisms',
    'Strategies for Enhancement in Food Production',
    'Environmental Issues',
  ],
};

const LEGACY_11 = {
  Physics:   ['Physical World'],
  Chemistry: [
    'States of Matter',
    'Hydrogen',
    'The s-Block Elements',
    'The p-Block Elements',
    'Environmental Chemistry',
  ],
  Biology: [
    'Transport in Plants',
    'Mineral Nutrition',
    'Digestion and Absorption',
  ],
};

/* ── Credentials ─────────────────────────────────────────────────────────── */
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const get = async (p) => {
  const r = await fetch(`${URL}/rest/v1/${p}`, { headers: H });
  const b = await r.json();
  if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 200));
  return b;
};

// Mirrors AdminSyllabus's slugify so keys collide correctly with rows it wrote.
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const EXAM = 'NEET';
const GROUPS = [
  { label: 'Class 12 (current)', map: CLASS_12,  classLevel: '12', band: BAND.class12 },
  { label: 'Class 11 (legacy)',  map: LEGACY_11, classLevel: '11', band: BAND.legacy11 },
  { label: 'Class 12 (legacy)',  map: LEGACY_12, classLevel: '12', band: BAND.legacy12 },
];

let totalNew = 0, totalSkipped = 0;

for (const subject of ['Physics', 'Chemistry', 'Biology']) {
  // Scoped to exam_type AND subject: chapter names legitimately repeat across
  // subjects (NEET Physics and Chemistry both have "Thermodynamics"), and
  // getChapters() reads on exam_type + subject too.
  const existing = await get(
    `syllabus_nodes?select=chapter_key&exam_type=eq.${encodeURIComponent(EXAM)}&subject=eq.${encodeURIComponent(subject)}`,
  );
  const have = new Set(existing.map((r) => r.chapter_key));

  const rows = [];
  for (const { map, classLevel, band } of GROUPS) {
    (map[subject] ?? []).forEach((name, i) => {
      const chapter_key = `c${classLevel}_${slugify(name)}`;
      if (have.has(chapter_key)) { totalSkipped++; return; }
      have.add(chapter_key);            // guard against duplicates within this run
      rows.push({
        exam_type: EXAM, subject, chapter_key, chapter_name: name,
        class_level: classLevel, sort_order: band + i, is_active: true, subtopics: [],
      });
    });
  }

  console.log(`\n${EXAM} / ${subject}  (${existing.length} already present)`);
  for (const { label, map, classLevel } of GROUPS) {
    const want = (map[subject] ?? []).length;
    const made = rows.filter((r) => r.class_level === classLevel
      && (map[subject] ?? []).includes(r.chapter_name)).length;
    console.log(`  ${label.padEnd(20)} ${String(made).padStart(2)}/${want} to insert`);
  }
  rows.forEach((r) => console.log(`     ${String(r.sort_order).padStart(4)}  ${r.chapter_key.padEnd(52)} ${r.chapter_name}`));

  if (DRY || !rows.length) continue;
  const res = await fetch(`${URL}/rest/v1/syllabus_nodes`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(rows),
  });
  if (!res.ok) { console.error(`  INSERT FAILED ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
  totalNew += (await res.json()).length;
}

console.log(DRY
  ? `\nDRY RUN — nothing written. (${totalSkipped} already present)\n`
  : `\ninserted ${totalNew} syllabus_nodes rows. (${totalSkipped} already present)\n`);
