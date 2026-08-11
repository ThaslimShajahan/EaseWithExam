/**
 * Audits the four student tables that shipped with wide-open RLS policies.
 *
 *   node scripts/audit-student-table-rls.mjs           # policy audit
 *   node scripts/audit-student-table-rls.mjs --probe   # + live anon-key probe
 *
 * WHY THIS EXISTS
 *   subscriptions, test_sessions, daily_usage_quota and user_gamification had
 *   RLS *enabled* — which reads as protected at a glance — over policies whose
 *   expression was literally `true`. An anon-key INSERT into subscriptions
 *   granting `neet_complete` returned 201 on 2026-08-11.
 *
 * THE PROBE WRITES NOTHING
 *   It inserts using a primary/unique key that already exists. If RLS permits
 *   the write, Postgres rejects it as a duplicate (409 / 23505) — the row is
 *   never created. If RLS denies it, the error is 42501. Those two outcomes are
 *   what distinguish "open" from "locked", and neither leaves data behind.
 *
 *   A plain UPDATE probe cannot be used: with RLS enabled and no policy the row
 *   is simply invisible, so the UPDATE affects zero rows and returns 204 —
 *   indistinguishable from a permitted update that matched nothing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = process.argv.includes('--probe');

const TABLES = ['subscriptions', 'test_sessions', 'daily_usage_quota', 'user_gamification'];

// Policies allowed to keep an unrestricted SELECT for now. P0.75 locks writes;
// these come off in P1 once the admin panels read through admin RPCs. Any OTHER
// unrestricted policy — and any unrestricted write — is a failure.
const TEMPORARY_OPEN_READS = new Set([
  'quota_read_temporary_open',
  'gamification_read_temporary_open',
  'test_sessions_read_temporary_open',
]);

function query(sql) {
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked'], {
    cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 32 * 1024 * 1024,
    shell: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(out.slice(out.indexOf('{')));
  return parsed.result ?? parsed.rows ?? parsed.data ?? [];
}

const policies = query(`
  select c.relname as tbl, p.polname,
         case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                       when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') as qual,
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as withcheck
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (${TABLES.map((t) => `'${t}'`).join(',')})
  order by 1, 2
`);

const isOpen = (e) => e.trim() === 'true';
let failures = 0;

console.log('policy audit');
for (const t of TABLES) {
  const own = policies.filter((p) => p.tbl === t);
  console.log(`\n  ${t} — ${own.length} polic${own.length === 1 ? 'y' : 'ies'}`);
  for (const p of own) {
    const writeCmd = p.cmd !== 'SELECT';
    const openExpr = isOpen(p.qual) || isOpen(p.withcheck);
    const tolerated = !writeCmd && TEMPORARY_OPEN_READS.has(p.polname);
    const bad = openExpr && !tolerated;
    if (bad) failures++;
    console.log(`    ${bad ? 'FAIL' : tolerated ? 'temp' : 'ok  '} ${p.cmd.padEnd(6)} ${p.polname}`
      + `  using=${p.qual || '-'} check=${p.withcheck || '-'}`);
  }
  // subscriptions must end up with NO client policy at all.
  if (t === 'subscriptions' && own.length > 0) {
    console.log('    FAIL  subscriptions should carry no client policy (deny-all)');
    failures++;
  }
}

if (PROBE) {
  const env = Object.fromEntries(
    readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  console.log('\nlive anon-key probe (no login, writes nothing)');

  // 1. Can anon read subscriptions at all?
  const r1 = await fetch(`${URL}/rest/v1/subscriptions?select=user_id`, { headers: H });
  const rows = await r1.json();
  const readable = Array.isArray(rows) ? rows.length : -1;
  const ok1 = readable === 0 || !Array.isArray(rows);
  if (!ok1) failures++;
  console.log(`  ${ok1 ? 'ok  ' : 'FAIL'} subscriptions rows visible to anon: ${readable}`);

  // 2. Are the payment credential columns reachable?
  const r2 = await fetch(`${URL}/rest/v1/subscriptions?select=razorpay_signature`, { headers: H });
  const t2 = await r2.text();
  const ok2 = r2.status >= 400 || t2 === '[]';
  if (!ok2) failures++;
  console.log(`  ${ok2 ? 'ok  ' : 'FAIL'} razorpay_signature reachable: ${r2.status} ${t2.slice(0, 60)}`);

  // 3. Escalation probe. Uses an EXISTING user_id, so a permitted insert dies on
  //    the unique constraint (23505) and a denied one reports 42501.
  const existing = (await (await fetch(`${URL}/rest/v1/subscriptions?select=user_id&limit=1`, { headers: H })).json());
  const victim = Array.isArray(existing) && existing[0]?.user_id ? existing[0].user_id : 'no-visible-row';
  const r3 = await fetch(`${URL}/rest/v1/subscriptions`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: victim, plan: 'neet_complete', status: 'active' }),
  });
  const t3 = await r3.text();
  const denied = r3.status === 401 || r3.status === 403 || /42501|row-level security/i.test(t3);
  if (!denied) failures++;
  console.log(`  ${denied ? 'ok  ' : 'FAIL'} anon INSERT into subscriptions: ${r3.status} ${t3.slice(0, 70)}`);
  if (!denied && r3.status === 201) {
    console.log('    !! a row was created — delete it before continuing');
  }
}

console.log(failures ? `\nFAIL — ${failures} problem(s).` : '\nPASS — student tables are locked.');
process.exit(failures ? 1 : 0);
