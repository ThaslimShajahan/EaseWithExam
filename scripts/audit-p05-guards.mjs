/**
 * Both-halves verification for the P0.5 guard batches.
 *
 *   node scripts/audit-p05-guards.mjs mutations
 *   node scripts/audit-p05-guards.mjs pii|lists|all
 *
 * P0 was verified against anon only. It passed, and it still locked every
 * admin out of production, because "denied for attackers" was checked and
 * "permitted for real admins" was assumed. This checks both, every time:
 *
 *   HALF 1  anon key + a known admin UID  -> must be REFUSED
 *   HALF 2  a real Firebase ID token for that admin -> must be ACCEPTED
 *
 * Half 2 mints a short-lived ID token for the superadmin via the Firebase
 * Admin SDK. It only ever calls read-only functions; mutating functions are
 * verified by their guard being present in the body, never by invocation.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BATCH = process.argv[2] ?? 'all';
const SUPERADMIN = '2gPm50tCEme5sZebbB5YlQW6R012';

// Safe to actually invoke in half 2: read-only, no arguments beyond p_caller.
const SAFE_TO_CALL = [
  'admin_get_feature_flags', 'admin_list_published_tests', 'admin_list_exam_categories',
  'admin_list_email_templates', 'admin_list_onboarding_options', 'admin_list_users',
  'admin_list_subscriptions', 'admin_list_coaching_centres', 'admin_list_study_notes',
  'admin_get_platform_settings', 'admin_list_quota_overrides', 'admin_list_referrals',
];

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;

function query(sql) {
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked'], {
    cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024,
    shell: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  if (j._tag === 'Error' || j.error) throw new Error(`db query failed: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j.rows ?? j.result ?? [];
}

/* ── Static half: is the guard actually in the body? ─────────────────── */
const guarded = query(`
  select p.proname, (pg_get_functiondef(p.oid) ilike '%assert_verified_admin%') as has_guard
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.prokind='f'
    and (p.proname like 'admin\\_%' or p.proname like 'coaching\\_admin\\_%')
  order by 1
`);
const guardedNames = new Set(guarded.filter((r) => r.has_guard).map((r) => r.proname));
console.log(`functions carrying assert_verified_admin: ${guardedNames.size} / ${guarded.length}`);

let failures = 0;

/* ── Half 1: anon must be refused — on EVERY guarded function ────────── */
//
// Safe to invoke even for mutating functions: assert_verified_admin() is the
// first statement in every body (verified at generation time: no guard sits
// after a DML statement), so an anon caller raises before anything is written.
// Every non-p_caller argument is passed as null, which is enough for PostgREST
// to resolve the overload and never reached because the guard raises first.
const argRows = query(`
  select p.proname, pg_get_function_arguments(p.oid) as args
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.prokind='f'
    and (p.proname like 'admin\\_%' or p.proname like 'coaching\\_admin\\_%')
`);
const argNames = new Map(argRows.map((r) => [
  r.proname,
  (r.args || '').split(',').map((a) => a.trim().split(/\s+/)[0]).filter(Boolean),
]));

console.log(`\nHALF 1 — anon key + known admin UID, ALL ${guardedNames.size} guarded functions (must be REFUSED)`);
let h1ok = 0; const h1bad = [];
for (const name of [...guardedNames].sort()) {
  const body = {};
  for (const a of argNames.get(name) ?? []) body[a] = a === 'p_caller' ? SUPERADMIN : null;
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  const refused = r.status === 401 || r.status === 403 || /Access denied|42501/i.test(t);
  if (refused) h1ok++;
  else { failures++; h1bad.push(`${name} -> ${r.status} ${t.slice(0, 70)}`); }
}
console.log(`  refused: ${h1ok}/${guardedNames.size}`);
h1bad.forEach((s) => console.log(`   FAIL ${s}`));

/* ── Half 2: a real admin must be accepted ───────────────────────────── */
console.log('\nHALF 2 — real Firebase ID token for the superadmin (must be ACCEPTED)');
const custom = await getAuth().createCustomToken(SUPERADMIN);
const ex = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) },
);
const idToken = (await ex.json()).idToken;
if (!idToken) { console.error('  FAIL could not mint an ID token'); process.exit(1); }

for (const name of SAFE_TO_CALL) {
  if (!guardedNames.has(name)) continue;
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_caller: SUPERADMIN }),
  });
  const t = await r.text();
  const ok = r.status === 200;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(r.status).padEnd(4)} ${name}${ok ? '' : '  ' + t.slice(0, 70)}`);
}

/* ── Half 2 on mutating functions, without mutating anything ─────────── */
//
// A guard that refuses everyone would pass half 1 and still be a production
// outage — that is precisely how P0 shipped. So the accept path has to be
// exercised on a mutating function too, not just on reads.
//
// These delete by an id that does not exist. A real admin passes the guard,
// the delete matches zero rows, and nothing changes. Reaching "0 rows" instead
// of "Access denied" is the proof that the guard admitted a verified admin.
const NO_SUCH_UUID = '00000000-0000-0000-0000-000000000000';
// Argument names are read from the catalogue rather than guessed. A guessed
// name yields PGRST202 ("no function matches"), which an earlier version of
// this script scored as a pass simply because it was not a 401 — a 404 proves
// nothing at all and must be reported as inconclusive.
const MUTATING_ACCEPT_PROBES = [
  'admin_delete_study_note',
  'admin_delete_syllabus_node',
  'admin_delete_onboarding_option',
  'admin_delete_exam_category',
];

console.log('\nHALF 2b — real admin token on MUTATING functions (must pass the guard, change nothing)');
let acceptProofs = 0;
for (const name of MUTATING_ACCEPT_PROBES) {
  if (!guardedNames.has(name)) { console.log(`  skip ${name} (not guarded yet)`); continue; }
  const declared = argNames.get(name) ?? [];
  if (!declared.includes('p_caller')) { console.log(`  skip ${name} (no p_caller)`); continue; }
  // Every declared argument, real names, uuid-shaped where the name suggests an id.
  const payload = {};
  for (const a of declared) payload[a] = a === 'p_caller' ? SUPERADMIN : NO_SUCH_UUID;

  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const t = await r.text();
  const denied = r.status === 401 || r.status === 403 || /Access denied/i.test(t);
  const inconclusive = r.status === 404 || /PGRST202/.test(t);   // argument shape, not authorisation
  if (denied) { failures++; console.log(`  FAIL ${String(r.status).padEnd(4)} ${name}  guard rejected a real admin  ${t.slice(0, 50)}`); }
  else if (inconclusive) console.log(`  ??   ${String(r.status).padEnd(4)} ${name}  INCONCLUSIVE (arg shape)  ${t.slice(0, 45)}`);
  else { acceptProofs++; console.log(`  ok   ${String(r.status).padEnd(4)} ${name}  passed guard, changed nothing`); }
}
if (acceptProofs === 0) {
  failures++;
  console.log('  FAIL no mutating function proved the accept path — half 2 is unproven for writes');
}

console.log(failures ? `\nFAIL — ${failures} problem(s).` : '\nPASS — refused for anon, accepted for a verified admin.');
process.exit(failures ? 1 : 0);
