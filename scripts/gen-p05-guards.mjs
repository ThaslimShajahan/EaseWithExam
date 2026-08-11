/**
 * Generates the P0.5 migration: injects assert_verified_admin(p_caller) into
 * admin RPC bodies that currently authorise from a client-supplied string.
 *
 *   node scripts/gen-p05-guards.mjs mutations   > supabase/migrations/<ts>_p05_batch1.sql
 *   node scripts/gen-p05-guards.mjs pii
 *   node scripts/gen-p05-guards.mjs lists
 *   node scripts/gen-p05-guards.mjs --report    # classification only, no SQL
 *
 * WHY GENERATED
 *   70 functions authorise with `select role from admins where uid = p_caller`,
 *   which trusts a string the caller supplies. Hand-transcribing 70 bodies to
 *   add one line each is a transcription-error factory. This reads each body
 *   from pg_get_functiondef() and re-emits it verbatim with a single statement
 *   inserted after the outer BEGIN, so the only difference is the guard.
 *
 * WHY NOT A GLOBAL MECHANISM
 *   Forcing RLS on `admins` would fix all 70 at once, but it changes behaviour
 *   for 80 functions simultaneously. The P0 role gate was exactly that shape and
 *   it locked every admin out of production. Batches fail small.
 *
 * WHAT THE GUARD ADDS
 *   assert_verified_admin() requires verified_uid() to be non-null (blocks
 *   anon-key callers outright), to equal p_caller (blocks a signed-in student
 *   passing a known admin UID), and to be an active admin. The pre-existing
 *   inline check is deliberately left in place — smallest possible diff.
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] ?? '--report';

// Never guarded. admin_verify_passcode IS the authentication step; guarding it
// would require the identity it is in the middle of establishing.
const SKIP = new Set(['admin_verify_passcode']);

function query(sql) {
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked'], {
    cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024,
    shell: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  // Surface errors instead of silently returning [] — an earlier version of
  // this helper reported "0 functions read admins" when the query had failed.
  if (j._tag === 'Error' || j.error) {
    throw new Error(`db query failed: ${JSON.stringify(j.error ?? j).slice(0, 400)}`);
  }
  return j.rows ?? j.result ?? [];
}

const rows = query(`
  select p.oid::regprocedure::text as sig,
         p.proname,
         l.lanname as lang,
         pg_get_function_identity_arguments(p.oid) as ident_args,
         (pg_get_function_arguments(p.oid)) as args,
         pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where ns.nspname = 'public' and p.prokind = 'f'
    and (p.proname like 'admin\\_%' or p.proname like 'coaching\\_admin\\_%')
  order by 1
`);

const MUTATES = /\b(insert\s+into|update\s+\w|delete\s+from|truncate)\b/i;
const PII = /\b(from\s+(public\.)?(users|doubt_messages|doubt_chats|referrals|parent_student_links))\b/i;

function classify(r) {
  if (SKIP.has(r.proname))                        return 'skip';
  if (/assert_verified_admin/.test(r.def))        return 'done';
  if (/verified_uid\s*\(/.test(r.def))            return 'done';
  if (MUTATES.test(r.def))                        return 'mutations';
  if (PII.test(r.def))                            return 'pii';
  return 'lists';
}

/** First declared parameter name, which is `p_caller` for the admin surface. */
function firstArgName(identArgs) {
  const first = (identArgs || '').split(',')[0]?.trim() ?? '';
  const m = first.match(/^([a-z_][a-z0-9_]*)\s+/i);
  return m ? m[1] : null;
}

/**
 * Re-emits the definition with one statement inserted after the outer BEGIN.
 * Returns null when the shape is not safe to touch automatically.
 */
function withGuard(def, argName) {
  // Only plpgsql has a BEGIN block to inject into.
  const bodyStart = def.search(/AS\s+\$function\$/i);
  if (bodyStart === -1) return null;

  const afterTag = def.indexOf('$function$', bodyStart) + '$function$'.length;
  // The outer block's BEGIN: first standalone `begin` token after the tag.
  const rel = def.slice(afterTag).search(/(^|\n)\s*begin\s*(\n|$)/i);
  if (rel === -1) return null;

  const m = def.slice(afterTag).match(/(^|\n)(\s*)begin\s*(\n|$)/i);
  const insertAt = afterTag + rel + m[0].length;
  const indent = (m[2] || '') + '  ';
  const guard = `${indent}perform assert_verified_admin(${argName});  -- P0.5\n`;
  return def.slice(0, insertAt) + guard + def.slice(insertAt);
}

const buckets = { mutations: [], pii: [], lists: [], done: [], skip: [], unsafe: [] };

for (const r of rows) {
  const cls = classify(r);
  if (cls === 'done' || cls === 'skip') { buckets[cls].push(r); continue; }
  const arg = firstArgName(r.ident_args);
  const rewritten = arg === 'p_caller' && r.lang === 'plpgsql' ? withGuard(r.def, arg) : null;
  if (!rewritten) { buckets.unsafe.push({ ...r, why: arg !== 'p_caller' ? `first arg is ${arg}` : `lang=${r.lang} / no BEGIN` }); continue; }
  buckets[cls].push({ ...r, rewritten });
}

if (MODE === '--report') {
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`${k.padEnd(10)} ${String(v.length).padStart(3)}`);
  }
  console.log('\nNOT auto-rewritable (need manual handling):');
  buckets.unsafe.forEach((r) => console.log(`   ${r.sig}  — ${r.why}`));
  process.exit(0);
}

const batch = buckets[MODE];
if (!batch) { console.error(`unknown batch "${MODE}"`); process.exit(1); }

const header = `-- P0.5 batch: ${MODE} — bind admin RPCs to a verified identity.
--
-- GENERATED by scripts/gen-p05-guards.mjs. Each function below is re-emitted
-- exactly as pg_get_functiondef() returned it, with a single line added after
-- the outer BEGIN:
--
--     perform assert_verified_admin(p_caller);  -- P0.5
--
-- Nothing else in any body changes. The pre-existing inline admins lookup is
-- left in place on purpose, so the diff is one statement per function.
--
-- assert_verified_admin() requires verified_uid() to be non-null, to equal
-- p_caller, and to be an active admin. That blocks anon-key callers (the live
-- bypass) and also blocks a signed-in non-admin passing a known admin UID,
-- which a grant-based gate could never do — and, unlike the P0 role gate, it
-- does not depend on the request arriving as \`authenticated\`. Every request in
-- this project arrives as \`anon\`; only auth.jwt() is populated.
--
-- Functions in this batch: ${batch.length}
${batch.map((r) => `--   ${r.sig}`).join('\n')}

begin;

`;

console.log(header);
for (const r of batch) {
  console.log(`-- ── ${r.sig} ${'─'.repeat(Math.max(0, 60 - r.sig.length))}`);
  console.log(r.rewritten.trimEnd() + ';');
  console.log();
}
console.log('commit;');
