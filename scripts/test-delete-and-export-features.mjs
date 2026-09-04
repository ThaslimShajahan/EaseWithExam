/**
 * Functional test for tonight's two new admin features:
 *   1. admin_delete_chapter_manifest (Delete manifest UI, 20260904010000)
 *   2. assert_verified_superadmin / admin_start_data_export /
 *      admin_export_study_notes (Backup all data, 20260904020000)
 *
 * Same real-identity pattern as scripts/approve-chem-p1-fileordinal.mjs —
 * mints a genuine Firebase custom token, signs into a headless browser
 * against the actual app code, and calls the RPCs exactly as the admin UI
 * would (verified_uid()'s auth.jwt() check is real, not something a plain
 * node script with the anon key can forge).
 *
 * Everything this script creates is a throwaway manifest under a book name
 * that starts with __TEST_DELETE__ — deleted by this same run, never left
 * behind. Nothing real is touched or modified.
 *
 * Usage: SUPERADMIN_UID=<uid> PLAIN_ADMIN_UID=<uid> node scripts/test-delete-and-export-features.mjs
 */
import { chromium } from 'playwright';
import { getAuth } from './firebaseAdmin.mjs';

const BASE_URL         = process.env.BASE_URL || 'http://localhost:5173';
const SUPERADMIN_UID   = process.env.SUPERADMIN_UID;
const PLAIN_ADMIN_UID  = process.env.PLAIN_ADMIN_UID;
const EXAM    = 'NEET';
const SUBJECT = 'Physics';
const BOOK    = `__TEST_DELETE__${Date.now()}`;

if (!SUPERADMIN_UID || !PLAIN_ADMIN_UID) {
  console.error('\nSUPERADMIN_UID and PLAIN_ADMIN_UID are both required.\n');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

const browser = await chromium.launch();

async function signInAs(page, uid) {
  const customToken = await getAuth().createCustomToken(uid);
  const signedInAs = await page.evaluate(async (t) => {
    const { signInWithMintedToken } = await import('/src/lib/devAuth.js');
    return signInWithMintedToken(t);
  }, customToken);
  if (signedInAs !== uid) throw new Error(`Signed in as ${signedInAs}, expected ${uid}`);
}

/* ═══════════════════════ Part 1 — Delete manifest ═══════════════════════ */
console.log(`\n═══ Part 1: Delete manifest (${EXAM} / ${SUBJECT} / ${BOOK}) ═══\n`);

const page1 = await browser.newPage();
page1.on('console', (m) => { if (m.type() === 'error') console.log(`  [browser] ${m.text().slice(0, 300)}`); });
await page1.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
await signInAs(page1, SUPERADMIN_UID);
console.log(`Signed in as superadmin ${SUPERADMIN_UID}`);

// 1a. Create a throwaway draft manifest
const entries = [{
  ordinal: 1, title: 'Test Chapter (throwaway)', unit: null,
  pageStart: 1, pageEnd: 5, numbered: true, printedNumber: 1, fileOrdinal: 1, isUnit: false,
}];

const created = await page1.evaluate(async ({ uid, exam, subject, book, entries }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data, error } = await supabase.rpc('admin_upsert_chapter_manifest', {
    p_caller: uid, p_id: null, p_exam_type: exam, p_subject: subject, p_book: book,
    p_class_level: null, p_key_prefix: 'c', p_source_file: null, p_entries: entries,
    p_notes: 'TEST — scripts/test-delete-and-export-features.mjs', p_file_structure: 'per_chapter',
  });
  return { data, error: error?.message };
}, { uid: SUPERADMIN_UID, exam: EXAM, subject: SUBJECT, book: BOOK, entries });

check('Created throwaway draft manifest', !created.error && !!created.data, created.error ?? created.data);
const draftId = created.data;

