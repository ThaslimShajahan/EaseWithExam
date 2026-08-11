/**
 * Audits every route to a free subscription.
 *
 *   node scripts/audit-payment-paths.mjs
 *
 * Checks each path an unauthenticated caller could use to grant themselves a
 * plan, and asserts the subscriptions table is unchanged afterwards.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION
 *   The activate_subscription probe passes p_plan = NULL. If the guard lets it
 *   through, the insert dies on the NOT NULL constraint (23502) and no row is
 *   created — so reaching 23502 is the *failure* signal, and a permission error
 *   is the pass. The webhook probe is the exception: it cannot be made safe,
 *   because a working exploit there creates a row by definition. It is only run
 *   with --include-webhook, and the row count is checked before and after.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE_WEBHOOK = process.argv.includes('--include-webhook');

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.VITE_SUPABASE_URL, K = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

function query(sql) {
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked'], {
    cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 32 * 1024 * 1024,
    shell: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  if (j._tag === 'Error' || j.error) throw new Error(`db query failed: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j.rows ?? j.result ?? [];
}

const countRows = () => Number(query('select count(*)::text as n from subscriptions')[0].n);
const before = countRows();
console.log(`subscriptions rows before: ${before}`);

let failures = 0;

/* 1. activate_subscription — the SECURITY DEFINER grant path */
{
  const r = await fetch(`${URL}/rest/v1/rpc/activate_subscription`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      p_caller: 'i-am-not-the-secret', p_uid: 'audit-probe-no-write',
      p_plan: null, p_expires: null, p_payment_id: 'audit', p_amount: 0,
    }),
  });
  const t = await r.text();
  const blocked = r.status === 401 || r.status === 403 || /permission denied|Unauthorized caller|not configured/i.test(t);
  const reachedInsert = /23502|null value in column/i.test(t);
  if (!blocked || reachedInsert) failures++;
  console.log(`  ${blocked && !reachedInsert ? 'ok  ' : 'FAIL'} activate_subscription (anon): ${r.status} ${t.slice(0, 90)}`);
  if (reachedInsert) console.log('       !! guard skipped — a real p_plan would have granted a subscription');
}

/* 2. Direct table write */
{
  const r = await fetch(`${URL}/rest/v1/subscriptions`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: 'audit-probe-no-write', plan: 'neet_complete', status: 'active' }),
  });
  const t = await r.text();
  const blocked = r.status === 401 || r.status === 403 || /42501|row-level security/i.test(t);
  if (!blocked) failures++;
  console.log(`  ${blocked ? 'ok  ' : 'FAIL'} direct INSERT into subscriptions (anon): ${r.status} ${t.slice(0, 70)}`);
}

/* 3. razorpay-webhook — only on request; a working exploit here writes a row */
if (INCLUDE_WEBHOOK) {
  const r = await fetch(`${URL}/functions/v1/razorpay-webhook`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'audit', notes: { firebase_uid: 'audit-probe-webhook', plan_id: 'neet_complete' } } } },
    }),
  });
  const t = await r.text();
  const rejected = r.status === 401 || /Invalid signature/i.test(t);
  if (!rejected) failures++;
  console.log(`  ${rejected ? 'ok  ' : 'FAIL'} razorpay-webhook unsigned event: ${r.status} ${t.slice(0, 70)}`);
  if (!rejected) console.log('       !! deployed build does not verify signatures — redeploy it');
} else {
  console.log('  skip razorpay-webhook (pass --include-webhook; a working exploit there creates a row)');
}

const after = countRows();
console.log(`subscriptions rows after:  ${after}`);
if (after !== before) {
  failures++;
  console.log('  FAIL a probe created a subscription row — delete it before continuing:');
  query('select user_id, plan, status from subscriptions').forEach((r) => console.log(`     ${r.user_id}  ${r.plan}  ${r.status}`));
}

console.log(failures ? `\nFAIL — ${failures} open path(s) to a free subscription.` : '\nPASS — no anon path to a subscription.');
process.exit(failures ? 1 : 0);
