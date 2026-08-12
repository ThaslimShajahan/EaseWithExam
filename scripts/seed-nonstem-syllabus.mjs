/**
 * Seeds syllabus_nodes for the 25 non-STEM, non-Hindi books that carry chapters.
 *
 *   node scripts/seed-nonstem-syllabus.mjs --dry-run
 *   node scripts/seed-nonstem-syllabus.mjs --dry-run --book Hornbill
 *   node scripts/seed-nonstem-syllabus.mjs
 *   node scripts/seed-nonstem-syllabus.mjs --undo
 *
 * PROVENANCE — every chapter name below was read from the book's OWN contents
 * page (Stage B, `scripts/read-book-contents.mjs`) and reconciled against the
 * number of chapter PDFs present. Nothing here is web-sourced, and nothing is
 * derived from a filename: this corpus has `KRITHIKA 2/` holding Kshitij,
 * `GEOGRAPHY/` holding kegy2* codes for a book NCERT codes kegy1, and a
 * `full unit.pdf` that is an audio-transcript appendix.
 *
 * Third-party lists disagree across the 2023 rationalisation, which is what
 * produced the 10 stale Class 8 Maths rows — names that looked right, snapped
 * cleanly, and pointed at chapters with no corpus behind them.
 *
 * INSERT-ONLY. A node that already exists wins over anything this writes, same
 * rule as seed-kerala-class10-syllabus and seed-syllabus-from-corpus. `--undo`
 * removes only what this script inserted, matched on chapter_key prefix.
 *
 * NOT INCLUDED, DELIBERATELY:
 *   Hindi (87 files)          text layer is legacy-encoded, deferred
 *   Words and Expressions II  attaches to First Flight, gets no rows of its own
 *   STEM                      already seeded and correct
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY  = process.argv.includes('--dry-run');
const UNDO = process.argv.includes('--undo');
const ONLY = (() => {
  const i = process.argv.indexOf('--book');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].toLowerCase() : null;
})();

/* ── Sort-order banding ──────────────────────────────────────────────────
 *
 * A reader restarts numbering per printed SECTION, so sections are banded
 * rather than given a column — reusing the convention the NEET rows already use
 * (1-14 class 11, 100-113 class 12, 900+ legacy).
 *
 * Hornbill:      Reading Skills 1-99, Writing Skills 100-199
 * Woven Words:   Short Stories 1-99, Poetry 100-199, Essays 200-299
 * First Flight:  prose 1-99, poems 100-199 (poems are interleaved in print,
 *                but they are a distinct kind and banding keeps the numbered
 *                chapters contiguous for the student)
 */
const BAND = (section, i) => section * 100 + i + 1;

/* ── The books ───────────────────────────────────────────────────────────
 *
 * `unit` groups chapters for display; it is written to nothing here (syllabus_nodes
 * has no unit column) but is recorded so Stage E can pass it to the loader,
 * which writes knowledge_base.unit.
 */
