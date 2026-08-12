/**
 * Proves BOTH halves of 20260812020000_lock_pyq_questions_writes.sql.
 *
 *   node scripts/audit-pyq-write-lockdown.mjs
 *
 * pyq_questions had RLS enabled with `pyq_open` (cmd=ALL, roles=public,
 * qual=true) — anyone holding the public anon key could rewrite or DELETE the
 * whole ~1,800-row corpus.
 *
 * Deny   — anon INSERT / UPDATE / DELETE must be refused.
 * Keep   — anon SELECT must STILL WORK. Read access is deliberately open, and
 *          breaking it would take down the student PYQ sets, the generator's
 *          blueprint and Content Map in one go.
 * Permit — a real admin, with a real minted Firebase ID token, must still be
 *          able to write through the RPCs.
 * Cross  — anon and a NON-admin must both be refused by those same RPCs.
 *
 * EVERY PROBE IS NON-DESTRUCTIVE BY CONSTRUCTION. This matters more here than
 * anywhere else in this codebase: an anon DELETE probe against a table that is
 * still open would delete real rows, and a webhook probe that "should" have
 * been safe once created a live subscription row. So:
 *
 *   INSERT  sends question_text: null, a NOT NULL column — the row can never be
 *           written whatever RLS decides. 23502 means RLS LET IT THROUGH.
 *   UPDATE  and DELETE act on a throwaway row the audit creates and removes
 *           itself, and assert on the ROW rather than the status code — see
 *           the long comment at the probe. A random-UUID filter cannot work.
 *   RPCs    are called with an EMPTY id array, which returns 0 and touches
 *           nothing while still running the full assert_verified_admin check.
 *
 * Needs secrets/<service-account>.json and VITE_FIREBASE_API_KEY.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getAuth } from './firebaseAdmin.mjs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const FB_KEY = env.VITE_FIREBASE_API_KEY;

const ADMIN   = '2gPm50tCEme5sZebbB5YlQW6R012';  // thaslimshajahans@gmail.com, superadmin
const NOBODY  = 'ATuLRFMq1UhIm7E0alpnJgVcny23';  // a real non-admin user
const NO_MATCH = randomUUID();                    // matches no row, ever

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
};

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, payload };
}

/** RLS refused = 401/403. Anything 2xx means the write path is OPEN, and a
 *  23502 means RLS allowed it and only the NOT NULL constraint stopped it. */
function rlsRefused({ status, payload }) {
  const code = payload?.code;
  const refused = status === 401 || status === 403;
  return {
    ok: refused,
    detail: `HTTP ${status} code=${code ?? '(none)'} ${String(payload?.message ?? '').slice(0, 70)}`
      + (code === '23502' ? '  <-- RLS ALLOWED the write; only NOT NULL stopped it' : '')
      + (status >= 200 && status < 300 ? '  <-- WRITE PATH IS OPEN' : ''),
  };
}

