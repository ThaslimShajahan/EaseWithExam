/**
 * Fix A (2026-09-25): ai-proxy error bodies are { error: { message, code }, code }
 * so every client — including a page still running a pre-security-pass bundle —
 * shows a readable message instead of "AI proxy error 401".
 *
 * Part 1: API-level, both halves. Part 2: loads the OLD live bundle
 * (index-uwfRZ7sz.js, still on the server) in a real browser as a throwaway
 * student and reads what Practice → Generate actually puts on screen.
 * Throwaway: qa-tmp-fixa-s1 (deleted by the cleanup step, not here).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const SITE = 'https://www.easewithexam.com';
const FN = `${env.VITE_SUPABASE_URL}/functions/v1/ai-proxy`;
const OLD_BUNDLE = '/assets/index-uwfRZ7sz.js';
const UID = 'qa-tmp-fixa-s1';
const fb = getAuth();

async function session(uid) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await fb.createCustomToken(uid), returnSecureToken: true }) });
  return r.json();
}
const rpc = (fn, args, tok) => fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
const proxy = async (body, tok) => {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` };
  if (tok) h['x-firebase-id-token'] = tok;
  const r = await fetch(FN, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const results = [];
const check = (id, half, desc, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${half}] ${id} ${desc}\n       ${ev}`); };
const tiny = (feature) => ({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: 'Reply OK.' }], _feature: feature });
// What every bundle does with an error body: err?.error?.message || `AI proxy error ${status}`
const shown = (r) => r.body?.error?.message || `AI proxy error ${r.status}`;

const s = await session(UID);
await rpc('upsert_own_user', { p_uid: UID, p_fields: { auth_method: 'phone', display_name: 'QA Throwaway', onboarding_completed: true, target_exam: 'NONE', syllabus: 'CBSE', class_level: '8' } }, s.idToken);

// ── Part 1 ──
let r = await proxy(tiny('question-gen-paper'), null);
check('F1', 'DENY', 'no token (what an old bundle sends) → 401 client_outdated, friendly reload text',
  r.status === 401 && r.body?.error?.code === 'client_outdated' && r.body?.code === 'client_outdated' && /reload the page/.test(r.body?.error?.message),
  `HTTP ${r.status}; an old bundle would display: "${shown(r)}"`);

r = await proxy(tiny('question-gen-paper'), 'not-a-real-token');
check('F2', 'DENY', 'invalid/expired token → 401 session_expired', r.status === 401 && r.body?.error?.code === 'session_expired', `HTTP ${r.status}; displayed: "${shown(r)}"`);

r = await proxy(tiny('vision-page-extract'), s.idToken);
check('F3', 'DENY', 'student → admin-only feature → 403 (was 401 "Sign in again")', r.status === 403 && /admin-only/.test(r.body?.error?.message), `HTTP ${r.status}; displayed: "${shown(r)}"`);

r = await proxy(tiny('flashcards'), s.idToken);
check('F4', 'DENY', 'student with no charged action → 403 no_active_quota, friendly text', r.status === 403 && r.body?.error?.code === 'no_active_quota', `HTTP ${r.status}; displayed: "${shown(r)}"`);

r = await proxy(tiny('qa-made-up'), s.idToken);
check('F5', 'DENY', 'unknown feature → 400 with message', r.status === 400 && /Unknown AI feature/.test(r.body?.error?.message), `HTTP ${r.status}; displayed: "${shown(r)}"`);

const b = await (await rpc('begin_ai_action', { p_uid: UID, p_bucket: 'ai_questions', p_amount: 1, p_exam_type: 'CBSE Class 8', p_subject: 'Science' }, s.idToken)).json();
r = await proxy(tiny('flashcards'), s.idToken);
await rpc('end_ai_action', { p_uid: UID, p_action_id: b.action_id, p_actual: 1 }, s.idToken);
check('F6', 'PERMIT', 'current-bundle path (token + charged action) still works', r.status === 200 && Array.isArray(r.body?.choices), `HTTP ${r.status}`);

// ── Part 2: the old bundle, in a real browser ──
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
await ctx.route(/facebook\.(net|com)|google-analytics\.com|googletagmanager\.com|doubleclick/, (x) => x.abort());
// Serve today's index.html with the entry script swapped for the pre-deploy bundle.
await ctx.route((u) => u.origin === SITE && !/\.[a-z0-9]+$/i.test(u.pathname) && !u.pathname.startsWith('/robots'), async (route) => {
  const res = await route.fetch();
  const html = (await res.text()).replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/, OLD_BUNDLE);
  await route.fulfill({ response: res, body: html });
});
const page = await ctx.newPage();
const proxyCalls = [];
page.on('response', async (res) => { if (res.url().includes('/functions/v1/ai-proxy')) proxyCalls.push(`${res.status()} token=${!!res.request().headers()['x-firebase-id-token']}`); });
await page.goto(`${SITE}/robots.txt`);
await page.evaluate(async ({ key, value }) => {
  await new Promise((res, rej) => {
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
    open.onerror = () => rej(open.error);
    open.onsuccess = () => { const tx = open.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value }); tx.oncomplete = () => { open.result.close(); res(); }; };
  });
  localStorage.setItem('ewe_cookie_consent_v1', '1');
}, { key: `firebase:authUser:${env.VITE_FIREBASE_API_KEY}:[DEFAULT]`, value: {
  uid: UID, email: null, emailVerified: false, displayName: 'QA Throwaway', isAnonymous: false, photoURL: null, phoneNumber: null, tenantId: null, providerData: [],
  stsTokenManager: { refreshToken: s.refreshToken, accessToken: s.idToken, expirationTime: Date.now() + 3500e3 },
  createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: env.VITE_FIREBASE_API_KEY, appName: '[DEFAULT]' } });
await page.goto(`${SITE}/practice/generate`, { waitUntil: 'load' });
await page.waitForTimeout(6000);
const bundle = await page.evaluate(() => [...document.scripts].map((x) => x.src).find((u) => /assets\/index-/.test(u)));
await page.getByRole('button', { name: /Generate Questions/ }).first().click();
await page.waitForTimeout(12000);
await page.screenshot({ path: 'C:/Users/THASLIM/ewe-db-backups/tools/fixa-old-bundle.png' });
const text = await page.evaluate(() => document.body.innerText);
const line = text.split('\n').find((l) => /reload|AI proxy error|expired|updated/i.test(l));
check('F7', 'DISPLAY', `old bundle (${bundle?.split('/').pop()}) shows the friendly reload text on Practice → Generate`,
  bundle?.endsWith(OLD_BUNDLE) && /reload the page/.test(line ?? '') && !/AI proxy error/.test(text),
  `ai-proxy responses: ${proxyCalls.join(', ') || 'none'}; on screen: "${line ?? '(no matching line)'}"`);
await browser.close();

console.log(`\n${results.filter(Boolean).length} passed, ${results.filter((x) => !x).length} failed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
