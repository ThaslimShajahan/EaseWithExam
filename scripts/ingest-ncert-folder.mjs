/**
 * One-time bulk ingestion: walks the local "easy with exam" folder (NCERT
 * chapter PDFs for Class 8/9/10/11, organized as {Class}/{Subject}/{file}.pdf)
 * and loads them into `knowledge_base` with proper subject/board/class/chapter
 * tags, so they're usable by the existing AI notes-generation and
 * question-generation pipelines (both read knowledge_base via subject + the
 * snake_case exam tag — see EXAM_TAG_RE / examTypeToTag in src/lib/categories.js).
 *
 * Class/subject are derived deterministically from the folder path (no AI
 * needed, no misclassification risk). Chapter names come straight from the
 * filename for Class 8/9 (already descriptive); Class 10/11 use official
 * NCERT short-codes (e.g. "jesc101.pdf"), so a cheap gpt-4o-mini call reads
 * the extracted chapter text and returns the real chapter title.
 *
 * Usage:
 *   node scripts/ingest-ncert-folder.mjs --dry-run           # classify only, no AI/DB calls, prints a table
 *   node scripts/ingest-ncert-folder.mjs --dry-run --limit=10
 *   node scripts/ingest-ncert-folder.mjs --limit=5            # live run, first 5 files only (smoke test)
 *   node scripts/ingest-ncert-folder.mjs                      # full live run, resumable
 *   node scripts/ingest-ncert-folder.mjs --reset              # clear checkpoint, restart from scratch
 *
 * The VITE_OPENAI_API_KEY in .env is a deliberately-revoked key (see its own
 * comment — the real key lives only in Supabase Edge Function secrets now).
 * So this script calls the same `ai-proxy` edge function the app itself uses
 * in production (src/lib/aiProxy.js) instead of the OpenAI SDK directly —
 * needs only the already-valid Supabase URL + anon key, nothing new.
 *
 * Requires: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY in .env
 */

import { readdirSync, statSync, readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';

/* ── env ──────────────────────────────────────────────────────────── */
function loadEnv(p = '.env') {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();
loadEnv('.env.local');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[ingest] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase  = createClient(SUPABASE_URL, SUPABASE_KEY);
const PROXY_URL = `${SUPABASE_URL}/functions/v1/ai-proxy`;

async function proxyChat(params) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`ai-proxy chat ${res.status}`);
  return res.json();
}

