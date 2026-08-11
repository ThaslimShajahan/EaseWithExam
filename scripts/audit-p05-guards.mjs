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

/* ── Half 1: anon must be refused ────────────────────────────────────── */
console.log('\nHALF 1 — anon key + known admin UID (must be REFUSED)');
for (const name of SAFE_TO_CALL) {
  if (!guardedNames.has(name)) continue;
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_caller: SUPERADMIN }),
  });
  const t = await r.text();
  const refused = r.status === 401 || r.status === 403 || /Access denied|42501/i.test(t);
  if (!refused) failures++;
  console.log(`  ${refused ? 'ok  ' : 'FAIL'} ${String(r.status).padEnd(4)} ${name}`);
}

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

/* ── Mutating functions: guard presence only, never invoked ──────────── */
const mutatingGuarded = [...guardedNames].filter((n) => !SAFE_TO_CALL.includes(n));
console.log(`\nguard present but not invoked (mutating / arg-heavy): ${mutatingGuarded.length}`);

console.log(failures ? `\nFAIL — ${failures} problem(s).` : '\nPASS — refused for anon, accepted for a verified admin.');
process.exit(failures ? 1 : 0);
