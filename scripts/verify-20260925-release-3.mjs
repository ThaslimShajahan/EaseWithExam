/**
 * Release 2026.09.25.3 — both halves, against live, with throwaway students.
 *   node scripts/verify-20260925-release-3.mjs <studentUid> <otherStudentUid>
 * Both must already exist (created through the real signup flow by
 * scripts/qa-live-ai-e2e.mjs … onboard --fresh). Cleanup is separate
 * (scripts/qa-cleanup-throwaways.mjs).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const [S1, S2] = process.argv.slice(2);
if (!S1?.startsWith('qa-tmp-') || !S2?.startsWith('qa-tmp-')) { console.error('two qa-tmp- uids required'); process.exit(1); }
const fb = getAuth();
const mint = async (uid) => (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await fb.createCustomToken(uid), returnSecureToken: true }) })).json()).idToken;
async function rest(method, path, token, body, prefer) {
  const h = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token ?? env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, body: j };
}
const rpc = (fn, args, tok) => rest('POST', `rpc/${fn}`, tok, args);
const results = [];
const check = (id, half, desc, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${half}] ${id} ${desc}\n       ${ev}`); };
const code = (r) => r.body?.code;

const t1 = await mint(S1), t2 = await mint(S2);
const admin = await fb.getUserByEmail('info@acenzos.com');
const tA = await mint(admin.uid);

// ── Online Now / registrations: DENY for students ──
let r = await rpc('admin_get_online_students', { p_caller: S1, p_window_minutes: 60 }, t1);
check('R1', 'DENY', 'student cannot list online students', code(r) === '42501', `HTTP ${r.status} ${code(r)} ${r.body?.message}`);
r = await rpc('admin_get_online_students', { p_caller: admin.uid, p_window_minutes: 60 }, t1);
check('R2', 'DENY', 'student claiming the admin uid is refused', code(r) === '42501' && /mismatch/.test(r.body?.message), `${code(r)} ${r.body?.message}`);
r = await rpc('admin_get_recent_registrations', { p_caller: S1, p_limit: 20 }, t1);
check('R3', 'DENY', 'student cannot read the registration feed', code(r) === '42501', `${code(r)} ${r.body?.message}`);
r = await rest('GET', 'registration_events?select=user_id&limit=5', t1);
check('R4', 'DENY', 'registration_events table not readable directly', r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
r = await rpc('admin_get_online_students', { p_caller: null }, null);
check('R5', 'DENY', 'anonymous caller refused', code(r) === '42501', `${code(r)} ${r.body?.message}`);

// ── heartbeat: own row only ──
const before = await rpc('admin_get_online_students', { p_caller: admin.uid, p_window_minutes: 60 }, tA);
const s2Before = before.body?.online?.find((x) => x.uid === S2)?.last_seen_at ?? null;
r = await rest('PATCH', `users?firebase_uid=eq.${S2}`, t1, { last_seen_at: new Date(Date.now() + 86400000).toISOString() }, 'return=representation');
check('H1', 'DENY', "student cannot write another student's last_seen (direct table update)", r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
r = await rpc('touch_last_seen', { p_platform: 'android' }, t1);
const after = await rpc('admin_get_online_students', { p_caller: admin.uid, p_window_minutes: 60 }, tA);
const s1Row = after.body?.online?.find((x) => x.uid === S1);
const s2After = after.body?.online?.find((x) => x.uid === S2)?.last_seen_at ?? null;
check('H2', 'PERMIT', 'touch_last_seen updates the caller only (S1 → android; S2 untouched)',
  r.status === 204 && s1Row?.platform === 'android' && s2Before === s2After, `touch ${r.status}; S1 ${s1Row?.platform} ${s1Row?.last_seen_at}; S2 ${s2Before} → ${s2After}`);
r = await rpc('touch_last_seen', { p_platform: 'web' }, null);
check('H3', 'DENY', 'heartbeat without a token refused', code(r) === '42501', `${code(r)} ${r.body?.message}`);

// ── admin PERMIT ──
const on = after.body;
check('A1', 'PERMIT', 'admin sees online students + today/week counts (IST)',
  after.status === 200 && on.online_count >= 1 && on.active_today >= on.online_count && on.active_week >= on.active_today && !!s1Row,
  `online ${on?.online_count}, today ${on?.active_today}, week ${on?.active_week}; S1 listed as ${s1Row?.name ?? '(no name)'} Class ${s1Row?.class_level} ${s1Row?.board}`);
const reg = await rpc('admin_get_recent_registrations', { p_caller: admin.uid, p_limit: 20 }, tA);
const mine = (reg.body?.items ?? []).filter((x) => [S1, S2].includes(x.uid));
check('A2', 'PERMIT', 'admin sees both new registrations as onboarded, counted as unseen on the bell',
  reg.status === 200 && mine.length === 2 && mine.every((x) => x.status === 'onboarded' && !x.backfilled) && reg.body.unseen_count >= 2,
  `unseen ${reg.body?.unseen_count}; ${mine.map((x) => `${x.uid.slice(-2)}:${x.status}`).join(', ')}`);

// ── Daily Mini Test: free bucket ──
const q0 = await rpc('begin_ai_action', { p_uid: S2, p_bucket: 'ai_questions', p_amount: 20 }, t2);
const q1 = await rpc('begin_ai_action', { p_uid: S2, p_bucket: 'ai_questions', p_amount: 1 }, t2);
const d = await rpc('begin_ai_action', { p_uid: S2, p_bucket: 'daily_test', p_amount: 1, p_exam_type: 'CBSE Class 8', p_subject: 'Science' }, t2);
if (d.body?.action_id) await rpc('end_ai_action', { p_uid: S2, p_action_id: d.body.action_id, p_actual: 0 }, t2);
if (q0.body?.action_id) await rpc('end_ai_action', { p_uid: S2, p_action_id: q0.body.action_id, p_actual: 0 }, t2);
check('D1', 'PERMIT', 'a student with all 20 AI questions used can still start the Daily Mini Test (free bucket)',
  q0.status === 200 && code(q1) === '54000' && d.status === 200 && d.body?.free === true, `ai_questions 20/20 then: ${q1.body?.message}; daily_test: ${JSON.stringify(d.body)}`);

console.log(`\n${results.filter(Boolean).length} passed, ${results.filter((x) => !x).length} failed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
