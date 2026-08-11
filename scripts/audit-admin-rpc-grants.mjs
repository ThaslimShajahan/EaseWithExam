/**
 * Audits the admin RPC surface for the PUBLIC-grant hole.
 *
 *   node scripts/audit-admin-rpc-grants.mjs           # grant audit (needs supabase CLI login)
 *   node scripts/audit-admin-rpc-grants.mjs --probe   # + live anon-key reachability probe
 *
 * WHY THIS EXISTS
 *   20260809030000_verified_identity.sql revoked EXECUTE from `anon` but not
 *   from PUBLIC. Postgres grants EXECUTE to PUBLIC on every new function and
 *   `anon` inherits it, so the revoke was a no-op and all 82 admin RPCs stayed
 *   reachable with nothing but the public anon key. The failure was silent:
 *   the migration ran, reported success, and changed nothing that mattered.
 *
 *   Any future migration that adds an admin_* function reopens the hole for
 *   that function unless it revokes PUBLIC. This turns that from a silent
 *   regression into a failing check.
 *
 * WHAT EACH MODE CHECKS
 *   grants  — reads pg_proc.proacl. An ACL entry with an empty grantee ("=X/…")
 *             means PUBLIC holds EXECUTE. Authoritative, and the real check.
 *   --probe — calls each RPC over PostgREST with the anon key and asserts it is
 *             refused. Slower and noisier (argument-shape errors are not
 *             permission errors), but it is the attacker's-eye view and
 *             catches anything the ACL reading might miss.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = process.argv.includes('--probe');

// Deliberately reachable without an admin identity. admin_verify_passcode IS
// the authentication step (AdminGuard calls it before any admin identity
// exists) and is rate limited; get_admin_record is likewise anon-callable but
// does not match the admin_%/coaching_admin_% patterns, so it never appears here.
const ANON_ALLOWED = new Set(['admin_verify_passcode']);

function query(sql) {
  // SQL goes over stdin, not argv: quoting a multi-line statement through the
  // shell mangles it, and the CLI then reports "no SQL provided via stdin".
  const out = execFileSync(
    'npx',
    ['supabase', 'db', 'query', '--linked'],
    { cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 32 * 1024 * 1024, shell: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(out.slice(out.indexOf('{')));
  return parsed.result ?? parsed.rows ?? parsed.data ?? [];
}

const rows = query(`
  select p.oid::regprocedure::text as sig,
         p.proname,
         coalesce(array_to_string(p.proacl, ','), '') as acl
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and (p.proname like 'admin\\_%' or p.proname like 'coaching\\_admin\\_%')
  order by 1
`);

// An empty grantee before "=X" is PUBLIC. A null/empty ACL means defaults are
// in force, which also means PUBLIC has EXECUTE.
const hasPublicExecute = (acl) =>
  acl === '' || acl.split(',').some((e) => e.startsWith('=') && e.includes('X'));

const offenders = rows.filter((r) => !ANON_ALLOWED.has(r.proname) && hasPublicExecute(r.acl));
const exempt    = rows.filter((r) => ANON_ALLOWED.has(r.proname));

console.log(`admin RPCs found            : ${rows.length}`);
console.log(`intentionally anon-callable : ${exempt.length} (${[...ANON_ALLOWED].join(', ')})`);
console.log(`PUBLIC still has EXECUTE    : ${offenders.length}`);
offenders.forEach((r) => console.log(`   !! ${r.sig}`));

let failed = offenders.length;

if (PROBE) {
  const env = Object.fromEntries(
    readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
  const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  console.log('\nlive anon-key probe (expect every non-exempt RPC to be refused)');

  const reachable = [];
  for (const r of rows) {
    if (ANON_ALLOWED.has(r.proname)) continue;
    // Empty body: PostgREST resolves the overload by name. A permission failure
    // surfaces as 401/403 regardless of whether the arguments would have matched.
    const res = await fetch(`${URL}/rest/v1/rpc/${r.proname}`, {
      method: 'POST', headers: H, body: '{}',
    });
    const text = await res.text();
    const refused = res.status === 401 || res.status === 403
      || /permission denied/i.test(text) || /Access denied/i.test(text);
    // 404 = no overload matched the empty body. That is an argument-shape
    // rejection, not proof of protection, so it is reported separately rather
    // than counted as a pass.
    const inconclusive = res.status === 404;
    if (!refused && !inconclusive) reachable.push(`${r.proname} -> ${res.status} ${text.slice(0, 70)}`);
  }

  console.log(`  reachable without an identity : ${reachable.length}`);
  reachable.forEach((s) => console.log(`   !! ${s}`));
  failed += reachable.length;
}

console.log(failed ? '\nFAIL — admin RPC surface is reachable without an identity.' : '\nPASS — admin RPC surface is closed.');
process.exit(failed ? 1 : 0);
