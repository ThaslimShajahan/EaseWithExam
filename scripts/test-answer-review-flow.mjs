/**
 * E2E validation of the MCQ answer-uniqueness fix (Parts 1-2, 2026-09-11):
 * does verifyQuestions actually run on AdminPaperGen's real publish path, does
 * the real AnswerReviewModal component render with the flagged question and
 * reason, do its checkboxes default to excluded, and does clicking Publish
 * only save the non-excluded questions?
 *
 * Same real-identity pattern as scripts/test-delete-and-export-features.mjs
 * — EXCEPT that one never actually loaded an admin route (it authenticated
 * via adminAuth and called RPCs directly through page.evaluate, bypassing
 * AdminGuard's UI entirely). This script needs the real AnswerReviewModal
 * DOM to render, so it drives AdminGuard's actual passcode screen with a
 * REAL passcode (env var, never written to disk) — RPC-level testing alone
 * cannot prove a React component renders.
 *
 * Real generation (Part A) proves the actual Generate button/pipeline works.
 * Parts B-D use a DEV-only test hook (window.__adminPaperGenTestHook,
 * temporary — see AdminPaperGen.jsx) to seed a deterministic questions array
 * instead of depending on live AI output happening to collide — the AI is
 * non-deterministic and re-verifying its own honesty isn't this script's
 * job (that's unit-tested already); this validates the UI wiring around it.
 *
 * Cleanup: deletes every published_tests row this run creates. No Firebase
 * user or admins row is created (a real existing superadmin account is
 * used), so nothing else needs cleanup.
 *
 * Usage: ADMIN_PASSCODE=<6 digits> node scripts/test-answer-review-flow.mjs
 *
 * NOT RE-RUNNABLE AS-IS: window.__adminPaperGenTestHook was removed from
 * AdminPaperGen.jsx after this validation pass (2026-09-11) — it was scoped
 * as temporary, dev-only scaffolding, not permanent test infrastructure. Part
 * A (real generation, sign-in) still works; Parts B-D will fail at
 * seedQuestions() until that hook (or an equivalent) is re-added. Kept as a
 * record of what was validated and how, not a standing regression suite.
 */
import { chromium } from 'playwright';
import { getAuth } from './firebaseAdmin.mjs';

const BASE_URL       = process.env.BASE_URL || 'http://localhost:5173';
const SUPERADMIN_UID = '2gPm50tCEme5sZebbB5YlQW6R012'; // thaslimshajahans@gmail.com
const PASSCODE       = process.env.ADMIN_PASSCODE;
const SHOT_DIR        = process.env.SHOT_DIR || '.';

