/**
 * Release 2026.09.25.4 — admin feed contact fallback. Live, both halves.
 *   node scripts/verify-20260925-release-4.mjs
 * Creates one throwaway phone-signup student with NO name (qa-tmp-rel4-s1),
 * which is itself a registration: the owner alert email goes out, as in real
 * life. Cleanup is separate (scripts/qa-cleanup-throwaways.mjs qa-tmp-rel4-).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const S = 'qa-tmp-rel4-s1';
const PHONE = '+910000000404';   // not a real number range
const fb = getAuth();
const mint = async (uid) => (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await fb.createCustomToken(uid), returnSecureToken: true }) })).json()).idToken;
const rpc = async (fn, args, tok) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${tok ?? env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
};
const results = [];
const check = (id, half, desc, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${half}] ${id} ${desc}\n       ${ev}`); };

const tS = await mint(S);
await rpc('upsert_own_user', { p_uid: S, p_fields: { auth_method: 'phone', phone_number: PHONE, onboarding_completed: true, target_exam: 'NONE', syllabus: 'KERALA_STATE', class_level: '9' } }, tS);
await rpc('touch_last_seen', { p_platform: 'web' }, tS);
const admin = await fb.getUserByEmail('info@acenzos.com');
const tA = await mint(admin.uid);

let r = await rpc('admin_get_online_students', { p_caller: S, p_window_minutes: 60 }, tS);
check('D1', 'DENY', 'student → admin_get_online_students', r.body?.code === '42501', `HTTP ${r.status} ${r.body?.code} ${r.body?.message}`);
r = await rpc('admin_get_recent_registrations', { p_caller: S, p_limit: 20 }, tS);
check('D2', 'DENY', 'student → admin_get_recent_registrations', r.body?.code === '42501', `HTTP ${r.status} ${r.body?.code} ${r.body?.message}`);
r = await rpc('admin_get_online_students', { p_caller: admin.uid, p_window_minutes: 60 }, tS);
check('D3', 'DENY', 'student claiming the admin uid', r.body?.code === '42501' && /mismatch/.test(r.body?.message), `${r.body?.code} ${r.body?.message}`);
r = await rpc('admin_get_recent_registrations', { p_caller: null, p_limit: 20 }, null);
check('D4', 'DENY', 'no token at all', r.body?.code === '42501', `${r.body?.code} ${r.body?.message}`);

const on = await rpc('admin_get_online_students', { p_caller: admin.uid, p_window_minutes: 60 }, tA);
const row = on.body?.online?.find((x) => x.uid === S);
check('P1', 'PERMIT', 'admin: online row carries phone_number (name empty) + raw board key for the UI helper',
  !!row && !row.name && row.phone_number === PHONE && row.board === 'KERALA_STATE', JSON.stringify(row ?? null));
const reg = await rpc('admin_get_recent_registrations', { p_caller: admin.uid, p_limit: 20 }, tA);
const rr = reg.body?.items?.find((x) => x.uid === S);
check('P2', 'PERMIT', 'admin: registration row carries phone_number + email fields', !!rr && rr.phone_number === PHONE && 'email' in rr, JSON.stringify(rr ?? null).slice(0, 200));

console.log(`\n${results.filter(Boolean).length} passed, ${results.filter((x) => !x).length} failed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