// 1b. Content-check counts — exact-match against the fake book (expect 0),
// and against a REAL book known to have content, to prove the query isn't
// trivially always-zero.
const counts = await page1.evaluate(async ({ exam, subject, book }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  let kbQ = supabase.from('knowledge_base').select('id', { count: 'exact', head: true })
    .eq('exam_type', exam).eq('subject', subject).eq('book', book);
  const snQ = supabase.from('study_notes').select('id', { count: 'exact', head: true })
    .eq('exam_type', exam).eq('subject', subject);
  const [kb, sn] = await Promise.all([kbQ, snQ]);
  return { kb: kb.count, kbErr: kb.error?.message, sn: sn.count, snErr: sn.error?.message };
}, { exam: EXAM, subject: SUBJECT, book: BOOK });

check('knowledge_base content-check on fake book returns 0', counts.kb === 0, `got ${counts.kb}${counts.kbErr ? ` err=${counts.kbErr}` : ''}`);
check('study_notes content-check (subject-wide) runs without error', !counts.snErr, `count=${counts.sn}${counts.snErr ? ` err=${counts.snErr}` : ''}`);

// Spot-check the content-check query genuinely detects existing content by
// running it against a real book confirmed (via a direct service-role count)
// to have knowledge_base rows — not just "the first approved manifest",
// which can legitimately have zero KB rows if nothing's been uploaded
// through it yet and would make this a false negative, not a real failure.
const realBookCheck = await page1.evaluate(async ({ exam, subject, book }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { count, error } = await supabase.from('knowledge_base').select('id', { count: 'exact', head: true })
    .eq('exam_type', exam).eq('subject', subject).eq('book', book);
  return { count, error: error?.message };
}, { exam: 'CBSE Class 12', subject: 'Physics', book: 'PHYSICS PART 1 INDEX' });
check('knowledge_base content-check on a REAL book with known content (CBSE Class 12/Physics/PHYSICS PART 1 INDEX) finds it',
  realBookCheck.count > 0, `count=${realBookCheck.count}${realBookCheck.error ? ` err=${realBookCheck.error}` : ''}`);

// 1c. Caller-mismatch rejection
const mismatch = await page1.evaluate(async ({ id }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { error } = await supabase.rpc('admin_delete_chapter_manifest', { p_caller: 'not-the-real-uid', p_id: id });
  return { code: error?.code, message: error?.message };
}, { id: draftId });
check('admin_delete_chapter_manifest rejects a mismatched p_caller', mismatch.code === '42501', JSON.stringify(mismatch));

// 1d. Delete the draft, verify gone, verify audit log
const del1 = await page1.evaluate(async ({ uid, id }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { error } = await supabase.rpc('admin_delete_chapter_manifest', { p_caller: uid, p_id: id });
  return { error: error?.message };
}, { uid: SUPERADMIN_UID, id: draftId });
check('admin_delete_chapter_manifest succeeds on a draft', !del1.error, del1.error);

const gone1 = await page1.evaluate(async ({ id }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data } = await supabase.from('chapter_manifests').select('id').eq('id', id);
  return data?.length ?? -1;
}, { id: draftId });
check('Deleted draft row no longer exists', gone1 === 0, `found ${gone1} row(s)`);

// changelog has no client-readable SELECT policy at all (confirmed via
// pg_policies — by design, RLS default-denies reads for every anon/
// authenticated caller, superadmin included), so a browser-session read-back
// can never observe this insert regardless of whether it succeeded — that's
// not something this test can or should work around client-side. logChange()
// itself is fire-and-forget and reports nothing on success, so the real
// assertion here is just "calling it doesn't throw"; actual landing is
// verified out-of-band via `supabase db query --linked` (service role),
// documented in this run's report rather than asserted here.
await page1.evaluate(async ({ id, uid, exam, subject, book }) => {
  const { logChange, ENTITY, ACTION } = await import('/src/lib/changelog.js');
  logChange(ENTITY.CONTENT_ITEM, id, ACTION.DELETE,
    { exam_type: exam, subject, book, status: 'draft', knowledge_base_rows: 0, study_notes_rows_subject_wide: 0 },
    `Chapter manifest DELETED (draft) for ${exam} ${subject} — ${book} [TEST]`, { uid, role: 'superadmin' });
}, { id: draftId, uid: SUPERADMIN_UID, exam: EXAM, subject: SUBJECT, book: BOOK });
console.log(`  [INFO] logChange(DELETE) called for ${draftId} — verify landing via:`);
console.log(`         supabase db query --linked "select * from changelog where entity_id = '${draftId}'"`);

