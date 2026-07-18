/**
 * Backfill script: embed existing knowledge_base rows that have embedding IS NULL.
 *
 * Usage:
 *   node scripts/backfill-kb-embeddings.mjs            # live run
 *   node scripts/backfill-kb-embeddings.mjs --dry-run  # preview only (no writes)
 *   node scripts/backfill-kb-embeddings.mjs --reset    # delete checkpoint and restart from beginning
 *
 * Requires:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_OPENAI_API_KEY in .env
 *
 * The script maintains a checkpoint file (.backfill-checkpoint) containing the
 * last successfully processed row ID so it can resume after interruption.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// ── Load .env manually (no dotenv dependency required) ───────────────

function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();
loadEnv('.env.local');

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = process.env.VITE_SUPABASE_ANON_KEY;
const OPENAI_KEY    = process.env.VITE_OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('[backfill] Missing required env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai   = new OpenAI({ apiKey: OPENAI_KEY });

// ── Config ────────────────────────────────────────────────────────────

const BATCH_SIZE       = 20;
const RETRY_DELAY_MS   = 1500;
const CHECKPOINT_FILE  = '.backfill-checkpoint';

const DRY_RUN = process.argv.includes('--dry-run');
const RESET   = process.argv.includes('--reset');

if (RESET && existsSync(CHECKPOINT_FILE)) {
  unlinkSync(CHECKPOINT_FILE);
  console.log('[backfill] Checkpoint cleared. Will restart from the beginning.');
}

// ── Helpers ───────────────────────────────────────────────────────────

function loadCheckpoint() {
  try {
    if (existsSync(CHECKPOINT_FILE)) {
      const raw = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
      return raw.lastId ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

function saveCheckpoint(lastId) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastId, updatedAt: new Date().toISOString() }));
}

async function embedText(text) {
  try {
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
    return res.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

async function embedWithRetry(text) {
  let emb = await embedText(text);
  if (!emb) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    emb = await embedText(text);
  }
  return emb;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[backfill] Knowledge-base embedding backfill — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`[backfill] Batch size: ${BATCH_SIZE}\n`);

  // Count total rows needing backfill
  const { count: totalNulls } = await supabase
    .from('knowledge_base')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null);

  const { count: totalRows } = await supabase
    .from('knowledge_base')
    .select('*', { count: 'exact', head: true });

  console.log(`[backfill] Total rows in knowledge_base : ${totalRows ?? '?'}`);
  console.log(`[backfill] Rows with embedding IS NULL  : ${totalNulls ?? '?'}\n`);

  if (!totalNulls) {
    console.log('[backfill] Nothing to do — all rows already have embeddings.');
    return;
  }

  const lastId = loadCheckpoint();
  if (lastId) console.log(`[backfill] Resuming from checkpoint: id > ${lastId}`);

  let embedded  = 0;
  let failed    = 0;
  let processed = 0;
  let cursor    = lastId;

  while (true) {
    // Fetch next batch ordered by id, after the cursor
    let q = supabase
      .from('knowledge_base')
      .select('id, content')
      .is('embedding', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (cursor) q = q.gt('id', cursor);

    const { data: rows, error } = await q;
    if (error) {
      console.error('[backfill] DB fetch error:', error.message);
      break;
    }
    if (!rows?.length) break;

    // Embed in parallel within the batch
    const updates = await Promise.all(
      rows.map(async (row) => {
        const emb = await embedWithRetry(row.content);
        return { id: row.id, embedding: emb };
      }),
    );

    for (const { id, embedding } of updates) {
      processed++;
      if (!embedding) {
        console.warn(`  [FAIL] id=${id} — embed returned null after retry`);
        failed++;
        continue;
      }

      if (!DRY_RUN) {
        const { error: updErr } = await supabase
          .from('knowledge_base')
          .update({ embedding })
          .eq('id', id);
        if (updErr) {
          console.warn(`  [FAIL] id=${id} — update error: ${updErr.message}`);
          failed++;
          continue;
        }
      }

      embedded++;
      if (embedded % 20 === 0) {
        process.stdout.write(`\r[backfill] Embedded ${embedded}/${totalNulls} rows…`);
      }
    }

    // Advance cursor to last row in this batch
    cursor = rows[rows.length - 1].id;
    if (!DRY_RUN) saveCheckpoint(cursor);
  }

  // Final report
  console.log(`\n\n[backfill] ─── Report ─────────────────────────────────`);
  console.log(`[backfill] Total rows scanned   : ${processed}`);
  console.log(`[backfill] Successfully embedded: ${embedded}`);
  console.log(`[backfill] Failed (no embedding): ${failed}`);
  if (DRY_RUN) console.log('[backfill] DRY RUN — no writes were made.');
  if (!DRY_RUN && failed === 0 && existsSync(CHECKPOINT_FILE)) {
    unlinkSync(CHECKPOINT_FILE);
    console.log('[backfill] Checkpoint file removed (complete).');
  }
  console.log('[backfill] Done.\n');
}

main().catch((e) => { console.error('[backfill] Fatal:', e); process.exit(1); });
