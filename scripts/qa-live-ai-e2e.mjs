/**
 * Drives the REAL live web bundle (www.easewithexam.com) as a throwaway
 * student, without OTP/reCAPTCHA: the Firebase session is minted server-side
 * (custom token → signInWithCustomToken) and written into the browser's
 * IndexedDB exactly where the Firebase JS SDK keeps it, before the app loads.
 *
 *   node scripts/qa-live-ai-e2e.mjs <uid> <step> [--headed]
 *   steps: practice | shot:<path>   (see bottom)
 *
 * Every ai-proxy request is recorded: feature, whether x-firebase-id-token was
 * sent, and the status. Facebook / Google Analytics requests are blocked so a
 * test run never shows up in ad or analytics data.
 *
 * Creates the users row (CBSE Class 8, onboarded) if missing. Does NOT delete
 * anything — cleanup is a separate, explicit step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const SITE = 'https://www.easewithexam.com';
const API_KEY = env.VITE_FIREBASE_API_KEY;

const [uid, step = 'practice'] = process.argv.slice(2);
if (!uid?.startsWith('qa-tmp-')) { console.error('uid must start with qa-tmp-'); process.exit(1); }
const headed = process.argv.includes('--headed');

// ── session ──
const ct = await getAuth().createCustomToken(uid);
const sr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
const s = await sr.json();
if (!sr.ok) throw new Error('sign-in failed');
const rpc = (fn, args) => fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${s.idToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(args) });
const up = await rpc('upsert_own_user', { p_uid: uid, p_fields: { auth_method: 'phone', display_name: 'QA Throwaway', onboarding_completed: true, target_exam: 'NONE', syllabus: 'CBSE', class_level: '8' } });
console.log('profile upsert:', up.status);

const now = Date.now();
const authUser = {
  uid, email: null, emailVerified: false, displayName: 'QA Throwaway', isAnonymous: false, photoURL: null,
  phoneNumber: null, tenantId: null, providerData: [],
  stsTokenManager: { refreshToken: s.refreshToken, accessToken: s.idToken, expirationTime: now + Number(s.expiresIn) * 1000 },
  createdAt: String(now), lastLoginAt: String(now), apiKey: API_KEY, appName: '[DEFAULT]',
};

// ── browser ──
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 EWE-QA' });
await ctx.route(/facebook\.(net|com)|google-analytics\.com|googletagmanager\.com|doubleclick/, (r) => r.abort());
const calls = [];
ctx.on('request', (req) => {
  const u = req.url();
  if (u.includes('/functions/v1/ai-proxy') && req.method() === 'POST') {
    let feature = null; try { feature = JSON.parse(req.postData() ?? '{}')._feature ?? null; } catch {}
    const rec = { t: new Date().toISOString(), feature, token: !!req.headers()['x-firebase-id-token'], status: null };
    calls.push(rec);
    req.response().then((r) => { rec.status = r?.status() ?? 'none'; }).catch(() => { rec.status = 'failed'; });
  }
  if (u.includes('/rest/v1/rpc/begin_ai_action') || u.includes('/rest/v1/rpc/end_ai_action')) {
    const rec = { t: new Date().toISOString(), rpc: u.split('/rpc/')[1], status: null };
    calls.push(rec);
    req.response().then((r) => { rec.status = r?.status() ?? 'none'; });
  }
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

// Seed the Firebase session on the real origin, before the app ever loads.
await page.goto(`${SITE}/robots.txt`);
await page.evaluate(async ({ key, value }) => {
  await new Promise((res, rej) => {
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('firebaseLocalStorage', 'readwrite');
      tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value });
      tx.oncomplete = () => { open.result.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  });
}, { key: `firebase:authUser:${API_KEY}:[DEFAULT]`, value: authUser });
// Hide the cookie banner (it covers bottom buttons). Pixel/GA are blocked above regardless.
await page.evaluate(() => localStorage.setItem('ewe_cookie_consent_v1', '1'));

const shot = (name) => page.screenshot({ path: `C:/Users/THASLIM/ewe-db-backups/tools/e2e-${name}.png`, fullPage: false });
const clickText = async (text, opts = {}) => {
  const el = page.getByRole('button', { name: text, exact: !!opts.exact }).first();
  await el.scrollIntoViewIfNeeded(); await el.click();
};

const bundle = async () => page.evaluate(() => [...document.scripts].map((x) => x.src).find((u) => /assets\/index-.*\.js/.test(u)) ?? null);

if (step === 'practice') {
  await page.goto(`${SITE}/practice/generate`, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  console.log('bundle:', await bundle(), 'url:', page.url());
  await shot('p1');
  // Subject: first enabled subject chip; MCQ only; 20 questions.
  const science = page.getByRole('button', { name: /^Science$/ }).first();
  if (await science.count()) await science.click();
  await shot('p2');
  try { await clickText('20', { exact: true }); } catch (e) { console.log('count chip:', e.message.slice(0, 80)); }
  await shot('p3');
  await clickText(/Generate Questions/);
  const t0 = Date.now();
  await page.waitForFunction(() => /Question 1|Q1\b|1\s*\/\s*20|Couldn't|error|Error/i.test(document.body.innerText) && !/Generating \d+ questions/.test(document.body.innerText), null, { timeout: 150000 }).catch(() => {});
  console.log(`waited ${Math.round((Date.now() - t0) / 1000)}s`);
  await page.waitForTimeout(1500);
  await shot('p4');
  const text = await page.evaluate(() => document.body.innerText);
  const errLine = text.split('\n').find((l) => /error|couldn't|failed|expired/i.test(l));
  console.log('error on screen:', errLine ?? '(none)');
  console.log('screen excerpt:', text.replace(/\s+/g, ' ').slice(0, 400));
}

if (step === 'sweep') {
  const SAMPLE = 'Photosynthesis is the process by which green plants make food using sunlight, water and carbon dioxide. Chlorophyll in the leaves absorbs light energy. Oxygen is released as a by-product. The glucose made is used for energy and stored as starch.';
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const features = [
    ['dashboard (Daily Mini Test)', '/dashboard', async () => {}],
    ['flashcards', '/study?tab=flashcards', async () => { await page.getByRole('button', { name: /Generate/ }).first().click(); await page.waitForTimeout(2500); await page.getByRole('button', { name: /Generate & Study/ }).click(); }],
    ['important-qa', '/study?tab=important', async () => { await page.getByRole('button', { name: 'Science', exact: true }).click(); await page.waitForTimeout(1500); await page.locator('button').filter({ hasText: /Invisible Living World|Exploring Forces/ }).first().click(); }],
    ['study-plan', '/study?tab=plan', async () => { await page.locator('input[type=date]').fill(new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)); await page.getByRole('button', { name: /Generate My Study Plan/ }).click(); }],
    ['summarizer', '/study?tab=summarizer', async () => { await page.locator('textarea').fill(SAMPLE); await page.getByRole('button', { name: /^Summarize$/ }).click(); }],
    ['podcast', '/study?tab=podcast', async () => { await page.locator('textarea').fill(SAMPLE); await page.getByRole('button', { name: /Generate Podcast/ }).click(); }],
    ['doubt-chat', '/doubt', async () => { await page.locator('textarea').fill('What is photosynthesis? Answer in one line.'); await page.keyboard.press('Enter'); }],
    ['exam-center', '/exams?tab=papers', async () => { await page.getByRole('button', { name: /Generate First Paper|New Paper/ }).first().click(); await page.waitForTimeout(2500); await shot('ec-setup'); const gen = page.getByRole('button', { name: /Start Generating/ }).last(); await gen.scrollIntoViewIfNeeded(); await gen.click(); }],
  ];
  for (const [name, route, act] of features) {
    if (only && !only.includes(name.split(' ')[0])) continue;
    const before = calls.length;
    await page.goto(`${SITE}${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    let err = null;
    try { await act(); } catch (e) { err = e.message.split('\n')[0].slice(0, 120); }
    // wait until this feature's AI traffic settles (no pending ai-proxy call, then 8s quiet)
    const t0 = Date.now(); let quietSince = Date.now(); let lastLen = calls.length;
    while (Date.now() - t0 < 180000) {
      await page.waitForTimeout(1000);
      if (calls.length !== lastLen || calls.slice(before).some((c) => c.status === null)) { lastLen = calls.length; quietSince = Date.now(); }
      if (Date.now() - quietSince > 8000) break;
    }
    await shot('sw-' + name.split(' ')[0]);
    const mine = calls.slice(before);
    const onScreenErr = (await page.evaluate(() => document.body.innerText)).split('\n').find((l) => /AI proxy error|error \d{3}|expired|sign in again|couldn't|failed/i.test(l));
    console.log(`\n## ${name}${err ? `  [UI step failed: ${err}]` : ''}`);
    for (const c of mine) console.log('   ', c.rpc ? `rpc ${c.rpc} → ${c.status}` : `ai-proxy ${c.feature} token=${c.token} → ${c.status}`);
    if (!mine.length) console.log('    (no AI traffic)');
    console.log('    on-screen error:', onScreenErr ?? '(none)');
  }
}

if (step === 'explore') {
  for (const route of ['/dashboard', '/study?tab=flashcards', '/study?tab=important', '/study?tab=plan', '/study?tab=summarizer', '/study?tab=podcast', '/exams?tab=papers', '/doubt']) {
    await page.goto(`${SITE}${route}`, { waitUntil: 'load' });
    await page.waitForTimeout(5000);
    const info = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 40),
      inputs: [...document.querySelectorAll('input,textarea,select')].filter((b) => b.offsetParent).map((i) => `${i.tagName}:${i.type}:${i.placeholder || i.name || ''}`),
    }));
    console.log(`\n### ${route}\n buttons: ${info.buttons.join(' | ')}\n inputs: ${info.inputs.join(' | ')}`);
  }
}

await page.waitForTimeout(1000);
console.log('\nAI traffic:'); for (const c of calls) console.log(' ', JSON.stringify(c));
console.log('console errors:', consoleErrors.length); consoleErrors.slice(0, 8).forEach((e) => console.log('  ', e));
writeFileSync('C:/Users/THASLIM/ewe-db-backups/tools/e2e-last.json', JSON.stringify({ calls, consoleErrors }, null, 1));
await browser.close();