async function mintIdToken(uid) {
  const custom = await getAuth().createCustomToken(uid);
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FB_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  );
  const j = await r.json();
  if (!j.idToken) throw new Error(`mint failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.idToken;
}

(async () => {
  console.log(`\nTarget: ${BASE}\n`);

  /* ── Permit + cross ──────────────────────────────────────────────────── */
  let adminToken, nobodyToken;
  try {
    adminToken  = await mintIdToken(ADMIN);
    nobodyToken = await mintIdToken(NOBODY);
    console.log(`\nMinted tokens for admin ${ADMIN} and non-admin ${NOBODY}\n`);
  } catch (e) {
    record('mint tokens', false, e.message);
    return summarise();
  }

  /* ── Deny: direct table writes as anon ───────────────────────────────── */
  console.log('--- DENY: direct table writes, anon key only ---');
  {
    const r = await call('/rest/v1/pyq_questions', {
      method: 'POST',
      // question_text is NOT NULL -> unwritable whatever RLS says.
      body: [{ exam_type: '__probe__', subject: '__probe__', question_text: null }],
    });
    const v = rlsRefused(r);
    record('anon INSERT is refused', v.ok, v.detail);
  }
  /* UPDATE and DELETE need a row that REALLY EXISTS.
   *
   * The first version of this audit filtered on a random UUID and asserted on
   * the status code. That CANNOT work, and it reported 13/15 on a lockdown
   * that was actually complete. RLS on UPDATE/DELETE is a row FILTER, not an
   * error: with no permissive policy the visible set is empty, the statement
   * touches zero rows, and PostgREST returns 204 — byte-identical to a filter
   * that simply matched nothing. It returned 204 before the migration and 204
   * after, and proved nothing either time.
   *
   * INSERT is the exception, which is why that probe worked: a `with check`
   * violation is a genuine error.
   *
   * So assert on the ROW, not the status. Create a throwaway row through the
   * admin RPC, try to change and delete it as anon, read it back.
   * Non-destructive to real data — the audit owns this row and removes it in
   * the finally block. */
  let probeId = null;
  try {
    const created = await call('/rest/v1/rpc/admin_insert_pyq_rows', {
      method: 'POST', token: adminToken,
      body: { p_caller: ADMIN, p_rows: [{
        exam_type: '__probe__', subject: '__probe__', question_text: 'rls write probe',
        question_type: 'MCQ', status: 'archived', source: '__probe__',
      }] },
    });
    probeId = created.payload?.[0]?.id ?? null;

    if (!probeId) {
      record('create probe row for UPDATE/DELETE checks', false,
        `HTTP ${created.status} ${JSON.stringify(created.payload).slice(0, 140)}`);
    } else {
      // Prefer: return=representation makes the filtering visible — [] means
      // RLS removed the row from the statement's scope.
      const upd = await fetch(`${BASE}/rest/v1/pyq_questions?id=eq.${probeId}`, {
        method: 'PATCH',
        headers: {
          apikey: ANON, Authorization: `Bearer ${ANON}`,
          'Content-Type': 'application/json', Prefer: 'return=representation',
        },
        body: JSON.stringify({ subject: '__SHOULD_NOT_APPLY__' }),
      });
      const updBody = (await upd.text()).trim();
      const updBlocked = updBody === '[]' || upd.status === 401 || upd.status === 403;
      record('anon UPDATE is refused', updBlocked,
        `HTTP ${upd.status} body=${updBody.slice(0, 40) || '(empty)'}`
        + (updBlocked ? ' — row not in scope' : '  <-- ROW WAS MODIFIED'));

      const del   = await call(`/rest/v1/pyq_questions?id=eq.${probeId}`, { method: 'DELETE' });
      const after = await call(`/rest/v1/pyq_questions?select=id,subject&id=eq.${probeId}`);
      const survived = Array.isArray(after.payload) && after.payload.length === 1;
      record('anon DELETE is refused', survived,
        `HTTP ${del.status} — row still present: ${survived}`
        + (survived ? `, subject=${after.payload[0].subject}` : '  <-- ROW WAS DELETED'));
    }
  } finally {
    if (probeId) {
      await call('/rest/v1/rpc/admin_delete_pyq_rows', {
        method: 'POST', token: adminToken, body: { p_caller: ADMIN, p_ids: [probeId] },
      });
    }
  }

  /* ── Keep: read must survive ─────────────────────────────────────────── */
  console.log('\n--- KEEP: public read must still work ---');
  {
    const r = await call('/rest/v1/pyq_questions?select=id&limit=1');
    const ok = r.status === 200;
    record('anon SELECT still works', ok,
      ok ? 'HTTP 200 — students, generator and Content Map unaffected'
         : `HTTP ${r.status} ${JSON.stringify(r.payload).slice(0, 120)}  <-- READ BROKEN`);
  }

  /* ── Deny: the RPCs themselves ───────────────────────────────────────── */
  console.log('\n--- DENY: admin RPCs, anon and non-admin ---');
  const RPCS = [
    ['admin_update_pyq_status', { p_ids: [], p_status: 'archived' }],
    ['admin_delete_pyq_rows',   { p_ids: [] }],
    ['admin_clear_pyq_questions', {}],
    ['admin_insert_pyq_rows',   { p_rows: [] }],
  ];
  for (const [fn, args] of RPCS) {
    const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: { p_caller: ADMIN, ...args } });
    const v = rlsRefused(r);
    record(`${fn} refuses anon`, v.ok, v.detail);
  }


  console.log('--- DENY: signed in, but not an admin ---');
  for (const [fn, args] of RPCS) {
    const r = await call(`/rest/v1/rpc/${fn}`, {
      method: 'POST', body: { p_caller: NOBODY, ...args }, token: nobodyToken,
    });
    const v = rlsRefused(r);
    record(`${fn} refuses a signed-in non-admin`, v.ok, v.detail);
  }

  console.log('\n--- PERMIT: real admin token (the half that matters) ---');
  for (const [fn, args] of [
    ['admin_update_pyq_status', { p_ids: [], p_status: 'archived' }],
    ['admin_delete_pyq_rows',   { p_ids: [] }],
    ['admin_insert_pyq_rows',   { p_rows: [] }],
  ]) {
    const r = await call(`/rest/v1/rpc/${fn}`, {
      method: 'POST', body: { p_caller: ADMIN, ...args }, token: adminToken,
    });
    const ok = r.status === 200;
    record(`${fn} permits a real admin`, ok,
      ok ? `HTTP 200, returned ${JSON.stringify(r.payload)} — no-op payload, nothing written`
         : `HTTP ${r.status} ${JSON.stringify(r.payload).slice(0, 160)}`);
  }
  // admin_clear_pyq_questions is NOT exercised on the permit side: there is no
  // no-op payload for "delete everything", and proving it works would mean
  // deleting the corpus. Its guard is identical to the three above and its deny
  // half IS covered.
  console.log('\n  (admin_clear_pyq_questions permit-half deliberately not run — no non-destructive form)');

  summarise();
})().catch((e) => { console.error('\nAudit aborted:', e.message); process.exit(1); });

function summarise() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
}
