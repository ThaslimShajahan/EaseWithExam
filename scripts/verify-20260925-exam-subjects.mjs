/**
 * Both-halves verification for migrations 20260925000000 + 20260925010000
 * (exam→subject rules, hidden subjects, Daily Mini Test RPCs, Class 8–12).
 * Runs against LIVE production with throwaway accounts qa-tmp-subj0925-*.
 * Deletes nothing itself — cleanup is a separate, explicit step afterwards.
 *
 * Does not call the AI: the Daily Mini Test's server gate is pick + save, so
 * saves use a synthetic 1-question paper. Every check asserts HTTP status and
 * the Postgres code/message, never just "it failed".
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const fb = getAuth();

async function mint(uid) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await fb.createCustomToken(uid), returnSecureToken: true }) });
  const d = await r.json(); if (!r.ok) throw new Error(`mint ${uid}: ${JSON.stringify(d).slice(0, 150)}`);
  return d.idToken;
}
async function call(method, path, { token, body, prefer } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, body: j };
}
const rpc = (fn, args, token) => call('POST', `rpc/${fn}`, { token, body: args });

const results = [];
function check(id, half, desc, ok, evidence) {
  results.push({ id, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${half}] ${id}  ${desc}\n       ${evidence}`);
}
const ev = (r) => `HTTP ${r.status} ${r.body && typeof r.body === 'object' && !Array.isArray(r.body) && r.body.code ? `code=${r.body.code} msg=${String(r.body.message).slice(0, 100)}` : JSON.stringify(r.body).slice(0, 140)}`;
const isErr = (r, code, part) => r.status >= 400 && r.body?.code === code && (!part || String(r.body?.message).includes(part));
const ctx = (allowed, exam) => (Array.isArray(allowed) ? allowed : []).find((c) => c.exam_type === exam);
const PAPER = [{ type: 'MCQ', q: 'QA probe question', opts: ['A. 1', 'B. 2', 'C. 3', 'D. 4'], answer: 'B', explanation: 'probe' }];

// ── accounts ──────────────────────────────────────────────────────────────
const ACC = {
  jee:  { uid: 'qa-tmp-subj0925-jee',  f: { target_exam: 'JEE_ADVANCED', syllabus: 'CBSE', class_level: '12', subjects: ['English', 'Physics', 'Chemistry', 'Mathematics'] } },
  neet: { uid: 'qa-tmp-subj0925-neet', f: { target_exam: 'NEET', syllabus: 'CBSE', class_level: '12', subjects: ['English', 'Physics', 'Chemistry', 'Biology'] } },
  cb8:  { uid: 'qa-tmp-subj0925-cb8',  f: { target_exam: 'NONE', syllabus: 'CBSE', class_level: '8' } },
  kl8:  { uid: 'qa-tmp-subj0925-kl8',  f: { target_exam: 'NONE', syllabus: 'KERALA_STATE', class_level: '8' } },
  none: { uid: 'qa-tmp-subj0925-none', f: {} },
  c6:   { uid: 'qa-tmp-subj0925-c6',   f: { target_exam: 'NONE', syllabus: 'CBSE', class_level: '6' } },
};
for (const [k, a] of Object.entries(ACC)) {
  a.tok = await mint(a.uid);
  const r = await rpc('upsert_own_user', { p_uid: a.uid, p_fields: { auth_method: 'phone', display_name: `QA tmp ${k}`, onboarding_completed: Object.keys(a.f).length > 0, ...a.f } }, a.tok);
  check(`P0-${k}`, 'PERMIT', `signup via upsert_own_user (${k})`, r.status === 200 && r.body?.firebase_uid === a.uid, ev(r));
}
const admin = await fb.getUserByEmail('info@acenzos.com');
const tokAdmin = await mint(admin.uid);
const allowedOf = async (a) => (await rpc('allowed_subjects_for_caller', { p_uid: a.uid }, a.tok)).body;

// ── PERMIT: allowed subjects per student ─────────────────────────────────
{
  const al = await allowedOf(ACC.jee);
  const j = ctx(al, 'JEE Advanced'), c = ctx(al, 'CBSE Class 12');
  check('P1', 'PERMIT', 'JEE Advanced student: JEE Advanced = P/C/M; CBSE 12 context has English hidden',
    JSON.stringify(j?.subjects) === '["Physics","Chemistry","Mathematics"]' && c && !c.subjects.includes('English') && c.subjects.includes('Physics'),
    `JEE Adv=${JSON.stringify(j?.subjects)} | CBSE 12=${JSON.stringify(c?.subjects)}`);
  const n = ctx(await allowedOf(ACC.neet), 'NEET');
  check('P2', 'PERMIT', 'NEET student: P/C/B', JSON.stringify(n?.subjects) === '["Physics","Chemistry","Biology"]', JSON.stringify(n?.subjects));
  const b = ctx(await allowedOf(ACC.cb8), 'CBSE Class 8');
  check('P3', 'PERMIT', 'CBSE 8 student: Maths/Science/SocSt/English, no Hindi',
    JSON.stringify(b?.subjects) === '["Mathematics","Science","Social Studies","English"]', JSON.stringify(b?.subjects));
  const k = ctx(await allowedOf(ACC.kl8), 'Kerala State Class 8');
  check('P4', 'PERMIT', 'Kerala 8 student: no Hindi, no Malayalam',
    JSON.stringify(k?.subjects) === '["Mathematics","Science","Social Studies","English"]', JSON.stringify(k?.subjects));
  const z = await allowedOf(ACC.none), zp = await rpc('pick_daily_challenge_subject', { p_uid: ACC.none.uid }, ACC.none.tok);
  check('P5', 'PERMIT', 'incomplete profile: no exams, pick says no_subjects (never a guess)',
    Array.isArray(z) && z.length === 0 && zp.body?.status === 'no_subjects', `allowed=${JSON.stringify(z)} pick=${JSON.stringify(zp.body)}`);
  const s6 = await allowedOf(ACC.c6), p6 = await rpc('pick_daily_challenge_subject', { p_uid: ACC.c6.uid }, ACC.c6.tok);
  check('P6', 'PERMIT', 'Class 6 profile gets nothing (Class 6/7 deactivated) — the "coming soon/setup" state',
    Array.isArray(s6) && s6.length === 0 && p6.body?.status === 'no_subjects', `allowed=${JSON.stringify(s6)} pick=${JSON.stringify(p6.body)}`);
}

// ── PERMIT: Daily Mini Test pick + save ───────────────────────────────────
let jeeChallengeId, cb8ChallengeId;
{
  const picks = [];
  for (let i = 0; i < 12; i++) picks.push((await rpc('pick_daily_challenge_subject', { p_uid: ACC.jee.uid }, ACC.jee.tok)).body);
  const allOk = picks.every((p) => p.status === 'ok' && p.exam_type === 'JEE Advanced' && ['Physics', 'Chemistry', 'Mathematics'].includes(p.subject));
  check('P7', 'PERMIT', '12 picks for the JEE Advanced student: always JEE Advanced + P/C/M, never English',
    allOk, `subjects picked: ${[...new Set(picks.map((p) => p.subject))].join(', ')}; has_content: ${[...new Set(picks.map((p) => p.has_content))].join(',')}`);
  const s = await rpc('save_daily_challenge', { p_uid: ACC.jee.uid, p_exam_type: 'JEE Advanced', p_subject: 'Physics', p_chapter: 'Laws of Motion', p_questions: PAPER }, ACC.jee.tok);
  jeeChallengeId = s.body?.id;
  check('P8', 'PERMIT', 'save allowed pair; server builds the label',
    s.status === 200 && s.body?.question === 'Daily JEE Advanced · Physics · Laws of Motion', `${s.status} label="${s.body?.question}"`);
  const t = await rpc('get_today_daily_challenge', { p_uid: ACC.jee.uid }, ACC.jee.tok);
  check('P9', 'PERMIT', "get_today returns today's allowed test", t.status === 200 && t.body?.id === jeeChallengeId, ev(t));
  const a = await rpc('save_daily_challenge_attempt', { p_uid: ACC.jee.uid, p_challenge_id: jeeChallengeId, p_selected: '{"0":"B"}', p_is_correct: true }, ACC.jee.tok);
  const ra = await rpc('get_own_daily_challenge_attempt', { p_uid: ACC.jee.uid, p_challenge_id: jeeChallengeId }, ACC.jee.tok);
  const wk = await rpc('get_own_daily_challenge_attempts', { p_uid: ACC.jee.uid, p_from: new Date(Date.now() - 86400000).toISOString(), p_to: new Date(Date.now() + 86400000).toISOString() }, ACC.jee.tok);
  check('P10', 'PERMIT', 'attempt saves, reads back, and appears in the weekly report RPC',
    a.status < 300 && ra.body?.[0]?.is_correct === true && wk.body?.length === 1, `save ${a.status}; read ${JSON.stringify(ra.body)}; weekly ${wk.body?.length}`);
  const b = await rpc('save_daily_challenge', { p_uid: ACC.cb8.uid, p_exam_type: 'CBSE Class 8', p_subject: 'Science', p_chapter: 'Light', p_questions: PAPER }, ACC.cb8.tok);
  cb8ChallengeId = b.body?.id;
  check('P11', 'PERMIT', 'board student saves a board subject', b.status === 200 && b.body?.subject === 'Science', ev(b));
  const nt = await rpc('save_daily_challenge', { p_uid: ACC.neet.uid, p_exam_type: 'NEET', p_subject: 'Biology', p_chapter: 'Cell', p_questions: PAPER }, ACC.neet.tok);
  check('P12', 'PERMIT', 'NEET student saves Biology', nt.status === 200 && nt.body?.subject === 'Biology', ev(nt));
}

// ── DENY ──────────────────────────────────────────────────────────────────
{
  for (const t of ['daily_challenges', 'daily_challenge_attempts', 'daily_challenge_history']) {
    const r = await call('GET', `${t}?select=*&limit=1`);
    check(`D1-${t}`, 'DENY', `anon SELECT ${t}`, isErr(r, '42501'), ev(r));
  }
  const ins = await call('POST', 'daily_challenges', { body: { question: null, challenge_date: null }, prefer: 'return=minimal' });
  check('D2', 'DENY', 'anon INSERT daily_challenges (open before this deploy)', isErr(ins, '42501'), ev(ins));
  const direct = await call('POST', 'daily_challenges', { token: ACC.jee.tok, body: { user_id: ACC.jee.uid, challenge_date: '2026-09-25', exam_type: 'JEE Advanced', subject: 'English', question: 'x' }, prefer: 'return=minimal' });
  check('D3', 'DENY', 'signed-in JEE student inserts an English test directly into the table', isErr(direct, '42501'), ev(direct));
  const eng = await rpc('save_daily_challenge', { p_uid: ACC.jee.uid, p_exam_type: 'JEE Advanced', p_subject: 'English', p_chapter: 'Reading Comprehension and Vocabulary', p_questions: PAPER }, ACC.jee.tok);
  check('D4', 'DENY', 'THE BUG: JEE Advanced student forces "JEE Advanced · English" via the save RPC',
    isErr(eng, '22023', 'Subject not allowed for JEE Advanced: English'), ev(eng));
  const eng12 = await rpc('save_daily_challenge', { p_uid: ACC.jee.uid, p_exam_type: 'CBSE Class 12', p_subject: 'English', p_chapter: 'x', p_questions: PAPER }, ACC.jee.tok);
  check('D5', 'DENY', 'hidden subject: CBSE 12 English (hidden) refused for their own board context',
    isErr(eng12, '22023', 'Subject not allowed for CBSE Class 12: English'), ev(eng12));
  const other = await rpc('save_daily_challenge', { p_uid: ACC.jee.uid, p_exam_type: 'CBSE Class 8', p_subject: 'Science', p_chapter: 'x', p_questions: PAPER }, ACC.jee.tok);
  check('D6', 'DENY', "an exam that isn't the student's own", isErr(other, '22023', 'Exam not allowed for this student: CBSE Class 8'), ev(other));
  const hindi = await rpc('save_daily_challenge', { p_uid: ACC.cb8.uid, p_exam_type: 'CBSE Class 8', p_subject: 'Hindi', p_chapter: 'x', p_questions: PAPER }, ACC.cb8.tok);
  check('D7', 'DENY', 'hidden Hindi refused for CBSE 8', isErr(hindi, '22023', 'Subject not allowed for CBSE Class 8: Hindi'), ev(hindi));
  const mal = await rpc('save_daily_challenge', { p_uid: ACC.kl8.uid, p_exam_type: 'Kerala State Class 8', p_subject: 'Malayalam', p_chapter: 'x', p_questions: PAPER }, ACC.kl8.tok);
  check('D8', 'DENY', 'Malayalam (no-content + hidden) refused for Kerala 8', isErr(mal, '22023', 'Subject not allowed for Kerala State Class 8: Malayalam'), ev(mal));
  const c6 = await rpc('save_daily_challenge', { p_uid: ACC.c6.uid, p_exam_type: 'CBSE Class 6', p_subject: 'Mathematics', p_chapter: 'x', p_questions: PAPER }, ACC.c6.tok);
  check('D9', 'DENY', 'Class 6 exam refused (deactivated)', isErr(c6, '22023', 'Exam not allowed for this student: CBSE Class 6'), ev(c6));
  const spoof = await rpc('save_daily_challenge', { p_uid: ACC.cb8.uid, p_exam_type: 'CBSE Class 8', p_subject: 'Science', p_chapter: 'x', p_questions: PAPER }, ACC.jee.tok);
  check('D10', 'DENY', "JEE student saves a test as the CBSE 8 student", isErr(spoof, '42501', 'caller mismatch'), ev(spoof));
  const att = await rpc('save_daily_challenge_attempt', { p_uid: ACC.jee.uid, p_challenge_id: cb8ChallengeId, p_selected: '{}', p_is_correct: false }, ACC.jee.tok);
  check('D11', 'DENY', "attempt on another student's challenge", isErr(att, '22023', 'Unknown challenge'), ev(att));
  const readOther = await rpc('get_own_daily_challenge_attempt', { p_uid: ACC.cb8.uid, p_challenge_id: cb8ChallengeId }, ACC.jee.tok);
  check('D12', 'DENY', "read another student's attempt", isErr(readOther, '42501', 'caller mismatch'), ev(readOther));
  const topics = await rpc('get_recent_challenge_topics', { p_uid: ACC.cb8.uid, p_cutoff: '2026-01-01' });
  check('D13', 'DENY', "anon reads a student's challenge history (was open)", isErr(topics, '42501', 'unverified caller'), ev(topics));
  const hist = await rpc('upsert_challenge_history', { p_uid: ACC.cb8.uid, p_subject: 'Science', p_topic: 'x', p_date: '2026-09-25' }, ACC.jee.tok);
  check('D14', 'DENY', "write another student's history (was open)", isErr(hist, '42501', 'caller mismatch'), ev(hist));
  const histEng = await rpc('upsert_challenge_history', { p_uid: ACC.jee.uid, p_subject: 'English', p_topic: 'x', p_date: '2026-09-25' }, ACC.jee.tok);
  check('D15', 'DENY', 'history RPC refuses a subject the student may not have', isErr(histEng, '22023', 'Subject not allowed: English'), ev(histEng));
  const al = await rpc('allowed_subjects_for_caller', { p_uid: ACC.cb8.uid }, ACC.jee.tok);
  check('D16', 'DENY', "read another student's allowed subjects", isErr(al, '42501', 'caller mismatch'), ev(al));
  const own = await rpc('admin_set_subject_hidden', { p_caller: ACC.jee.uid, p_exam_key: 'JEE Advanced', p_subject: 'Physics', p_hidden: true }, ACC.jee.tok);
  const sp  = await rpc('admin_set_subject_hidden', { p_caller: admin.uid, p_exam_key: 'JEE Advanced', p_subject: 'Physics', p_hidden: true }, ACC.jee.tok);
  check('D17', 'DENY', 'student calls admin_set_subject_hidden (own uid / claiming admin uid)',
    isErr(own, '42501', 'Access denied') && isErr(sp, '42501', 'caller mismatch'), `own: ${ev(own)} | spoof: ${ev(sp)}`);
  const bad = await rpc('save_daily_challenge', { p_uid: ACC.jee.uid, p_exam_type: 'JEE Advanced', p_subject: 'Physics', p_chapter: 'x', p_questions: [{ q: '', answer: '' }] }, ACC.jee.tok);
  check('D18', 'DENY', 'empty question refused', isErr(bad, '22023', 'non-empty q and answer'), ev(bad));
}

// ── Hide → gone everywhere, show → back (admin) ───────────────────────────
{
  const h = await rpc('admin_set_subject_hidden', { p_caller: admin.uid, p_exam_key: 'JEE Advanced', p_subject: 'Physics', p_hidden: true, p_note: 'QA verification: temporary hide' }, tokAdmin);
  const al = ctx(await allowedOf(ACC.jee), 'JEE Advanced');
  const today = await rpc('get_today_daily_challenge', { p_uid: ACC.jee.uid }, ACC.jee.tok);
  const save = await rpc('save_daily_challenge', { p_uid: ACC.jee.uid, p_exam_type: 'JEE Advanced', p_subject: 'Physics', p_chapter: 'x', p_questions: PAPER }, ACC.jee.tok);
  const picks = []; for (let i = 0; i < 8; i++) picks.push((await rpc('pick_daily_challenge_subject', { p_uid: ACC.jee.uid }, ACC.jee.tok)).body.subject);
  check('H1', 'HIDE', 'admin hides JEE Advanced Physics → gone from allowed list, today\'s Physics test, save, and picks',
    h.status === 200 && !al?.subjects.includes('Physics') && !today.body?.id && isErr(save, '22023', 'Subject not allowed for JEE Advanced: Physics') && !picks.includes('Physics'),
    `hide ${h.status}; allowed=${JSON.stringify(al?.subjects)}; today=${today.body?.id ?? 'null'}; save=${save.body?.code}; picks=${[...new Set(picks)].join(',')}`);
  const s = await rpc('admin_set_subject_hidden', { p_caller: admin.uid, p_exam_key: 'JEE Advanced', p_subject: 'Physics', p_hidden: false, p_note: 'QA verification: restore' }, tokAdmin);
  const al2 = ctx(await allowedOf(ACC.jee), 'JEE Advanced');
  const today2 = await rpc('get_today_daily_challenge', { p_uid: ACC.jee.uid }, ACC.jee.tok);
  check('H2', 'SHOW', 'admin shows it again → allowed again and the SAME test is back (nothing was deleted)',
    s.status === 200 && JSON.stringify(al2?.subjects) === '["Physics","Chemistry","Mathematics"]' && today2.body?.id === jeeChallengeId,
    `show ${s.status}; allowed=${JSON.stringify(al2?.subjects)}; today=${today2.body?.id === jeeChallengeId ? 'same test' : today2.body?.id}`);
}

const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
console.log(`\n=== ${pass} passed, ${fail} failed — of ${results.length} checks ===`);
process.exitCode = fail ? 1 : 0;
