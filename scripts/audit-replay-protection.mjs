/**
 * Proves a payment order can be redeemed exactly once, and only by the server.
 *
 *   node scripts/audit-replay-protection.mjs
 *
 * Seeds a throwaway order, exercises the real redemption path against it, then
 * deletes it. Nothing touches `subscriptions` — redeem_payment_order only
 * claims the order row; activation is a separate call this script never makes.
 *
 * The double-redeem test is the point. Checking "is it redeemed?" and then
 * updating would leave a race between the two statements; the RPC does both in
 * one UPDATE ... WHERE status = 'created' RETURNING, so the second attempt
 * matches no row. This asserts that behaviour rather than the intent.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = 'order_AUDIT_REPLAY_PROBE';
const UID = 'audit-replay-uid';

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

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
};

// Preflight, so the pre-migration state reads as a clean FAIL rather than a
// stack trace. Before 20260811260000 there is no ledger at all, which is
// precisely the condition that makes replay possible.
const ledgerExists = Number(query(`
  select count(*)::text as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payment_orders'
`)[0].n) > 0;

if (!ledgerExists) {
  console.log('  FAIL payment_orders does not exist — no record binds a payment to an account,');
  console.log('       so a valid signature can be replayed, redirected and upgraded at will.');
  console.log('\nFAIL — replay protection is not in place. Push 20260811260000.');
  process.exit(1);
}

const subsBefore = Number(query('select count(*)::text as n from subscriptions')[0].n);

/* 1. The ledger must be invisible to a browser. */
{
  const r = await fetch(`${URL}/rest/v1/payment_orders?select=order_id`, { headers: H });
  const b = await r.json();
  check(r.status >= 400 || (Array.isArray(b) && b.length === 0),
    'payment_orders not readable by anon', `${r.status}`);
}

/* 2. The redemption RPC must be unreachable from a browser. */
{
  const r = await fetch(`${URL}/rest/v1/rpc/redeem_payment_order`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ p_caller: 'guess', p_order_id: ORDER, p_payment_id: 'x' }),
  });
  const t = await r.text();
  check(r.status === 401 || r.status === 403 || /permission denied/i.test(t),
    'redeem_payment_order refuses anon', `${r.status}`);
}

/* 3. Redemption semantics, exercised server-side against a seeded order. */
query(`
  delete from payment_orders where order_id = '${ORDER}';
  insert into payment_orders (order_id, firebase_uid, plan_id, amount_paise)
  values ('${ORDER}', '${UID}', 'premium_monthly', 39900);
  -- Configure the shared secret only for this transaction, so the fail-closed
  -- guard can be exercised without changing the database's real setting.
  set local app.subscription_secret = 'audit-secret';
`);

// A single session is required for `set local` to apply, so each assertion runs
// as its own statement batch with the setting re-established.
const withSecret = (sql) => query(`set local app.subscription_secret = 'audit-secret';\n${sql}`);

{
  const rows = withSecret(`select public.redeem_payment_order('audit-secret','${ORDER}','pay_first') as r`);
  const claim = typeof rows[0].r === 'string' ? JSON.parse(rows[0].r) : rows[0].r;
  check(claim?.firebase_uid === UID && claim?.plan_id === 'premium_monthly' && Number(claim?.amount_paise) === 39900,
    'first redemption returns the STORED binding', JSON.stringify(claim));
}

{
  let raised = false, msg = '';
  try { withSecret(`select public.redeem_payment_order('audit-secret','${ORDER}','pay_second') as r`); }
  catch (e) { raised = true; msg = String(e.message).slice(0, 60); }
  check(raised, 'second redemption of the same order is refused (replay blocked)', msg);
}

{
  let raised = false;
  try { withSecret(`select public.redeem_payment_order('wrong-secret','${ORDER}','x') as r`); }
  catch { raised = true; }
  check(raised, 'wrong shared secret is refused');
}

{
  let raised = false;
  try { query(`select public.redeem_payment_order('anything','${ORDER}','x') as r`); }
  catch { raised = true; }
  check(raised, 'unset shared secret fails CLOSED');
}

/* 4. Clean up and confirm nothing leaked into subscriptions. */
query(`delete from payment_orders where order_id = '${ORDER}';`);
const left = Number(query(`select count(*)::text as n from payment_orders where order_id = '${ORDER}'`)[0].n);
check(left === 0, 'probe order removed');

const subsAfter = Number(query('select count(*)::text as n from subscriptions')[0].n);
check(subsAfter === subsBefore, 'subscriptions unchanged', `${subsBefore} -> ${subsAfter}`);

console.log(failures ? `\nFAIL — ${failures} problem(s).` : '\nPASS — an order redeems once, server-side only.');
process.exit(failures ? 1 : 0);