const BOOKS = [
  /* ───────────────────────── CBSE Class 11 ───────────────────────── */
  {
    examType: 'CBSE Class 11', subject: 'English', book: 'Hornbill', prefix: 'c11_hornbill',
    sections: [
      { unit: 'Reading Skills', chapters: [
        'The Portrait of a Lady',
        'We’re Not Afraid to Die... if We Can All Be Together',
        'Discovering Tut: the Saga Continues',
        'The Ailing Planet: the Green Movement’s Role',
        'The Adventure',
        'Silk Road',
        // Interleaved poems, unnumbered in print, no files of their own.
        'A Photograph', 'The Laburnum Top', 'The Voice of the Rain', 'Childhood', 'Father to Son',
      ] },
      { unit: 'Writing Skills', chapters: [
        'Note-making', 'Summarising', 'Sub-titling', 'Essay-writing', 'Letter-writing', 'Creative Writing',
      ] },
    ],
  },
  {
    examType: 'CBSE Class 11', subject: 'English', book: 'Woven Words', prefix: 'c11_wovenwords',
    sections: [
      { unit: 'Short Stories', chapters: [
        'The Lament', 'A Pair of Mustachios', 'The Rocking-horse Winner',
        'The Adventure of the Three Garridebs', 'Pappachi’s Moth',
        'The Third and Final Continent', 'Glory at Twilight', 'The Luncheon',
      ] },
      { unit: 'Poetry', chapters: [
        'The Peacock', 'Let me Not to the Marriage of True Minds', 'Coming',
        'Telephone Conversation', 'The World is too Much With Us', 'Mother Tongue',
        'Hawk Roosting', 'For Elkana', 'Refugee Blues', 'Felling of the Banyan Tree',
        'Ode to a Nightingale', 'Ajamil and the Tigers',
      ] },
      { unit: 'Essays', chapters: [
        'My Watch', 'My Three Passions', 'Patterns of Creativity', 'Tribal Verse',
        'What is a Good Book?', 'The Story', 'Bridges',
      ] },
    ],
  },
  {
    examType: 'CBSE Class 11', subject: 'Political Science', book: 'Political Theory', prefix: 'c11_poltheory',
    sections: [{ unit: null, chapters: [
      'Political Theory: An Introduction', 'Freedom', 'Equality', 'Social Justice',
      'Rights', 'Citizenship', 'Nationalism', 'Secularism',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Political Science', book: 'Constitution at Work', prefix: 'c11_constitution',
    sections: [{ unit: null, chapters: [
      'Constitution: Why and How?', 'Rights in the Indian Constitution',
      'Election and Representation', 'Executive', 'Legislature', 'Judiciary',
      'Federalism', 'Local Governments', 'Constitution as a Living Document',
      'The Philosophy of the Constitution',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Sociology', book: 'Introducing Sociology', prefix: 'c11_introsoc',
    sections: [{ unit: null, chapters: [
      'Sociology and Society', 'Terms, Concepts and their use in Sociology',
      'Understanding Social Institutions', 'Culture and Socialisation',
      'Doing Sociology: Research Methods',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Sociology', book: 'Understanding Society', prefix: 'c11_undsoc',
    sections: [{ unit: null, chapters: [
      'Social Structure, Stratification and Social Processes in Society',
      'Social Change and Social Order in Rural and Urban Society',
      'Environment and Society', 'Introducing Western Sociologists', 'Indian Sociologists',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Psychology', book: null, prefix: 'c11_psy',
    sections: [{ unit: null, chapters: [
      'What is Psychology?', 'Methods of Enquiry in Psychology', 'Human Development',
      'Sensory, Attentional and Perceptual Processes', 'Learning', 'Human Memory',
      'Thinking', 'Motivation and Emotion',
    ] }],
  },
  {
    /* Labelled although its sibling book (India: Physical Environment) is absent
     * — see the rule in ACTION_ITEMS: labelling now costs nothing, not labelling
     * costs a chapter_key rewrite on keys flashcards and the tracker point at. */
    examType: 'CBSE Class 11', subject: 'Geography', book: 'Fundamentals of Physical Geography', prefix: 'c11_physgeo',
    sections: [{ unit: null, chapters: [
      'Geography as a Discipline', 'The Origin and Evolution of the Earth',
      'Interior of the Earth', 'Distribution of Oceans and Continents',
      'Geomorphic Processes', 'Landforms and their Evolution',
      'Composition and Structure of Atmosphere',
      'Solar Radiation, Heat Balance and Temperature',
      'Atmospheric Circulation and Weather Systems', 'Water in the Atmosphere',
      'World Climate and Climate Change', 'Water (Oceans)',
      'Movements of Ocean Water', 'Biodiversity and Conservation',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Economics', book: 'Indian Economic Development', prefix: 'c11_indecodev',
    sections: [{ unit: null, chapters: [
      'Indian Economy on the Eve of Independence', 'Indian Economy 1950-1990',
      'Liberalisation, Privatisation and Globalisation: An Appraisal',
      'Human Capital Formation in India', 'Rural Development',
      'Employment: Growth, Informalisation and Other Issues',
      'Environment and Sustainable Development',
      'Comparative Development Experiences of India and its Neighbours',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Economics', book: 'Statistics for Economics', prefix: 'c11_statecon',
    sections: [{ unit: null, chapters: [
      'Introduction', 'Collection of Data', 'Organisation of Data',
      'Presentation of Data', 'Measures of Central Tendency', 'Correlation',
      'Index Numbers', 'Use of Statistical Tools',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'History', book: null, prefix: 'c11_hist',
    sections: [{ unit: null, chapters: [
      'Writing and City Life', 'An Empire Across Three Continents', 'Nomadic Empires',
      'The Three Orders', 'Changing Cultural Traditions', 'Displacing Indigenous Peoples',
      'Paths to Modernisation',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Business Studies', book: null, prefix: 'c11_bst',
    sections: [{ unit: null, chapters: [
      'Business, Trade and Commerce', 'Forms of Business Organisation',
      'Private, Public and Global Enterprises', 'Business Services',
      'Emerging Modes of Business', 'Social Responsibilities of Business and Business Ethics',
      'Formation of a Company', 'Sources of Business Finance',
      'MSME and Business Entrepreneurship', 'Internal Trade', 'International Business',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Computer Science', book: null, prefix: 'c11_cs',
    sections: [{ unit: null, chapters: [
      'Computer System', 'Encoding Schemes and Number System', 'Emerging Trends',
      'Introduction to Problem Solving', 'Getting Started with Python', 'Flow of Control',
      'Functions', 'Strings', 'Lists', 'Tuples and Dictionaries', 'Societal Impact',
    ] }],
  },
  {
    examType: 'CBSE Class 11', subject: 'Informatics Practices', book: null, prefix: 'c11_ip',
    sections: [{ unit: null, chapters: [
      'Computer System', 'Emerging Trends', 'Brief Overview of Python',
      'Working with Lists and Dictionaries', 'Understanding Data',
      'Introduction to NumPy', 'Database Concepts',
      'Introduction to Structured Query Language (SQL)',
    ] }],
  },
  {
    /* One book in two volumes: Part I is chapters 1-7 ending page 268, Part II
     * is 8-9 starting page 277. Continuous on both counts, so book stays null. */
    examType: 'CBSE Class 11', subject: 'Accountancy', book: null, prefix: 'c11_acc',
    sections: [{ unit: null, chapters: [
      'Introduction to Accounting', 'Theory Base of Accounting',
      'Recording of Transactions-I', 'Recording of Transactions-II',
      'Bank Reconciliation Statement', 'Trial Balance and Rectification of Errors',
      'Depreciation, Provisions and Reserves', 'Financial Statements-I',
      'Financial Statements-II',
    ] }],
  },

  /* ───────────────────────── CBSE Class 10 ───────────────────────── */
  {
    examType: 'CBSE Class 10', subject: 'English', book: 'First Flight', prefix: 'c10_firstflight',
    sections: [
      { unit: 'Prose', chapters: [
        'A Letter to God', 'Nelson Mandela: Long Walk to Freedom',
        // Chapter 3 and chapter 5 are each one printed chapter holding several
        // texts, split per the per-text ruling.
        'His First Flight', 'Black Aeroplane',
        'From the Diary of Anne Frank',
        'A Baker from Goa', 'Coorg', 'Tea from Assam',
        'Mijbil the Otter', 'Madam Rides the Bus', 'The Sermon at Benares', 'The Proposal',
      ] },
      { unit: 'Poems', chapters: [
        'Dust of Snow', 'Fire and Ice', 'A Tiger in the Zoo', 'How to Tell Wild Animals',
        'The Ball Poem', 'Amanda!', 'The Trees', 'Fog',
        'The Tale of Custard the Dragon', 'For Anne Gregory',
      ] },
    ],
  },
  {
    examType: 'CBSE Class 10', subject: 'English', book: 'Footprints Without Feet', prefix: 'c10_footprints',
    sections: [{ unit: null, chapters: [
      'A Triumph of Surgery', 'The Thief’s Story', 'The Midnight Visitor',
      'A Question of Trust', 'Footprints without Feet', 'The Making of a Scientist',
      'The Necklace', 'Bholi', 'The Book That Saved the Earth',
    ] }],
  },
  {
    examType: 'CBSE Class 10', subject: 'Social Science', book: 'Contemporary India II', prefix: 'c10_geo',
    sections: [{ unit: null, chapters: [
      'Resources and Development', 'Forest and Wildlife Resources', 'Water Resources',
      'Agriculture', 'Minerals and Energy Resources', 'Manufacturing Industries',
      'Lifelines of National Economy',
    ] }],
  },
  {
    examType: 'CBSE Class 10', subject: 'Social Science', book: 'Understanding Economic Development', prefix: 'c10_eco',
    sections: [{ unit: null, chapters: [
      'Development', 'Sectors of the Indian Economy', 'Money and Credit',
      'Globalisation and the Indian Economy', 'Consumer Rights',
    ] }],
  },
  {
    /* FIVE chapters, not eight. The book prints five and states that three more
     * are QR-code only, held over from the previous edition and absent from both
     * the book and the corpus: The Nationalist Movement in Indo-China, Work Life
     * and Leisure, Novels Society and History. Every third-party list still shows
     * all eight — seeding them would recreate the stale-Class-8-Maths failure. */
    examType: 'CBSE Class 10', subject: 'Social Science', book: 'India and the Contemporary World II', prefix: 'c10_hist',
    sections: [{ unit: null, chapters: [
      'The Rise of Nationalism in Europe', 'Nationalism in India',
      'The Making of a Global World', 'The Age of Industrialisation',
      'Print Culture and the Modern World',
    ] }],
  },
  {
    examType: 'CBSE Class 10', subject: 'Social Science', book: 'Democratic Politics II', prefix: 'c10_pol',
    sections: [{ unit: null, chapters: [
      'Power-sharing', 'Federalism', 'Gender, Religion and Caste',
      'Political Parties', 'Outcomes of Democracy',
    ] }],
  },

  /* ────────────────────── CBSE Class 9 and 8 (NEP 2020) ────────────────────── */
  {
    /* UNIT level only. Kaveri prints no contents page anywhere; these 8 names
     * come from NCERT's own audio-transcript appendix. Each unit holds 2-3
     * texts that a heading scan could not establish reliably, so
     * 'CBSE Class 9::English' is in PARTIAL_SYLLABUS and Stage F reconciles the
     * per-text rows from what the loader actually found. */
    examType: 'CBSE Class 9', subject: 'English', book: 'Kaveri', prefix: 'c9_kaveri',
    sections: [{ unit: null, chapters: [
      'How I Taught My Grandmother to Read', 'The Pot Maker', 'Winds of Change',
      'Vitamin-M', 'The World of Limitless Possibilities', 'Twin Melodies',
      'Carrier of Words', 'Follow That Dream',
    ] }],
  },
  {
    examType: 'CBSE Class 9', subject: 'Social Science', book: 'Understanding Society: India and Beyond', prefix: 'c9_social',
    sections: [{ unit: null, chapters: [
      'Understanding Social Science', 'Shaping of the Earth’s Surface',
      'Atmosphere and Climate', 'Early Humans and Beginning of Civilisation',
      'State and Society up to 1000 CE', 'Democracy', 'Elections',
      'Building Blocks in Economics: The Problem of Choice',
      'The Price Puzzle: What Drives the Market',
    ] }],
  },
  {
    examType: 'CBSE Class 8', subject: 'English', book: 'Poorvi', prefix: 'c8_poorvi',
    sections: [
      { unit: 'Wit and Wisdom', chapters: ['The Wit that Won Hearts', 'A Concrete Example', 'Wisdom Paves the Way'] },
      { unit: 'Values and Dispositions', chapters: ['A Tale of Valour: Major Somnath Sharma and the Battle of Badgam', 'Somebody’s Mother', 'Verghese Kurien— I Too Had A Dream'] },
      { unit: 'Mystery and Magic', chapters: ['The Case of the Fifth Word', 'The Magic Brush of Dreams', 'Spectacular Wonders'] },
      { unit: 'Environment', chapters: ['The Cherry Tree', 'Harvest Hymn', 'Waiting for the Rain'] },
      { unit: 'Science and Curiosity', chapters: ['Feathered Friend', 'Magnifying Glass', 'Bibha Chowdhuri: The Beam of Light that Lit the Path for Women in Indian Science'] },
    ],
  },
  {
    /* Themes are a UNIT, not a book: chapter numbering runs 1-7 continuously
     * across them. Theme C is absent because this is Part 1 — the index jumps
     * B to D — which is why CBSE Class 8::Social Science is in PARTIAL_SYLLABUS. */
    examType: 'CBSE Class 8', subject: 'Social Science', book: 'Exploring Society: India and Beyond', prefix: 'c8_social',
    sections: [{ unit: null, chapters: [
      'Natural Resources and Their Use', 'Reshaping India’s Political Map',
      'The Rise of the Marathas', 'The Colonial Era in India',
      'Universal Franchise and India’s Electoral System',
      'The Parliamentary System: Legislature and Executive', 'Factors of Production',
    ] }],
  },
];

/* ── Row construction ────────────────────────────────────────────────── */

const slug = (s) => String(s).toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');

const classLevelOf = (examType) => examType.match(/Class\s+(\d+)/i)?.[1] ?? null;

function rowsFor(b) {
  return b.sections.flatMap((sec, si) =>
    sec.chapters.map((chapter_name, i) => ({
      exam_type:    b.examType,
      subject:      b.subject,
      book:         b.book,
      chapter_key:  `${b.prefix}_${slug(chapter_name)}`,
      chapter_name,
      class_level:  classLevelOf(b.examType),
      sort_order:   BAND(si, i),
      is_active:    true,
      _unit:        sec.unit,   // stripped before insert; for the dry-run report
    })),
  );
}

const selected = BOOKS.filter((b) => !ONLY
  || (b.book ?? b.subject).toLowerCase().includes(ONLY)
  || b.prefix.includes(ONLY));

const allRows = selected.flatMap(rowsFor);

/* ── Guards that run BEFORE anything is written ──────────────────────── */

const problems = [];

// A duplicate key inside one (exam_type, subject) is the exact collision the
// book dimension exists to stop, so catch it here rather than at the DB.
const byScope = new Map();
for (const r of allRows) {
  const scope = `${r.exam_type}::${r.subject}`;
  if (!byScope.has(scope)) byScope.set(scope, new Map());
  const seen = byScope.get(scope);
  if (seen.has(r.chapter_key)) {
    problems.push(`DUPLICATE KEY  ${scope}  ${r.chapter_key}  ("${seen.get(r.chapter_key)}" vs "${r.chapter_name}")`);
  }
  seen.set(r.chapter_key, r.chapter_name);
}

for (const r of allRows) {
  if (!r.chapter_key || r.chapter_key.endsWith('_')) problems.push(`BAD KEY  ${r.chapter_name}`);
  if (!r.chapter_name?.trim()) problems.push(`EMPTY NAME in ${r.exam_type} ${r.subject}`);
}

/* ── Env / HTTP ──────────────────────────────────────────────────────── */

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const BASE = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const PREFIXES = [...new Set(BOOKS.map((b) => b.prefix))];

async function existingForScopes() {
  const scopes = [...new Set(allRows.map((r) => `${r.exam_type}::${r.subject}`))];
  const out = [];
  for (const s of scopes) {
    const [exam, subject] = s.split('::');
    const q = `exam_type=eq.${encodeURIComponent(exam)}&subject=eq.${encodeURIComponent(subject)}`;
    const r = await fetch(`${BASE}/rest/v1/syllabus_nodes?select=chapter_key,chapter_name,subject,exam_type,book,is_active&${q}&limit=1000`, { headers: H });
    const b = await r.json();
    if (!Array.isArray(b)) throw new Error(`read failed for ${s}: ${JSON.stringify(b).slice(0, 200)}`);
    out.push(...b);
  }
  return out;
}

/* ── Report ──────────────────────────────────────────────────────────── */

console.log(`\nnon-STEM syllabus seed${ONLY ? `  (filtered: "${ONLY}")` : ''}`);
console.log(`  books  : ${selected.length}`);
console.log(`  rows   : ${allRows.length}\n`);

for (const b of selected) {
  const rs = rowsFor(b);
  const label = b.book ? `${b.subject} / ${b.book}` : b.subject;
  console.log(`  ${b.examType.padEnd(14)} ${label.padEnd(52)} ${String(rs.length).padStart(3)} rows`);
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s) — nothing will be written:\n`);
  problems.forEach((p) => console.error(`   ${p}`));
  process.exit(1);
}
console.log('\n  ✓ no duplicate chapter_key within any (exam_type, subject)');

const before = await existingForScopes();
const seen = new Set(before.map((r) => `${r.exam_type}::${r.subject}::${r.chapter_key}`));
const fresh = allRows.filter((r) => !seen.has(`${r.exam_type}::${r.subject}::${r.chapter_key}`));

console.log(`  existing rows in these scopes : ${before.length}`);
console.log(`  already present               : ${allRows.length - fresh.length}`);
console.log(`  WILL INSERT                   : ${fresh.length}\n`);

if (UNDO) {
  if (DRY) { console.log('DRY RUN (--undo) — nothing written.\n'); process.exit(0); }
  let removed = 0;
  for (const p of PREFIXES) {
    const res = await fetch(`${BASE}/rest/v1/syllabus_nodes?chapter_key=like.${encodeURIComponent(p + '_%')}`,
      { method: 'DELETE', headers: { ...H, Prefer: 'return=representation' } });
    if (!res.ok) { console.error(`DELETE ${p} failed ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
    removed += (await res.json()).length;
  }
  console.log(`  removed : ${removed}\n`);
  process.exit(0);
}

if (DRY) {
  let cur = null;
  for (const r of fresh) {
    const label = `${r.exam_type} | ${r.subject}${r.book ? ` | ${r.book}` : ''}`;
    if (label !== cur) { cur = label; console.log(`\n  ── ${label}`); }
    console.log(`     ${String(r.sort_order).padStart(4)}  ${r.chapter_key.padEnd(56)} ${r._unit ? `[${r._unit}] ` : ''}${r.chapter_name}`);
  }
  console.log(`\nDRY RUN — nothing written. ${fresh.length} rows would be inserted.\n`);
  process.exit(0);
}

if (!fresh.length) { console.log('Nothing to insert.\n'); process.exit(0); }

const payload = fresh.map(({ _unit, ...r }) => r);
const res = await fetch(`${BASE}/rest/v1/syllabus_nodes`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(payload),
});
if (!res.ok) { console.error(`\nINSERT failed ${res.status}: ${(await res.text()).slice(0, 400)}`); process.exit(1); }
console.log(`  inserted : ${(await res.json()).length}`);

const after = await existingForScopes();
console.log(`  rows after : ${after.length}\n`);
