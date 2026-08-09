/**
 * Re-classifies knowledge_base chunks that landed in the 'prose' catch-all.
 *
 *   node scripts/reclassify-content-types.mjs --dry-run
 *   node scripts/reclassify-content-types.mjs
 *   ... --limit=50 --batch=10 --all
 *
 * WHY
 *   The corpus load put 79.8% of chunks in 'prose'. Most of that is genuinely
 *   narrative, but two things inflated it: the taxonomy had no bucket for
 *   exercises, activities or summaries (added in migration 20260810040000), and
 *   the classifier under-applied the types it did have — "Ionization Enthalpy
 *   is the energy required to..." is a definition, not prose.
 *
 *   By default this only visits rows a heading/body scan flags as probably
 *   mis-bucketed (~500 of 3,488) rather than the whole prose bucket, which is
 *   where the cost is. --all overrides that.
 *
 * NO RE-EXTRACTION
 *   Chunk text is already stored, so nothing here opens a PDF or re-runs
 *   extraction. It reads content, asks gpt-4o-mini to pick a type, and writes
 *   content_type back. Only rows currently typed 'prose' are ever touched, so
 *   a bad call can only move a row out of the catch-all — never overwrite a
 *   confidently-assigned type.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const DRY   = process.argv.includes('--dry-run');
const ALL   = process.argv.includes('--all');
const LIMIT = Number(arg('limit', Infinity));
const BATCH = Math.max(1, Math.min(20, Number(arg('batch', 10))));
// gpt-4o-mini shares the org's 30,000 TPM budget. Pacing here is deliberate:
// the corpus load failed twice by firing calls as fast as they returned.
const GAP_MS = Number(arg('gap', 3000));

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const AI = `${URL}/functions/v1/ai-proxy`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = ['theorem','law','formula','definition','solved_example','derivation','diagram','exercise','activity','summary','prose'];

const TAXONOMY = `
"theorem"        a named, provable statement
"law"            a stated physical/chemical law or principle
"formula"        a formula/equation presented for use
"definition"     a term being defined
"solved_example" a worked problem WITH its solution shown
"derivation"     a step-by-step derivation of a result
"diagram"        content whose substance is a figure and its explanation
"exercise"       UNSOLVED questions set for the student — numbered question
                 lists, "Exercises", end-of-chapter problems with no solution
"activity"       a practical procedure to carry out — "Activity 6.3", an
                 experiment, an observation task
"summary"        an end-of-chapter recap of points already covered
"prose"          narrative/expository text that fits none of the above`;

/* ── Which rows are worth spending a call on ────────────────────────── */

const head = (r) => (r.content ?? '').split('\n\n')[0].trim();
function looksMisBucketed(r) {
  const h = head(r), b = r.content ?? '';
  return /^(exercise|exercises|problems?|questions?|practice|assessment|multiple choice)/i.test(h)
    || /^activity\b|^experiment\b|^investigation\b|^lab\b|^demonstration\b/i.test(h)
    || /^(summary|key points|recap|what we learned|points to remember)/i.test(h)
    || /^(example|problem|solved|illustration)\s*\d|^worked example/i.test(h)
    || /^table\s*\d|^fig(ure)?\s*\d/i.test(h)
    || /\bis defined as\b|\bis called\b|\bis known as\b|\bis the (energy|measure|process|ratio|amount) (required|of)\b/i.test(b.slice(0, 400));
}

/* ── Data ───────────────────────────────────────────────────────────── */

