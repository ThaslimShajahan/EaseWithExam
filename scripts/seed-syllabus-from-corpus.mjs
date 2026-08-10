/**
 * Seeds syllabus_nodes from chapter names already present in knowledge_base.
 *
 *   node scripts/seed-syllabus-from-corpus.mjs --dry-run
 *   node scripts/seed-syllabus-from-corpus.mjs
 *   ... --exam="CBSE Class 10" --subject=Science
 *   ... --preset=neet                     # NEET Physics/Chemistry/Biology
 *   ... --exam=NEET --subject=Physics --from-exam="CBSE Class 11"
 *
 * SEEDING ONE EXAM FROM ANOTHER'S CORPUS (--from-exam)
 *   NEET's syllabus IS Class 11 + 12 Physics/Chemistry/Biology, and the corpus
 *   is loaded under exam_type 'CBSE Class 11'. Reading and writing under the
 *   same exam_type would find zero chapters for NEET, so --from-exam splits the
 *   two: read chapter names from the Class 11 corpus, write syllabus_nodes rows
 *   tagged NEET.
 *
 *   This matters beyond convenience. Content Intake snaps every extracted PYQ
 *   chapter onto a syllabus_nodes name, so seeding NEET from the Class 11
 *   corpus makes NEET PYQ chapter strings land on the SAME vocabulary the
 *   knowledge_base chunks already use — which is what lets a NEET query reach
 *   Class 11 content later, whatever mapping strategy is chosen. Seeding NEET
 *   from some other chapter list would silently break that join.
 *
 *   class_level and the chapter_key prefix come from the SOURCE exam, so these
 *   land as c11_* and a future Class 12 pass adds c12_* without colliding.
 *
 * WHY THIS MATTERS BEFORE UPLOADING PYQs
 *   Content Intake runs every extracted question's AI-guessed chapter through
 *   matchSyllabusChapter(), which snaps it onto a syllabus_nodes name when one
 *   exists and otherwise keeps the raw guess. Blueprint V2 then groups by the
 *   EXACT chapter string:
 *
 *     chapterCounts[chapter] = (chapterCounts[chapter] ?? 0) + 1
 *     alloc[ch] = Math.floor((cnt / pyqTotal) * count)
 *
 *   With no syllabus to snap to, one paper's 38 questions scatter across "Real
 *   Numbers", "Number Systems" and "Real numbers and Euclid's lemma" — the
 *   20-question threshold is crossed and the allocation is still junk, because
 *   every variant looks like its own low-frequency chapter. The failure is
 *   silent; nothing reports it.
 *
 *   knowledge_base already holds clean chapter titles the extraction pass read
 *   off the actual NCERT books, so the controlled vocabulary is sitting there.
 *
 * SAFETY
 *   Insert-only, and deduped against existing chapter_keys for the exam_type —
 *   the same client-side dedupe AdminSyllabus does, because syllabus_nodes has
 *   no unique constraint to upsert against. Existing rows are never touched.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const DRY = process.argv.includes('--dry-run');

// NEET is Physics + Chemistry + Biology only. Class 11 Mathematics is
// deliberately NOT here: it is JEE's subject, and since every query filters on
// subject as well as exam_type, keeping the corpus split by subject is what
// lets one Class 11 corpus serve NEET and JEE without either seeing the other's
// papers.
const PRESETS = {
  neet: ['Physics', 'Chemistry', 'Biology'].map((subject) => ({
    examType: 'NEET', subject, fromExam: 'CBSE Class 11',
  })),
};

// Tier 1 from the Step 4 plan: exam_type matches the loaded corpus exactly.
const TARGETS = PRESETS[(arg('preset') ?? '').toLowerCase()]
  ?? (arg('exam') && arg('subject')
    ? [{ examType: arg('exam'), subject: arg('subject'), fromExam: arg('from-exam', arg('exam')) }]
    : [
        { examType: 'CBSE Class 10', subject: 'Mathematics' },
        { examType: 'CBSE Class 10', subject: 'Science' },
      ]);

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const get = async (p) => { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: H }); const b = await r.json(); if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 200)); return b; };

// Mirrors AdminSyllabus's slugify so keys collide correctly with rows it wrote.
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const classLevelFrom = (examType) => examType.match(/Class\s+(\d+)/i)?.[1] ?? null;

/** Chapters the corpus actually produced, in first-seen (book) order. */
async function corpusChapters(examType, subject) {
  const rows = [];
  for (let o = 0; ; o += 1000) {
    const b = await get(`knowledge_base?select=chapter,page_no,source_ref&exam_type=eq.${encodeURIComponent(examType)}&subject=eq.${encodeURIComponent(subject)}&offset=${o}&limit=1000`);
    rows.push(...b);
    if (b.length < 1000) break;
  }
  // Order by source file then first page, so the syllabus comes out in roughly
  // textbook order rather than whatever the DB happened to return.
  const first = new Map();
  for (const r of rows) {
    const name = (r.chapter ?? '').trim();
    if (!name) continue;
    const src = (r.source_ref?.source ?? '').replace('corpus:', '');
    const seen = first.get(name);
    const rank = `${src}::${String(r.page_no ?? 0).padStart(4, '0')}`;
    if (!seen || rank < seen.rank) first.set(name, { name, rank, count: (seen?.count ?? 0) + 1 });
    else seen.count++;
  }
  return [...first.values()].sort((a, b) => a.rank.localeCompare(b.rank));
}