if (!PASSCODE || !/^\d{6}$/.test(PASSCODE)) {
  console.error('\nADMIN_PASSCODE (6 digits) is required.\n');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

const createdTestIds = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [browser] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message.slice(0, 300)}`));

/* ── Sign in as a real superadmin via adminAuth, then clear the real passcode gate ── */
console.log('\n═══ Sign-in ═══\n');
await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' });

const customToken = await getAuth().createCustomToken(SUPERADMIN_UID);
const signedInAs = await page.evaluate(async (t) => {
  const { signInAdminWithMintedToken } = await import('/src/lib/devAuth.js');
  return signInAdminWithMintedToken(t);
}, customToken);
check('Signed into adminAuth as the real superadmin', signedInAs === SUPERADMIN_UID, signedInAs);

await page.goto(`${BASE_URL}/admin/publish?tab=papergen`, { waitUntil: 'domcontentloaded' });

// Passcode screen — real 6-digit code, entered digit by digit through the
// actual PIN pad UI (this is the real server-verified gate; nothing here
// bypasses it).
await page.waitForSelector('text=Enter your 6-digit passcode', { timeout: 15000 });
for (const digit of PASSCODE) {
  await page.getByRole('button', { name: digit, exact: true }).click();
  await page.waitForTimeout(80);
}
await page.waitForSelector('text=Question Paper Generator', { timeout: 15000 });
check('Passed the real passcode screen and reached AdminPaperGen', true);

/* ── Part A — real generation through the actual Generate button ── */
console.log('\n═══ Part A: real AI generation (proves the actual pipeline works) ═══\n');

await page.getByRole('button', { name: 'CBSE', exact: true }).click().catch(() => {});
// Board/class pickers vary in exact label; fall back gracefully if the UI shape differs slightly —
// this part is illustrative (real pipeline proof), not the deterministic assertion.
try {
  await page.getByRole('button', { name: '8', exact: true }).first().click({ timeout: 3000 });
} catch { /* class toggle not found under this label — non-fatal for this illustrative part */ }

const topicsBox = page.locator('textarea, input[placeholder*="topic" i]').first();
if (await topicsBox.count()) {
  await topicsBox.fill('Numeric identification questions: which of the given numbers is a perfect square, a prime number, or an even number.');
}

const countBefore = Date.now();
const generateBtn = page.getByRole('button', { name: /Generate/i }).first();
if (await generateBtn.count()) {
  await generateBtn.click();
  try {
    await page.waitForSelector('text=/[0-9]+\\./', { timeout: 150000 }); // a rendered question number
    check('Real generation produced questions', true, `${Math.round((Date.now() - countBefore) / 1000)}s`);
    await page.screenshot({ path: `${SHOT_DIR}/01-real-generation.png`, fullPage: true });
  } catch (e) {
    check('Real generation produced questions', false, e.message.slice(0, 150));
  }
} else {
  check('Found a Generate button', false);
}

/* ── Helpers for the deterministic parts ── */
const AMBIGUOUS_Q = {
  question: 'Which of the following numbers is a perfect square?',
  type: 'MCQ',
  options: ['A. 64', 'B. 50', 'C. 72', 'D. 81'],
  answer: 'A',
  explanation: '64 = 8 squared, so option A is correct.',
};
const CLEAN_Q_1 = {
  question: 'What is the SI unit of force?',
  type: 'MCQ',
  options: ['A. Newton', 'B. Joule', 'C. Watt', 'D. Pascal'],
  answer: 'A',
  explanation: "Force is measured in newtons, per Newton's second law.",
};
const CLEAN_Q_2 = {
  question: 'What is the chemical symbol for gold?',
  type: 'MCQ',
  options: ['A. Ag', 'B. Au', 'C. Gd', 'D. Go'],
  answer: 'B',
  explanation: 'Gold\'s symbol, Au, comes from the Latin "aurum".',
};

async function seedQuestions(list) {
  await page.evaluate((qs) => window.__adminPaperGenTestHook.setQuestions(qs), list);
  await page.waitForTimeout(200);
}

async function openPublishDialog(title) {
  await page.getByRole('button', { name: 'Publish to Students' }).click();
  await page.getByPlaceholder(/NEET Biology Mock/).fill(title);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
}

async function fetchLatestPublishedTest(title) {
  return page.evaluate(async ({ uid, title }) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const { data, error } = await supabase.rpc('admin_list_published_tests', { p_caller: uid });
    if (error) return { error: error.message };
    const row = (data ?? []).find((r) => r.title === title);
    return { row };
  }, { uid: SUPERADMIN_UID, title });
}

async function deletePublishedTest(id) {
  return page.evaluate(async ({ uid, id }) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const { error } = await supabase.rpc('admin_delete_published_test', { p_caller: uid, p_id: id });
    return { error: error?.message };
  }, { uid: SUPERADMIN_UID, id });
}

/* ── Part B — guaranteed flagged case, default exclude ── */
console.log('\n═══ Part B: ambiguous question flagged, default-excluded on publish ═══\n');

const titleB = `__TEST_REVIEW_FLOW_B__${Date.now()}`;
await seedQuestions([AMBIGUOUS_Q, CLEAN_Q_1]);
await openPublishDialog(titleB);

try {
  await page.waitForSelector('text=/flagged for review/', { timeout: 30000 });
  check('AnswerReviewModal actually rendered (real DOM, real verifyQuestions run)', true);
  await page.screenshot({ path: `${SHOT_DIR}/02-review-modal-flagged.png`, fullPage: true });

  const reasonVisible = await page.getByText(/81/).count();
  check('Flagged question shows its review_reason mentioning the colliding option (81)', reasonVisible > 0);

  const checkbox = page.locator('input[type="checkbox"]');
  check('Checkbox count is exactly 1 (only the flagged question is listed)', await checkbox.count() === 1, `count=${await checkbox.count()}`);
  const isChecked = await checkbox.first().isChecked();
  check('Checkbox defaults to UNCHECKED (excluded by default)', isChecked === false);

  await page.getByRole('button', { name: /Publish 1 question/ }).click();
  await page.waitForSelector('text=Published to Students', { timeout: 15000 });
  check('Publish completed after default-exclude', true);

  await page.waitForTimeout(1000); // let the write settle before reading it back
  const { row, error } = await fetchLatestPublishedTest(titleB);
  check('published_tests row found for this run', !!row, error);
  if (row) {
    createdTestIds.push(row.id);
    check('Saved test has exactly 1 question (the ambiguous one was excluded)', row.questions?.length === 1, `got ${row.questions?.length}`);
    check('The saved question is the CLEAN one, not the ambiguous one', row.questions?.[0]?.question === CLEAN_Q_1.question, row.questions?.[0]?.question);
  }
} catch (e) {
  check('Part B flow completed', false, e.message.slice(0, 200));
}

/* ── Part C — same flagged case, admin explicitly includes it anyway ── */
console.log('\n═══ Part C: admin ticks "include anyway", both questions publish ═══\n');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Question Paper Generator', { timeout: 15000 });

const titleC = `__TEST_REVIEW_FLOW_C__${Date.now()}`;
await seedQuestions([AMBIGUOUS_Q, CLEAN_Q_2]);
await openPublishDialog(titleC);

try {
  await page.waitForSelector('text=/flagged for review/', { timeout: 30000 });
  const checkbox = page.locator('input[type="checkbox"]').first();
  await checkbox.check();
  check('Checkbox toggled to checked (include anyway)', await checkbox.isChecked());

  await page.getByRole('button', { name: /Publish 2 questions/ }).click();
  await page.waitForSelector('text=Published to Students', { timeout: 15000 });

  await page.waitForTimeout(1000); // let the write settle before reading it back
  const { row, error } = await fetchLatestPublishedTest(titleC);
  check('published_tests row found for Part C', !!row, error);
  if (row) {
    createdTestIds.push(row.id);
    check('Saved test has BOTH questions (flagged one explicitly included)', row.questions?.length === 2, `got ${row.questions?.length}`);
  }
} catch (e) {
  check('Part C flow completed', false, e.message.slice(0, 200));
}

/* ── Part D — clean path: no ambiguous questions, modal never appears ── */
console.log('\n═══ Part D: clean paper publishes directly, no modal ═══\n');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Question Paper Generator', { timeout: 15000 });

const titleD = `__TEST_REVIEW_FLOW_D__${Date.now()}`;
await seedQuestions([CLEAN_Q_1, CLEAN_Q_2]);
await openPublishDialog(titleD);

try {
  const modalAppearedQuickly = await page.waitForSelector('text=/flagged for review/', { timeout: 3000 })
    .then(() => true).catch(() => false);
  await page.waitForSelector('text=Published to Students', { timeout: 30000 });
  check('Clean paper published directly with no review modal', !modalAppearedQuickly, `modal appeared=${modalAppearedQuickly}`);
  await page.screenshot({ path: `${SHOT_DIR}/03-clean-path-published.png`, fullPage: true });
  await page.waitForTimeout(1000); // let the write settle before reading it back

  const { row, error } = await fetchLatestPublishedTest(titleD);
  check('published_tests row found for Part D', !!row, error);
  if (row) {
    createdTestIds.push(row.id);
    check('Saved test has both clean questions', row.questions?.length === 2, `got ${row.questions?.length}`);
  }
} catch (e) {
  check('Clean-path flow completed with no modal', false, e.message.slice(0, 200));
}

/* ── Cleanup ── */
console.log('\n═══ Cleanup ═══\n');
for (const id of createdTestIds) {
  const { error } = await deletePublishedTest(id);
  check(`Deleted published_tests row ${id}`, !error, error);
}

await browser.close();
console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`);
process.exit(fail > 0 ? 1 : 0);