/* ── Repeat with an APPROVED manifest, to prove the RPC allows deleting
   approved rows too (server has no status restriction — the extra guard is
   client-side only, by design) ── */
console.log('\n── Repeat: create → approve → delete an approved manifest ──\n');

const created2 = await page1.evaluate(async ({ uid, exam, subject, book, entries }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data, error } = await supabase.rpc('admin_upsert_chapter_manifest', {
    p_caller: uid, p_id: null, p_exam_type: exam, p_subject: subject, p_book: book,
    p_class_level: null, p_key_prefix: 'c', p_source_file: null, p_entries: entries,
    p_notes: 'TEST — approved-delete path', p_file_structure: 'per_chapter',
  });
  return { data, error: error?.message };
}, { uid: SUPERADMIN_UID, exam: EXAM, subject: SUBJECT, book: `${BOOK}_2`, entries });
check('Created second throwaway draft (for approve+delete path)', !created2.error, created2.error ?? created2.data);
const draftId2 = created2.data;

const approved2 = await page1.evaluate(async ({ uid, id }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { error } = await supabase.rpc('admin_approve_chapter_manifest', { p_caller: uid, p_id: id });
  return { error: error?.message };
}, { uid: SUPERADMIN_UID, id: draftId2 });
check('Approved the second throwaway manifest', !approved2.error, approved2.error);

const del2 = await page1.evaluate(async ({ uid, id }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { error } = await supabase.rpc('admin_delete_chapter_manifest', { p_caller: uid, p_id: id });
  return { error: error?.message };
}, { uid: SUPERADMIN_UID, id: draftId2 });
check('admin_delete_chapter_manifest succeeds on an APPROVED row (server allows it — client is the guard)', !del2.error, del2.error);

const gone2 = await page1.evaluate(async ({ id }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data } = await supabase.from('chapter_manifests').select('id').eq('id', id);
  return data?.length ?? -1;
}, { id: draftId2 });
check('Deleted approved row no longer exists', gone2 === 0, `found ${gone2} row(s)`);

await page1.close();

/* ═══════════════════════ Part 2 — Export gate ═══════════════════════ */
console.log('\n═══ Part 2: Backup export — superadmin-only gate ═══\n');

const page2 = await browser.newPage();
page2.on('console', (m) => { if (m.type() === 'error') console.log(`  [browser] ${m.text().slice(0, 300)}`); });
await page2.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
await signInAs(page2, SUPERADMIN_UID);
console.log(`Signed in as superadmin ${SUPERADMIN_UID}`);

const startOk = await page2.evaluate(async ({ uid }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data, error } = await supabase.rpc('admin_start_data_export', { p_caller: uid });
  return { data, error: error?.message };
}, { uid: SUPERADMIN_UID });
check('admin_start_data_export succeeds for a superadmin', !startOk.error, JSON.stringify(startOk));
console.log(`  counts: ${JSON.stringify(startOk.data)}`);

// Cross-check the study_notes count includes unpublished rows (RLS would hide them)
const directStudyNotesCount = await page2.evaluate(async () => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { count } = await supabase.from('study_notes').select('id', { count: 'exact', head: true });
  return count;
});
check('admin_start_data_export study_notes count >= plain RLS-visible select (includes unpublished)',
  (startOk.data?.study_notes ?? -1) >= directStudyNotesCount,
  `rpc=${startOk.data?.study_notes} direct(rls)=${directStudyNotesCount}`);