// OpenAI's embeddings endpoint accepts an array of inputs and returns one
// embedding per input in a single response — sending a whole file's chunks
// in one call instead of one call per chunk cuts network round-trips by
// ~30-40x, which was the dominant cost (not the embedding computation itself).
async function proxyEmbedBatch(texts) {
  const res = await fetch(`${PROXY_URL}?route=embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) return texts.map(() => null);
  const json = await res.json();
  // OpenAI returns `data` sorted by `index` matching input order, but sort
  // defensively rather than assume — order matters since we zip back by position.
  const sorted = (json?.data ?? []).sort((a, b) => a.index - b.index);
  if (sorted.length !== texts.length) return texts.map(() => null);
  return sorted.map((d) => d.embedding ?? null);
}

/* ── args ─────────────────────────────────────────────────────────── */
const DRY_RUN = process.argv.includes('--dry-run');
const RESET   = process.argv.includes('--reset');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const ROOT = path.resolve('easy with exam');
const CHECKPOINT_FILE = 'scripts/.ncert-ingest-checkpoint.json';

if (RESET && existsSync(CHECKPOINT_FILE)) {
  unlinkSync(CHECKPOINT_FILE);
  console.log('[ingest] Checkpoint cleared.');
}

/* ── pdf.js (Node legacy build, no browser worker) ───────────────────── */
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc =
  pathToFileURL(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

async function extractPdfText(filePath, pageCap = 25) {
  const data = new Uint8Array(readFileSync(filePath));
  const pdf  = await pdfjsLib.getDocument({ data }).promise;
  const pages = Math.min(pdf.numPages, pageCap);
  let text = '';
  for (let i = 1; i <= pages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((s) => s.str).join(' ') + '\n\n';
  }
  return text.trim();
}

/* ── path → class/subject classification (deterministic, no AI) ─────── */
const CLASS_FOLDER_MAP = { 'ncrt 8': 8, '9 ncrt': 9, '10 ncrt': 10, '11 ncrt sc': 11 };

function classifySubject(relLower, classLevel) {
  if (relLower.includes('english'))            return 'English';
  if (relLower.includes('hindi'))               return 'Hindi';
  if (relLower.includes('math'))                return 'Mathematics';
  if (relLower.includes('biotechnology'))       return 'Biotechnology';
  if (relLower.includes('accountancy'))         return 'Accountancy';
  if (relLower.includes('business studies'))    return 'Business Studies';
  if (relLower.includes('computer science'))    return 'Computer Science';
  if (relLower.includes('informatic'))          return 'Informatics Practices';
  if (relLower.includes('psychology'))          return 'Psychology';
  if (relLower.includes('sociology'))           return 'Sociology';
  if (relLower.includes('political'))           return classLevel <= 10 ? 'Social Studies' : 'Political Science';
  if (relLower.includes('geography'))           return classLevel <= 10 ? 'Social Studies' : 'Geography';
  if (relLower.includes('history'))             return classLevel <= 10 ? 'Social Studies' : 'History';
  if (relLower.includes('economics') || relLower.includes('statitics')) return classLevel <= 10 ? 'Social Studies' : 'Economics';
  if (relLower.includes('social'))              return 'Social Studies';
  if (relLower.includes('physics'))             return 'Physics';
  if (relLower.includes('chemistry'))           return 'Chemistry';
  if (relLower.includes('biology'))             return 'Biology';
  if (relLower.includes('science'))             return 'Science';
  return 'Other';
}

// NCERT short-code filenames: 4 letters + 1 series digit + (2 digits = real
// chapter N) or (2 letters/alnum = front-matter: answers/prelims/appendix).
const NCERT_CODE_RE = /^([a-z]{4})(\d)([a-z0-9]{2})$/i;

function parseFilename(basename) {
  const stem = basename.replace(/\.pdf$/i, '');

  // Class 9 style: "3 Tissues in Action" -> chapter 3, title as-is
  const numTitle = stem.match(/^(\d+)\s+(.+)$/);
  if (numTitle && !NCERT_CODE_RE.test(stem)) {
    return { descriptive: true, chapterNum: numTitle[1], title: numTitle[2].trim() };
  }

  // Class 8 style: "CHAPTER 10  LIGHTS MIRRORS AND LENS" (allow no title, e.g. "CHAPTER 1")
  const chapWord = stem.match(/^CHAPTER\s+(\d+)\s*(.*)$/i);
  if (chapWord) {
    const title = chapWord[2].trim();
    return {
      descriptive: !!title,
      chapterNum: chapWord[1],
      title: title
        ? title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
        : null,
    };
  }

  // NCERT short-code: needs AI to resolve the real title from content
  const code = stem.match(NCERT_CODE_RE);
  if (code) {
    const suffix = code[3];
    const isChapter = /^\d{2}$/.test(suffix);
    return {
      descriptive: false,
      needsAI: isChapter,
      chapterNum: isChapter ? String(parseInt(suffix, 10)) : null,
      specialType: isChapter ? null
        : suffix.toLowerCase() === 'an' ? 'Answers'
        : suffix.toLowerCase() === 'ps' ? 'Prelims'
        : /^a\d$/i.test(suffix)         ? 'Appendix'
        : 'Other',
    };
  }

  // Fallback: anything else not matched above (e.g. odd names) — still ingest,
  // untitled chapter, no AI call (avoid unbounded AI spend on unknown patterns).
  return { descriptive: true, chapterNum: null, title: stem };
}

async function aiChapterTitle(text, subject, classLevel) {
  try {
    const res = await proxyChat({
      model: 'gpt-4o-mini',
      max_tokens: 30,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Extract the chapter title from this NCERT textbook excerpt. Respond with ONLY the chapter title, no chapter number, no quotes, no extra words.' },
        { role: 'user', content: `Class ${classLevel} ${subject} textbook, first page text:\n\n${text.slice(0, 600)}` },
      ],
    });
    return res.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '') || null;
  } catch (e) {
    console.warn(`  [warn] AI chapter title failed: ${e.message}`);
    return null;
  }
}

/* ── chunk + embed (mirrors src/lib/pdfAnalyzer.js chunkText + backfill script) ── */
function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 800) {
    const c = text.slice(i, i + 800).trim();
    if (c.length > 50) chunks.push(c);
  }
  return chunks;
}

async function embedBatchWithRetry(texts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const embs = await proxyEmbedBatch(texts).catch(() => texts.map(() => null));
    if (embs.some((e) => e)) return embs;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return texts.map(() => null);
}

/* ── checkpoint ───────────────────────────────────────────────────── */
function loadCheckpoint() {
  try { return existsSync(CHECKPOINT_FILE) ? JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8')).done ?? [] : []; }
  catch { return []; }
}
function saveCheckpoint(doneSet) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify({ done: [...doneSet], updatedAt: new Date().toISOString() }));
}

/* ── walk folder ──────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.pdf$/i.test(entry)) out.push(full);
  }
  return out;
}

/* ── main ─────────────────────────────────────────────────────────── */
async function main() {
  if (!existsSync(ROOT)) {
    console.error(`[ingest] Folder not found: ${ROOT}`);
    process.exit(1);
  }

  const allFiles = walk(ROOT).sort();
  console.log(`[ingest] Found ${allFiles.length} PDFs under "${ROOT}"`);

  const done = new Set(loadCheckpoint());
  let processed = 0, inserted = 0, skipped = 0, failed = 0, garbled = 0, totalChunks = 0;

  for (const filePath of allFiles) {
    if (processed >= LIMIT) break;
    const rel = path.relative(ROOT, filePath);
    const relLower = rel.toLowerCase();

    if (!DRY_RUN && done.has(rel)) { continue; } // already ingested, skip silently

    const topFolder = rel.split(path.sep)[0].toLowerCase();
    const classLevel = CLASS_FOLDER_MAP[topFolder];
    if (!classLevel) { console.warn(`[skip] Unrecognized top folder: ${topFolder} (${rel})`); skipped++; continue; }

    const subject = classifySubject(relLower, classLevel);
    const basename = path.basename(filePath);
    const parsed = parseFilename(basename);

    if (parsed.specialType) {
      // Answers/Prelims/Appendix — not real chapter content, skip ingesting as KB.
      if (DRY_RUN) console.log(`[SKIP special] ${rel}  ->  ${parsed.specialType}`);
      skipped++;
      continue;
    }

    processed++;
    let chapterTitle = parsed.title;

    try {
      const text = await extractPdfText(filePath);
      if (!text || text.length < 100) {
        console.warn(`[skip] No extractable text: ${rel}`);
        skipped++;
        continue;
      }

      // Some Hindi PDFs (e.g. the "Kritika"/"Kshitij" class 10 readers) use a
      // legacy non-Unicode font (Kruti Dev-style) — pdf.js extracts the raw glyph
      // codes as if they were Latin text, producing garbage instead of Devanagari.
      // Other Hindi PDFs (class 9) use proper Unicode fonts and extract cleanly —
      // this is a per-file problem, not a blanket Hindi issue, so check each file.
      if (subject === 'Hindi') {
        const devanagari = (text.match(/[ऀ-ॿ]/g) || []).length;
        if (devanagari < text.length * 0.05) {
          console.warn(`[garbled] Non-Unicode font, skipping: ${rel}`);
          garbled++;
          continue;
        }
      }

      if (parsed.needsAI && !DRY_RUN) {
        chapterTitle = await aiChapterTitle(text, subject, classLevel) || `Chapter ${parsed.chapterNum ?? '?'}`;
      } else if (parsed.needsAI && DRY_RUN) {
        chapterTitle = `<AI will resolve — Chapter ${parsed.chapterNum ?? '?'}>`;
      }

      const examType = `CBSE Class ${classLevel}`;
      const examTag  = `cbse_class_${classLevel}`;

      if (DRY_RUN) {
        console.log(`[${processed}] Class ${classLevel} | ${subject.padEnd(22)} | ${chapterTitle ?? '(untitled)'}  <- ${rel}`);
        continue;
      }

      const chunks = chunkText(text);
      const rows = [];
      // One array-input embeddings call per batch instead of one call per chunk —
      // a typical chapter's ~35 chunks now costs 1 round-trip instead of ~35.
      const EMBED_BATCH = 90; // comfortably under OpenAI's per-request input array limit
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const embeddings = await embedBatchWithRetry(batch);
        batch.forEach((content, j) => {
          rows.push({
            subject,
            content,
            tags: [chapterTitle, subject, examTag].filter(Boolean),
            embedding: embeddings[j] ?? null,
          });
        });
      }

      // A handful of long chapters (90+ rows x 1536-dim embedding vectors each)
      // hit "canceling statement due to statement timeout" — likely pgvector
      // index maintenance cost per row, not just payload size, since it still
      // happened at 25-row batches. Smaller batches + retry-with-backoff for
      // transient load rather than failing the whole file on one slow moment.
      const INSERT_BATCH = 10;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const slice = rows.slice(i, i + INSERT_BATCH);
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { error } = await supabase.from('knowledge_base').insert(slice);
          if (!error) { lastErr = null; break; }
          lastErr = error;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
        if (lastErr) throw new Error(lastErr.message);
      }

      totalChunks += rows.length;
      inserted++;
      done.add(rel);
      saveCheckpoint(done);
      console.log(`[${processed}/${Math.min(allFiles.length, LIMIT)}] OK  Class ${classLevel} ${subject} — "${chapterTitle}" (${rows.length} chunks)  ${rel}`);
    } catch (e) {
      failed++;
      console.error(`[FAIL] ${rel}: ${e.message}`);
    }
  }

  console.log(`\n[ingest] ─── Report ──────────────────────────`);
  console.log(`[ingest] Files processed : ${processed}`);
  console.log(`[ingest] Inserted        : ${inserted}`);
  console.log(`[ingest] Chunks written  : ${totalChunks}`);
  console.log(`[ingest] Skipped         : ${skipped}`);
  console.log(`[ingest] Garbled (Hindi font issue, skipped): ${garbled}`);
  console.log(`[ingest] Failed          : ${failed}`);
  if (DRY_RUN) console.log('[ingest] DRY RUN — nothing written to the database.');
  console.log('[ingest] Done.\n');
}

main().catch((e) => { console.error('[ingest] Fatal:', e); process.exit(1); });