let totalNew = 0;
for (const { examType, subject, fromExam } of TARGETS) {
  const srcExam = fromExam ?? examType;
  // Source exam, not target: NEET carries no class number of its own, but the
  // chapters do — so these key as c11_* and leave room for c12_*.
  const classLevel = classLevelFrom(srcExam);
  const chapters = await corpusChapters(srcExam, subject);
  // Scoped to exam_type AND subject. Scoping to exam_type alone silently DROPS
  // a chapter whose name exists in a sibling subject: NEET Physics and NEET
  // Chemistry both have "Thermodynamics", both slugify to c11_thermodynamics,
  // and Chemistry's row was skipped as "already present" on the first run.
  // Class 10 never exposed this because Mathematics and Science share no
  // chapter names. getChapters() filters on exam_type + subject, so a key
  // repeated across subjects is correct, not a conflict.
  const existing = await get(`syllabus_nodes?select=chapter_key,chapter_name&exam_type=eq.${encodeURIComponent(examType)}&subject=eq.${encodeURIComponent(subject)}`);
  const have = new Set(existing.map((r) => r.chapter_key));

  const rows = chapters.map((c, i) => ({
    exam_type:    examType,
    subject,
    chapter_key:  (classLevel ? `c${classLevel}_` : '') + slugify(c.name),
    chapter_name: c.name,
    class_level:  classLevel,
    sort_order:   i + 1,
    is_active:    true,
    subtopics:    [],
  })).filter((r) => !have.has(r.chapter_key));

  console.log(`\n${examType} / ${subject}${srcExam !== examType ? `   (chapters read from ${srcExam})` : ''}`);
  console.log(`  corpus chapters : ${chapters.length}`);
  console.log(`  already present : ${chapters.length - rows.length}`);
  console.log(`  to insert       : ${rows.length}`);
  rows.forEach((r) => console.log(`     ${String(r.sort_order).padStart(2)}. ${r.chapter_name}`));

  if (DRY || !rows.length) continue;
  const res = await fetch(`${URL}/rest/v1/syllabus_nodes`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(rows),
  });
  if (!res.ok) { console.error(`  INSERT FAILED ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
  const made = await res.json();
  totalNew += made.length;
  console.log(`  inserted        : ${made.length}`);
}

console.log(DRY ? '\nDRY RUN — nothing written.\n' : `\ninserted ${totalNew} syllabus_nodes rows.\n`);
