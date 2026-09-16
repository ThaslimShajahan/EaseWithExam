/**
 * Writes one entry to deploy_log via admin_insert_deploy_log — headless, no
 * browser required. This is a MANDATORY step of docs/DEPLOY.md (see the
 * "Log the deploy" step there), not an optional nicety: a deploy is not
 * considered complete until this either succeeds or is explicitly flagged
 * for manual follow-up (see the fail() output below).
 *
 * WHY THIS EXISTS (found 2026-09-16, investigating why the 09-11 and 09-16
 * deploys never got logged): DEPLOY.md's own procedure never once mentioned
 * writing to deploy_log — that convention lived only in a migration-file
 * comment and an AdminChangelog.jsx comment, invisible to anyone just
 * following the numbered steps. Compounding it, several past deploy sessions
 * (see docs/CHANGELOG.md's 2026-08-20/08-22/08-25 entries) assumed "no admin
 * browser session available" was a hard blocker and left the entry for the
 * owner to write by hand later — but 2026-08-24's entry already found that
 * assumption false once (a minted admin token works fine for RPC calls with
 * no browser at all), and it got carried forward anyway. assert_verified_admin
 * only checks that the request's Firebase JWT `sub` matches an active row in
 * `admins` — no passcode, no browser session, nothing UI-related — so the
 * same headless mint-token-then-exchange bootstrap already proven in
 * scripts/recompress-figures.mjs's initAdminAuth() works here unchanged.
 *
 * Usage:
 *   node scripts/log-deploy.mjs \
 *     --version 2026.09.16.1 \
 *     --summary "One-line human-readable summary" \
 *     --changes '[{"type":"fixed","text":"..."}]' \
 *     --commit 5781bde \
 *     --bundle index-BwHiU5ky.js
 *
 * --version, --summary, --changes are required. --commit/--bundle optional
 * but should always be passed for a real deploy (docs/DEPLOY.md's step 1
 * already produces both before this runs).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'info@acenzos.com';

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const version = arg('version');
const summary = arg('summary');
const changesRaw = arg('changes');
const commit = arg('commit') || null;
const bundle = arg('bundle') || null;

function fail(reason, payload) {
  console.error(`\n[log-deploy] FAILED: ${reason}`);
  console.error('[log-deploy] deploy_log entry NOT written — needs manual follow-up.\n');
  if (payload) {
    console.error('Run this from an authenticated admin session (e.g. the browser console on /admin, signed in) instead:\n');
    console.error(`  await supabase.rpc('admin_insert_deploy_log', ${JSON.stringify(payload, null, 2)});\n`);
  }
  process.exit(1);
}

if (!version || !summary || !changesRaw) {
  fail('--version, --summary, and --changes are all required', null);
}

let changes;
try {
  changes = JSON.parse(changesRaw);
  if (!Array.isArray(changes)) throw new Error('not an array');
} catch (e) {
  fail(`--changes must be a JSON array: ${e.message}`, null);
}

const rpcPayload = {
  p_caller: '<admin uid — see console output above>',
  p_version: version,
  p_summary: summary,
  p_changes: changes,
  p_git_commit_hash: commit,
  p_bundle_hash: bundle,
};

let uid;
let idToken;
try {
  const { getAuth } = await import('./firebaseAdmin.mjs');
  const fbAuth = getAuth();
  const user = await fbAuth.getUserByEmail(ADMIN_EMAIL);
  uid = user.uid;
  const customToken = await fbAuth.createCustomToken(uid);

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Firebase sign-in exchange failed: ${JSON.stringify(data).slice(0, 300)}`);
  idToken = data.idToken;
} catch (e) {
  fail(`could not mint/exchange an admin token (${e.message})`, { ...rpcPayload, p_caller: '<owner admin uid>' });
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  accessToken: async () => idToken,
});

const { data, error } = await supabase.rpc('admin_insert_deploy_log', {
  p_caller: uid,
  p_version: version,
  p_summary: summary,
  p_changes: changes,
  p_git_commit_hash: commit,
  p_bundle_hash: bundle,
});

if (error) {
  fail(`admin_insert_deploy_log rejected the write (${error.message})`, { ...rpcPayload, p_caller: uid });
}

console.log(`[log-deploy] OK — deploy_log entry written (version ${version}, id ${data}).`);