const exportPage = await page2.evaluate(async ({ uid }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data, error } = await supabase.rpc('admin_export_study_notes', { p_caller: uid, p_offset: 0, p_limit: 5 });
  return { count: data?.length, error: error?.message, sample: data?.[0] ? Object.keys(data[0]) : null };
}, { uid: SUPERADMIN_UID });
check('admin_export_study_notes returns rows for a superadmin', !exportPage.error && exportPage.count > 0, JSON.stringify(exportPage));

await page2.close();

// Now the negative case — sign in as a PLAIN admin (not superadmin) and
// confirm both export RPCs reject.
const page3 = await browser.newPage();
page3.on('console', (m) => { if (m.type() === 'error') console.log(`  [browser] ${m.text().slice(0, 300)}`); });
await page3.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
await signInAs(page3, PLAIN_ADMIN_UID);
console.log(`Signed in as plain admin ${PLAIN_ADMIN_UID}`);

const startRejected = await page3.evaluate(async ({ uid }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { error } = await supabase.rpc('admin_start_data_export', { p_caller: uid });
  return { code: error?.code, message: error?.message };
}, { uid: PLAIN_ADMIN_UID });
check('admin_start_data_export REJECTS a plain admin (superadmin-only)', startRejected.code === '42501', JSON.stringify(startRejected));

const exportRejected = await page3.evaluate(async ({ uid }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { error } = await supabase.rpc('admin_export_study_notes', { p_caller: uid, p_offset: 0, p_limit: 5 });
  return { code: error?.code, message: error?.message };
}, { uid: PLAIN_ADMIN_UID });
check('admin_export_study_notes REJECTS a plain admin (superadmin-only)', exportRejected.code === '42501', JSON.stringify(exportRejected));

// Sanity: the plain admin should still pass the ORDINARY assert_verified_admin
// gate (proves this is a superadmin-specific rejection, not a broken caller).
const sanityBook = `__TEST_ADMIN_GATE_SANITY__${Date.now()}`;
const ordinaryStillWorks = await page3.evaluate(async ({ uid, book }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { data, error } = await supabase.rpc('admin_upsert_chapter_manifest', {
    p_caller: uid, p_id: null, p_exam_type: 'NEET', p_subject: 'Physics', p_book: book,
    p_class_level: null, p_key_prefix: 'c', p_source_file: null,
    p_entries: [{ ordinal: 1, title: 'x', unit: null, pageStart: 1, pageEnd: 1, numbered: true, printedNumber: 1, fileOrdinal: 1, isUnit: false }],
    p_notes: 'TEST — sanity check, deleted immediately', p_file_structure: 'per_chapter',
  });
  return { ok: !error, error: error?.message, id: data };
}, { uid: PLAIN_ADMIN_UID, book: sanityBook });
check('Plain admin still passes assert_verified_admin on an ordinary RPC (confirms the export rejection is superadmin-specific, not a broken account)',
  ordinaryStillWorks.ok, JSON.stringify(ordinaryStillWorks));

// Clean up the sanity-check row (created as plain admin, delete as superadmin)
if (ordinaryStillWorks.ok && ordinaryStillWorks.id) {
  const page4 = await browser.newPage();
  await page4.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await signInAs(page4, SUPERADMIN_UID);
  const cleaned = await page4.evaluate(async ({ uid, id }) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const { error } = await supabase.rpc('admin_delete_chapter_manifest', { p_caller: uid, p_id: id });
    return { error: error?.message };
  }, { uid: SUPERADMIN_UID, id: ordinaryStillWorks.id });
  check('Cleaned up the sanity-check row', !cleaned.error, cleaned.error);
  await page4.close();
}

await page3.close();
await browser.close();

console.log(`\n═══ ${pass} passed, ${fail} failed ═══\n`);
process.exit(fail > 0 ? 1 : 0);
