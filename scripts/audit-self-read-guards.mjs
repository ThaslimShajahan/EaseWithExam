/**
 * Proves BOTH halves of 20260812010000_p05_batch5_self_read_guards.sql.
 *
 *   node scripts/audit-self-read-guards.mjs
 *
 * Deny half  — anon (public key only) must be refused, and refused for the
 *              RIGHT reason (42501), not because the route 404'd.
 * Permit half — a REAL Firebase ID token, minted here for a real uid, must
 *              still be able to read its own row and its own plan.
 * Cross half  — that same real token must be refused for a DIFFERENT uid.
 *
 * The permit half is the one that matters. On 2026-08-11 an admin lockdown was
 * shipped having been verified only against anon; it passed, and it locked
 * every admin out of production. "Denied for attackers" was measured,
 * "permitted for real users" was assumed.
 *
 * ASSERTS WHY, NOT JUST THAT. A check that cannot see the reason a call failed
 * will pass on any failure — that mistake was made four separate times in this
 * codebase (a PGRST202 scored as a pass; a query error swallowed into "0 rows";
 * e.message read instead of e.stdout; \b in a template literal).
 *
 * Needs secrets/<service-account>.json (see scripts/firebaseAdmin.mjs) and
 * VITE_FIREBASE_API_KEY in .env to exchange a custom token for an ID token.
 */
import { readFileSync } from 'node:fs';
import { getAuth } from './firebaseAdmin.mjs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);

const SUPABASE = env.VITE_SUPABASE_URL;
const ANON     = env.VITE_SUPABASE_ANON_KEY;
const FB_KEY   = env.VITE_FIREBASE_API_KEY;

// Two real uids. SELF is the one we mint a token for; OTHER is the cross-user
// target. Both belong to the project owner, so no third party's PII is read.
const SELF  = '2gPm50tCEme5sZebbB5YlQW6R012';  // thaslimshajahans@gmail.com
const OTHER = 'RLztGRsC89hpJdBYUpDdud35mCN2';  // info@acenzos.com

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
};

async function rpc(fn, body, token) {
  const res = await fetch(`${SUPABASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let payload;
  const text = await res.text();
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: res.status, payload };
}

/** Mints a real Firebase ID token for `uid` — the same kind of token the
 *  browser attaches, so verified_uid() resolves to exactly this uid. */
async function mintIdToken(uid) {
  const custom = await getAuth().createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FB_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const json = await res.json();
  if (!json.idToken) throw new Error(`could not mint ID token: ${JSON.stringify(json).slice(0, 200)}`);
  return json.idToken;
}

/** A refusal only counts if it is OUR refusal: 42501 raised by the guard. */
function refusedByGuard({ status, payload }) {
  const code = payload?.code;
  const msg  = payload?.message ?? '';
  return {
    ok: (status === 401 || status === 403) && code === '42501' && /Access denied/i.test(msg),
    detail: `HTTP ${status} code=${code ?? '(none)'} message=${JSON.stringify(msg).slice(0, 80)}`,
  };
}

const FNS = [
  { fn: 'get_own_user',               reads: 'the full users row incl. email/phone/pending_email_code_hash' },
  { fn: 'get_student_effective_plan', reads: 'the effective plan' },
];

(async () => {
  console.log(`\nTarget: ${SUPABASE}\n`);

  /* ── Deny half ───────────────────────────────────────────────────────── */
  console.log('--- DENY: anon, public key only ---');
  for (const { fn, reads } of FNS) {
    const r = await rpc(fn, { p_uid: OTHER });
    const v = refusedByGuard(r);
    record(`${fn} refuses anon`, v.ok,
      v.ok ? v.detail : `${v.detail}  <-- still returns ${reads}`);
  }

  /* ── Null subject ────────────────────────────────────────────────────── */
  console.log('\n--- DENY: anon, null subject ---');
  for (const { fn } of FNS) {
    const r = await rpc(fn, { p_uid: null });
    const v = refusedByGuard(r);
    record(`${fn} refuses a null uid`, v.ok, v.detail);
  }

  /* ── Permit + cross halves ───────────────────────────────────────────── */
  let token;
  try {
    token = await mintIdToken(SELF);
    console.log(`\nMinted a real ID token for ${SELF}\n`);
  } catch (e) {
    record('mint ID token for the permit half', false, e.message);
    return summarise();
  }

  console.log('--- PERMIT: real token, own uid (this is the half that matters) ---');
  {
    const r = await rpc('get_own_user', { p_uid: SELF }, token);
    const ok = r.status === 200 && r.payload?.firebase_uid === SELF;
    record('get_own_user permits self', ok,
      ok ? `HTTP 200, returned firebase_uid=${r.payload.firebase_uid}`
         : `HTTP ${r.status} ${JSON.stringify(r.payload).slice(0, 160)}`);
  }
  {
    const r = await rpc('get_student_effective_plan', { p_uid: SELF }, token);
    const ok = r.status === 200 && typeof r.payload === 'string';
    record('get_student_effective_plan permits self', ok,
      ok ? `HTTP 200, plan=${JSON.stringify(r.payload)}`
         : `HTTP ${r.status} ${JSON.stringify(r.payload).slice(0, 160)}`);
  }

  console.log('\n--- DENY: real token, SOMEONE ELSE\'S uid ---');
  for (const { fn } of FNS) {
    const r = await rpc(fn, { p_uid: OTHER }, token);
    const v = refusedByGuard(r);
    record(`${fn} refuses a signed-in user reading another uid`, v.ok, v.detail);
  }

  summarise();
})().catch((e) => {
  console.error('\nAudit aborted:', e.message);
  process.exit(1);
});

function summarise() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
}