async function fetchProse() {
  const out = [];
  for (let o = 0; ; o += 1000) {
    const r = await fetch(`${URL}/rest/v1/knowledge_base?select=id,exam_type,subject,chapter,content,content_type&content_type=eq.prose&offset=${o}&limit=1000`, { headers: H });
    const b = await r.json();
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

async function distribution() {
  const rows = [];
  for (let o = 0; ; o += 1000) {
    const r = await fetch(`${URL}/rest/v1/knowledge_base?select=content_type&offset=${o}&limit=1000`, { headers: H });
    const b = await r.json();
    rows.push(...b);
    if (b.length < 1000) break;
  }
  const m = {};
  rows.forEach((r) => { m[r.content_type ?? '(null)'] = (m[r.content_type ?? '(null)'] ?? 0) + 1; });
  return { total: rows.length, dist: Object.entries(m).sort((a, b) => b[1] - a[1]) };
}

const show = (label, { total, dist }) => {
  console.log(`\n${label} (${total} rows)`);
  dist.forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`));
};

/* ── Classify ───────────────────────────────────────────────────────── */

async function classify(batch) {
  const body = {
    model: 'gpt-4o-mini',
    max_tokens: 900,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You label textbook content chunks by type. Return only valid JSON.' },
      { role: 'user', content: `Classify each chunk below into EXACTLY ONE content_type.
${TAXONOMY}

Every chunk here was previously labelled "prose". Many genuinely are prose —
keep that label when it is right. Only choose another type when the chunk
clearly IS that thing. The most common real corrections are exercise,
activity, summary and definition.

Return: { "results": [ { "i": <chunk number>, "content_type": "<type>", "confidence": 0.0-1.0 } ] }

CHUNKS:
${batch.map((r, i) => `--- chunk ${i + 1} (${r.subject}, "${r.chapter}") ---\n${(r.content ?? '').slice(0, 1200)}`).join('\n\n')}` },
    ],
  };
  const res = await fetch(AI, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ai-proxy ${res.status}: ${text.slice(0, 160)}`);
  const parsed = JSON.parse(JSON.parse(text).choices[0].message.content);
  return parsed.results ?? [];
}

/* ── Main ───────────────────────────────────────────────────────────── */

const before = await distribution();
show('BEFORE', before);

const prose = await fetchProse();
const candidates = (ALL ? prose : prose.filter(looksMisBucketed)).slice(0, LIMIT);
console.log(`\nprose rows      : ${prose.length}`);
console.log(`candidates      : ${candidates.length}${ALL ? '  (--all: whole prose bucket)' : '  (heading/body scan)'}`);
console.log(`batches         : ${Math.ceil(candidates.length / BATCH)} of ${BATCH}, ${GAP_MS}ms apart`);

if (DRY) { console.log('\nDRY RUN — nothing classified, nothing written.\n'); process.exit(0); }
if (!candidates.length) { console.log('\nNothing to do.\n'); process.exit(0); }

let changed = 0, kept = 0, failed = 0;
const moves = {};

for (let i = 0; i < candidates.length; i += BATCH) {
  const batch = candidates.slice(i, i + BATCH);
  const label = `[${String(i + batch.length).padStart(4)}/${candidates.length}]`;
  try {
    const results = await classify(batch);
    for (const r of results) {
      const row = batch[Number(r.i) - 1];
      const type = String(r.content_type ?? '').toLowerCase().trim();
      if (!row || !TYPES.includes(type)) continue;
      if (type === 'prose') { kept++; continue; }
      const conf = Number.isFinite(Number(r.confidence)) ? Math.min(1, Math.max(0, Number(r.confidence))) : null;
      const res = await fetch(`${URL}/rest/v1/knowledge_base?id=eq.${row.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify(conf == null ? { content_type: type } : { content_type: type, confidence: conf }),
      });
      if (!res.ok) { failed++; continue; }
      changed++;
      moves[type] = (moves[type] ?? 0) + 1;
    }
    console.log(`${label} ok — ${changed} reclassified, ${kept} kept as prose`);
  } catch (e) {
    failed += batch.length;
    console.log(`${label} FAIL — ${String(e.message ?? e).slice(0, 140)}`);
  }
  if (i + BATCH < candidates.length) await sleep(GAP_MS);
}

console.log('\n─── moves ────────────────────────────────');
Object.entries(moves).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  prose -> ${k}`));
console.log(`\n  reclassified : ${changed}`);
console.log(`  kept as prose: ${kept}`);
console.log(`  failed       : ${failed}`);

show('AFTER', await distribution());
console.log();
