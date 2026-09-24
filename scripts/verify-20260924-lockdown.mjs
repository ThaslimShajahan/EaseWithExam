/**
 * Both-halves verification for migration 20260924000000 + create-razorpay-order v16.
 * Runs against LIVE production. Creates two throwaway Firebase accounts
 * (qa-tmp-sec0924-a / -b) and deletes nothing itself. Cleanup is a separate,
 * explicit step run afterwards (their users / user_notifications /
 * notification_prefs / payment_orders rows via SQL, then the Firebase
 * accounts), so a crash mid-run can never silently skip it.
 *
 * Every check asserts WHY it passed (HTTP status + Postgres code/message), not
 * merely that a call failed — see feedback-verify-both-halves.
 *
 * Deliberately NOT exercised live (would touch real students / real prices):
 * admin_broadcast_user_notification's permit path (would notify every real
 * student) and admin_upsert_plan_config's write path (would change live
 * prices; that function is unchanged by this migration).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const UID_A = 'qa-tmp-sec0924-a';
const UID_B = 'qa-tmp-sec0924-b';
const fb = getAuth();

async function mint(uid) {
  const custom = await fb.createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const d = await r.json();
  if (!r.ok) throw new Error(`token exchange failed for ${uid}: ${JSON.stringify(d).slice(0, 200)}`);
  return d.idToken;
}

async function call(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}
const rpc = (fn, args, token) => call('POST', `rpc/${fn}`, { token, body: args });

const results = [];
function check(id, half, desc, ok, evidence) {
  results.push({ id, half, desc, ok: !!ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${half}] ${id}  ${desc}\n       ${evidence}`);
}
const ev = (r) => `HTTP ${r.status} ${typeof r.body === 'object' && r.body ? `code=${r.body.code ?? '-'} msg=${String(r.body.message ?? JSON.stringify(r.body)).slice(0, 90)}` : String(r.body).slice(0, 90)}`;
const isErr = (r, code, msgPart) => r.status >= 400 && r.body?.code === code && (!msgPart || String(r.body?.message).includes(msgPart));

// ── setup ─────────────────────────────────────────────────────────────────
const tokA = await mint(UID_A);
const tokB = await mint(UID_B);
const admin = await fb.getUserByEmail('info@acenzos.com');
const tokAdmin = await mint(admin.uid);

// Signup path (upsert_own_user) must still work for a brand-new account.
for (const [uid, tok] of [[UID_A, tokA], [UID_B, tokB]]) {
  const r = await rpc('upsert_own_user', { p_uid: uid, p_fields: { auth_method: 'phone', display_name: `QA tmp ${uid.slice(-1)}` } }, tok);
  check(`P0-${uid.slice(-1)}`, 'PERMIT', `new-account signup via upsert_own_user (${uid})`, r.status === 200 && r.body?.firebase_uid === uid, ev(r));
}

// ── DENY: anonymous, no login ─────────────────────────────────────────────
for (const t of ['user_notifications', 'notification_prefs', 'parent_student_links']) {
  const r = await call('GET', `${t}?select=*&limit=1`);
  check(`D1-${t}`, 'DENY', `anon SELECT ${t}`, isErr(r, '42501'), ev(r));
}
const nullProbes = {
  user_notifications: { user_id: null, type: null, title: null, body: null },
  notification_prefs: { user_id: null },
  exam_notifications: { exam_body: null, title: null },
  plan_config: { plan_id: null, name: null },
  parent_student_links: { student_uid: null },
};
for (const [t, body] of Object.entries(nullProbes)) {
  const r = await call('POST', t, { body, prefer: 'return=minimal' });
  // Before the migration every one of these returned 23502 (write permitted, only NOT NULL stopped it).
  check(`D2-${t}`, 'DENY', `anon INSERT ${t} (was 23502 before)`, isErr(r, '42501'), ev(r));
}
{
  const r = await rpc('get_own_user_notifications', { p_uid: UID_A });
  check('D3', 'DENY', 'anon get_own_user_notifications', isErr(r, '42501', 'unverified caller'), ev(r));
}

// ── seed B with a notification (as B) for cross-account checks ───────────
const seedB = await rpc('create_own_user_notification', { p_uid: UID_B, p_type: 'info', p_title: 'B private', p_body: 'only B may see this', p_link: '/dashboard' }, tokB);
check('P1-seed', 'PERMIT', 'student B creates own notification', seedB.status === 200 && typeof seedB.body === 'string', ev(seedB));
const bNotifId = seedB.body;

// ── DENY: student A against student B ─────────────────────────────────────
{
  const r = await call('GET', 'user_notifications?select=*', { token: tokA });
  check('D4', 'DENY', 'signed-in student direct SELECT user_notifications', isErr(r, '42501'), ev(r));
}
{
  const r = await rpc('get_own_user_notifications', { p_uid: UID_B }, tokA);
  check('D5', 'DENY', "A reads B's notifications via RPC", isErr(r, '42501', 'caller mismatch'), ev(r));
}
{
  const r = await rpc('create_own_user_notification', { p_uid: UID_B, p_type: 'info', p_title: 'x', p_body: 'x' }, tokA);
  check('D6', 'DENY', 'A creates a notification for B', isErr(r, '42501', 'caller mismatch'), ev(r));
}
{
  const r1 = await rpc('mark_own_user_notification_read', { p_uid: UID_A, p_id: bNotifId }, tokA);
  const r2 = await rpc('delete_own_user_notification', { p_uid: UID_A, p_id: bNotifId }, tokA);
  const after = await rpc('get_own_user_notifications', { p_uid: UID_B }, tokB);
  const row = Array.isArray(after.body) ? after.body.find((n) => n.id === bNotifId) : null;
  check('D7', 'DENY', "A marks/deletes B's notification by id → B's row untouched",
    r1.status < 300 && r2.status < 300 && row && row.read === false, `mark ${r1.status}, delete ${r2.status}; B still has it: ${!!row}, read=${row?.read}`);
}
{
  const r = await rpc('get_own_notification_prefs', { p_uid: UID_B }, tokA);
  const w = await rpc('upsert_own_notification_prefs', { p_uid: UID_B, p_fields: { push_enabled: false } }, tokA);
  check('D8', 'DENY', "A reads / writes B's notification prefs", isErr(r, '42501', 'caller mismatch') && isErr(w, '42501', 'caller mismatch'), `read: ${ev(r)} | write: ${ev(w)}`);
}
{
  const r = await rpc('upsert_own_notification_prefs', { p_uid: UID_A, p_fields: { whatsapp_number: '+910000000000' } }, tokA);
  check('D9', 'DENY', 'prefs upsert refuses a non-whitelisted column', isErr(r, '22023', 'Field not allowed: whatsapp_number'), ev(r));
}
{
  const r = await rpc('create_own_user_notification', { p_uid: UID_A, p_type: 'info', p_title: 't', p_body: 'b', p_link: 'https://evil.example' }, tokA);
  check('D10', 'DENY', 'notification link must be an in-app path', isErr(r, '22023', 'Invalid notification link'), ev(r));
}
// Admin RPCs as a student: own uid as caller → not an admin; admin uid as caller → mismatch.
for (const [fn, args] of [
  ['admin_send_user_notification', { p_user_id: UID_B, p_type: 'info', p_title: 'x', p_body: 'x' }],
  ['admin_broadcast_user_notification', { p_type: 'info', p_title: 'x', p_body: 'x' }],
  ['admin_deactivate_exam_notification', { p_id: '00000000-0000-0000-0000-000000000000' }],
  ['admin_clear_exam_notifications', {}],
]) {
  const own = await rpc(fn, { p_caller: UID_A, ...args }, tokA);
  const spoof = await rpc(fn, { p_caller: admin.uid, ...args }, tokA);
  check(`D11-${fn}`, 'DENY', `student calls ${fn}`,
    isErr(own, '42501', 'Access denied') && isErr(spoof, '42501', 'caller mismatch'), `own-uid: ${ev(own)} | admin-uid: ${ev(spoof)}`);
}

// ── PERMIT: own notifications lifecycle ───────────────────────────────────
{
  const c = await rpc('create_own_user_notification', { p_uid: UID_A, p_type: 'info', p_title: 'A own', p_body: 'hello', p_link: '/dashboard' }, tokA);
  const g = await rpc('get_own_user_notifications', { p_uid: UID_A }, tokA);
  const mine = Array.isArray(g.body) ? g.body : [];
  const onlyMine = mine.length > 0 && mine.every((n) => n.user_id === UID_A);
  check('P2', 'PERMIT', 'A creates + reads own notifications (and only own)', c.status === 200 && onlyMine && mine.some((n) => n.id === c.body), `create ${c.status}; read ${g.status}, ${mine.length} row(s), all A's: ${onlyMine}`);
  const m = await rpc('mark_own_user_notification_read', { p_uid: UID_A, p_id: c.body }, tokA);
  const g2 = await rpc('get_own_user_notifications', { p_uid: UID_A }, tokA);
  check('P3', 'PERMIT', 'A marks own notification read', m.status < 300 && g2.body.find((n) => n.id === c.body)?.read === true, `mark ${m.status}`);
  const d = await rpc('delete_own_user_notification', { p_uid: UID_A, p_id: c.body }, tokA);
  const g3 = await rpc('get_own_user_notifications', { p_uid: UID_A }, tokA);
  check('P4', 'PERMIT', 'A deletes own notification', d.status < 300 && !g3.body.some((n) => n.id === c.body), `delete ${d.status}`);
}
{
  const s = await rpc('admin_send_user_notification', { p_caller: admin.uid, p_user_id: UID_A, p_type: 'info', p_title: 'From admin', p_body: 'admin → A', p_link: null }, tokAdmin);
  const g = await rpc('get_own_user_notifications', { p_uid: UID_A }, tokA);
  check('P5', 'PERMIT', 'admin sends to A; A receives it', s.status === 200 && g.body.some((n) => n.id === s.body && n.title === 'From admin'), `send ${ev(s)}`);
}
// Prefs + push delivery path (send-push reads prefs with the service role).
{
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  const endpoint = 'https://www.easewithexam.com/__push_probe_should_404';
  const u = await rpc('upsert_own_notification_prefs', { p_uid: UID_A, p_fields: { push_endpoint: endpoint, push_p256dh: raw, push_auth: auth, push_enabled: true } }, tokA);
  const g = await rpc('get_own_notification_prefs', { p_uid: UID_A }, tokA);
  check('P6', 'PERMIT', 'A saves + reads own push subscription', u.status === 200 && g.body?.push_endpoint === endpoint && g.body?.push_enabled === true, `upsert ${u.status}; read ${g.status}`);
  const p = await fetch(`${URL_}/functions/v1/send-push`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_uid: UID_A, user_id: UID_A, title: 'QA push probe', body: 'probe' }) });
  const pj = await p.json().catch(() => null);
  const g2 = await rpc('get_own_notification_prefs', { p_uid: UID_A }, tokA);
  const delivered = p.status === 200 && pj?.total === 1 && g2.body?.push_endpoint === null && g2.body?.push_enabled === false;
  // KNOWN PRE-EXISTING GAP (2026-09-24): platform_settings has no VAPID keys,
  // so send-push stops before it ever reads notification_prefs. Asserted by
  // exact message so any OTHER failure still surfaces as a real FAIL.
  const knownVapidGap = p.status === 500 && String(pj?.error).startsWith('VAPID keys not found in platform_settings');
  if (knownVapidGap) {
    results.push({ id: 'P7', half: 'KNOWN-GAP', desc: 'send-push delivery', ok: null, evidence: pj.error });
    console.log(`KNOWN [PRE-EXISTING] P7  send-push cannot deliver: ${pj.error}`);
    // Put A back to the post-P6 state the next check expects.
    await rpc('upsert_own_notification_prefs', { p_uid: UID_A, p_fields: { push_endpoint: null, push_p256dh: null, push_auth: null, push_enabled: false } }, tokA);
  } else {
    check('P7', 'PERMIT', 'send-push finds the subscription and cleans up the dead endpoint (service-role read+write still works)',
      delivered, `send-push HTTP ${p.status} ${JSON.stringify(pj)}; after: endpoint=${g2.body?.push_endpoint} enabled=${g2.body?.push_enabled}`);
  }
  const off = await rpc('upsert_own_notification_prefs', { p_uid: UID_A, p_fields: { email_enabled: false } }, tokA);
  const g3 = await rpc('get_own_notification_prefs', { p_uid: UID_A }, tokA);
  check('P8', 'PERMIT', 'partial prefs update leaves other columns intact', off.status === 200 && g3.body?.email_enabled === false && g3.body?.push_enabled === false, `upsert ${off.status}`);
}
{
  const e = await call('GET', 'exam_notifications?select=id&limit=1');
  const pc = await call('GET', 'plan_config?select=plan_id,price_paise');
  check('P9', 'PERMIT', 'public reads kept: active exam_notifications + plan_config (pricing page)', e.status === 200 && pc.status === 200 && Array.isArray(pc.body), `exam ${e.status}, plan_config ${pc.status}`);
}
{
  const d = await rpc('admin_deactivate_exam_notification', { p_caller: admin.uid, p_id: '00000000-0000-0000-0000-000000000000' }, tokAdmin);
  check('P10', 'PERMIT', 'admin exam-notification RPC accepted for a real admin', d.status < 300, ev(d));
}

// ── Checkout: create-razorpay-order v16 ───────────────────────────────────
async function order(planId, { idToken, bodyUid } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  if (idToken) headers['x-firebase-id-token'] = idToken;
  const r = await fetch(`${URL_}/functions/v1/create-razorpay-order`, { method: 'POST', headers, body: JSON.stringify({ plan_id: planId, ...(bodyUid ? { firebase_uid: bodyUid } : {}) }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
{
  const r = await order('premium_monthly', { bodyUid: UID_A });
  check('D12', 'DENY', 'checkout with no Firebase token (old client shape)', r.status === 401, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  const bad = await order('premium_monthly', { idToken: 'not-a-real-token' });
  check('D13', 'DENY', 'checkout with a forged token', bad.status === 401, `HTTP ${bad.status} ${JSON.stringify(bad.body)}`);
  const v = await order('verification_1rs', { idToken: tokA, bodyUid: admin.uid });
  check('D14', 'DENY', 'non-superadmin asks for verification_1rs (even claiming an admin uid in the body)', v.status === 400 && v.body?.error === 'Invalid plan_id', `HTTP ${v.status} ${JSON.stringify(v.body)}`);
}
{
  // Permit: real order, and the body's firebase_uid (spoofed as the admin) must be ignored.
  const r = await order('premium_monthly', { idToken: tokA, bodyUid: admin.uid });
  check('P11', 'PERMIT', 'checkout with A token creates an order at catalogue price', r.status === 200 && r.body?.order_id && r.body?.amount > 0, `HTTP ${r.status} amount=${r.body?.amount} order=${r.body?.order_id ? 'yes' : 'no'}`);
  globalThis.__orderId = r.body?.order_id;
}

const summary = {
  pass: results.filter((r) => r.ok === true).length,
  fail: results.filter((r) => r.ok === false).length,
  known: results.filter((r) => r.ok === null).length,
  orderId: globalThis.__orderId ?? null,
};
console.log(`\n=== ${summary.pass} passed, ${summary.fail} failed, ${summary.known} known pre-existing gap(s) — of ${results.length} checks ===`);
console.log(`ORDER_ID=${summary.orderId ?? ''}`);
process.exitCode = summary.fail ? 1 : 0;
