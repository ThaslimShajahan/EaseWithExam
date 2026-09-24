/**
 * Both-halves verification for security pass 2 (migrations 20260926000000 /
 * 010000 / 020000 + edge functions), run against LIVE production.
 *
 * Throwaway accounts: qa-tmp-sp2-a (CBSE Class 8, free), qa-tmp-sp2-b (CBSE
 * Class 8, free), qa-tmp-sp2-g (CBSE Class 8, gets a campaign grant). The
 * grant for -g is LEFT IN PLACE (expires in 2 days) so the reminder-cron check
 * can run afterwards; cleanup clears it. Nothing here emails, pushes or
 * messages a real student: every send targets a throwaway with no email/push.
 * Two tiny real AI calls (gpt-4o-mini, max_tokens 5) prove the permit path.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY, FN = `${URL_}/functions/v1`;
const fb = getAuth();

async function mint(uid) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await fb.createCustomToken(uid), returnSecureToken: true }) });
  const d = await r.json(); if (!r.ok) throw new Error(`mint ${uid}`); return d.idToken;
}
const parse = async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } };
async function rest(method, path, { token, body, prefer, headers = {} } = {}) {
  const h = { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json', ...headers };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await parse(r), range: r.headers.get('content-range') };
}
const rpc = (fn, args, token) => rest('POST', `rpc/${fn}`, { token, body: args });
async function edge(fn, { token, body, method = 'POST', query = '', rawBody } = {}) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` };
  if (token) h['x-firebase-id-token'] = token;
  const r = await fetch(`${FN}/${fn}${query}`, { method, headers: h, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, ct, body: ct.includes('pdf') ? `<pdf ${(await r.arrayBuffer()).byteLength} bytes>` : await parse(r) };
}

const results = [];
function check(part, id, half, desc, ok, evidence) {
  results.push({ part, id, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${part}/${half}] ${id}  ${desc}\n       ${evidence}`);
}
const ev = (r) => `HTTP ${r.status} ${typeof r.body === 'object' && r.body ? JSON.stringify(r.body).slice(0, 150) : String(r.body).slice(0, 150)}`;
const pgErr = (r, code, part) => r.status >= 400 && r.body?.code === code && (!part || String(r.body?.message).includes(part));

// ── accounts ──────────────────────────────────────────────────────────────
const A = { uid: 'qa-tmp-sp2-a' }, B = { uid: 'qa-tmp-sp2-b' }, G = { uid: 'qa-tmp-sp2-g' };
for (const s of [A, B, G]) {
  s.tok = await mint(s.uid);
  await rpc('upsert_own_user', { p_uid: s.uid, p_fields: { auth_method: 'phone', onboarding_completed: true, target_exam: 'NONE', syllabus: 'CBSE', class_level: '8' } }, s.tok);
}
const admin = await fb.getUserByEmail('info@acenzos.com');
const tAdmin = await mint(admin.uid);

// ═══════════════════════════ PART A — edge functions ═══════════════════════
{
  let r = await edge('send-email', { body: { caller_uid: A.uid, user_id: A.uid, template: 'welcome' } });
  check('A', 'A1', 'DENY', 'send-email: the OLD attack (body caller_uid, no token)', r.status === 401, ev(r));
  r = await edge('send-email', { token: A.tok, body: { user_id: A.uid, template: 'welcome' } });
  check('A', 'A2', 'PERMIT', 'send-email: student self-send welcome passes authorization', r.status === 200 && r.body?.reason === 'no_email_on_file', ev(r));
  r = await edge('send-email', { token: A.tok, body: { user_id: B.uid, template: 'welcome' } });
  check('A', 'A3', 'DENY', 'send-email: student emails ANOTHER student', r.status === 403, ev(r));
  r = await edge('send-email', { token: A.tok, body: { user_id: A.uid, template: 'subscription_receipt', data: { totalAmount: 'INR 1' } } });
  check('A', 'A4', 'DENY', 'send-email: student sends a payment receipt (server-only now)', r.status === 403, ev(r));
  r = await edge('send-email', { token: A.tok, body: { broadcast: true, template: 'admin_broadcast', data: { title: 'x', body: 'x' } } });
  check('A', 'A5', 'DENY', 'send-email: student broadcast to everyone (refused before any send)', r.status === 403, ev(r));
  r = await edge('send-email', { token: tAdmin, body: { user_id: A.uid, template: 'admin_broadcast', data: { title: 'QA', body: 'QA' } } });
  check('A', 'A6', 'PERMIT', 'send-email: verified admin → one student (throwaway, no email)', r.status === 200 && r.body?.reason === 'no_email_on_file', ev(r));

  r = await edge('send-push', { body: { caller_uid: A.uid, user_id: A.uid, title: 'x', body: 'x' } });
  check('A', 'A7', 'DENY', 'send-push: no token (old body-caller_uid attack)', r.status === 401, ev(r));
  r = await edge('send-push', { token: A.tok, body: { user_id: B.uid, title: 'x', body: 'x' } });
  check('A', 'A8', 'DENY', 'send-push: student pushes to ANOTHER student', r.status === 403, ev(r));
  r = await edge('send-push', { token: A.tok, body: { user_id: A.uid, title: 'x', body: 'x' } });
  check('A', 'A9', 'PERMIT', 'send-push: student self-notify passes authorization (then hits the known VAPID gap)',
    r.status === 500 && String(r.body?.error).startsWith('VAPID keys not found'), ev(r));

  const w1 = await edge('whatsapp-alert', { body: { to: '+10000000000', message: 'x' } });
  const w2 = await edge('whatsapp-alert', { token: tAdmin, body: { broadcast: true, message: 'x' } });
  check('A', 'A10', 'DISABLED', 'whatsapp-alert returns "disabled" (410) for anyone, even an admin',
    w1.status === 410 && w1.body?.disabled === true && w2.status === 410 && w2.body?.disabled === true, `anon: ${ev(w1)} | admin: ${ev(w2)}`);

  r = await edge('pdf-proxy', { query: '?filename=x.pdf', rawBody: '%PDF-1.4 x' });
  check('A', 'A11', 'DENY', 'pdf-proxy upload with no token', r.status === 401, ev(r));
  r = await edge('pdf-proxy', { token: A.tok, query: '?filename=x.pdf', rawBody: '%PDF-1.4 x' });
  check('A', 'A12', 'DENY', 'pdf-proxy upload by a student (admin-only)', r.status === 403, ev(r));
  r = await edge('pdf-proxy', { token: tAdmin, query: '?filename=x.pdf', rawBody: 'not a pdf' });
  check('A', 'A13', 'PERMIT', 'pdf-proxy: admin passes authorization (non-PDF refused, nothing stored)', r.status === 422, ev(r));
  r = await edge('pdf-proxy', { token: A.tok, method: 'GET', query: `?url=${encodeURIComponent('http://127.0.0.1/x.pdf')}` });
  check('A', 'A14', 'DENY', 'pdf-proxy fetch of a private/non-https address', r.status === 400, ev(r));
  r = await edge('pdf-proxy', { method: 'GET', query: `?url=${encodeURIComponent('https://pdfobject.com/pdf/sample.pdf')}` });
  check('A', 'A15', 'DENY', 'pdf-proxy fetch with no token', r.status === 401, ev(r));
  r = await edge('pdf-proxy', { token: A.tok, method: 'GET', query: `?url=${encodeURIComponent('https://pdfobject.com/pdf/sample.pdf')}` });
  check('A', 'A16', 'PERMIT', 'pdf-proxy: signed-in fetch of a public https PDF', r.status === 200 && r.ct.includes('pdf'), `HTTP ${r.status} ${r.body}`);

  r = await edge('exam-scraper', { token: A.tok, body: { url: 'https://example.com' } });
  check('A', 'A17', 'DENY', 'exam-scraper by a student', r.status === 403 && r.body?.reason === 'access_denied', ev(r));
  r = await edge('exam-scraper', { token: tAdmin, body: {} });
  check('A', 'A18', 'PERMIT', 'exam-scraper: admin passes authorization (no URL → nothing fetched, no GPT spend)', r.status === 400 && r.body?.reason === 'url_required', ev(r));

  r = await edge('connect-email', { body: { caller_uid: A.uid, email: 'x@example.com' } });
  check('A', 'A19', 'DENY', 'connect-email with a body caller_uid and no token', r.status === 401, ev(r));
  r = await edge('connect-email', { token: A.tok, body: { email: 'not-an-email' } });
  check('A', 'A20', 'PERMIT', 'connect-email: verified student passes authorization (invalid address → nothing sent)', r.status === 400 && r.body?.error === 'invalid_email', ev(r));
}

// ═══════════════════════════ PART B — ai-proxy + quota ══════════════════════
const tiny = (feature, extra = {}) => ({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], _feature: feature, ...extra });
{
  let r = await edge('ai-proxy', { body: tiny('flashcards') });
  check('B', 'B1', 'DENY', 'ai-proxy with NO token (was an open relay)', r.status === 401 && r.body?.code === 'unauthenticated', ev(r));
  r = await edge('ai-proxy', { token: A.tok, body: tiny('qa-made-up-feature') });
  check('B', 'B2', 'DENY', 'unknown feature', r.status === 400 && /Unknown AI feature/.test(r.body?.error), ev(r));
  r = await edge('ai-proxy', { token: A.tok, body: tiny('vision-page-extract') });
  check('B', 'B3', 'DENY', 'admin-only feature by a student', r.status === 403 && /admin-only/.test(r.body?.error), ev(r));
  r = await edge('ai-proxy', { token: A.tok, body: tiny('flashcards', { model: 'gpt-4-turbo' }) });
  check('B', 'B4', 'DENY', 'model not on the allowlist', r.status === 400 && /Model .* not allowed/.test(r.body?.error), ev(r));
  r = await edge('ai-proxy', { token: A.tok, query: '?route=images', body: { model: 'dall-e-3', prompt: 'x', _feature: 'flashcards' } });
  check('B', 'B5', 'DENY', 'image route (closed for every feature)', r.status === 400 && /Route images not allowed/.test(r.body?.error), ev(r));
  r = await edge('ai-proxy', { token: A.tok, body: tiny('flashcards') });
  check('B', 'B6', 'DENY', 'student with NO charged action', r.status === 403 && r.body?.code === 'no_active_quota', ev(r));

  const hid = await rpc('begin_ai_action', { p_uid: A.uid, p_bucket: 'ai_questions', p_amount: 1, p_exam_type: 'CBSE Class 8', p_subject: 'Hindi' }, A.tok);
  check('B', 'B7', 'DENY', 'begin an action for a hidden subject (Hindi, CBSE 8)', pgErr(hid, '22023', 'Subject not allowed for CBSE Class 8: Hindi'), ev(hid));

  const beg = await rpc('begin_ai_action', { p_uid: A.uid, p_bucket: 'ai_questions', p_amount: 1, p_exam_type: 'CBSE Class 8', p_subject: 'Science' }, A.tok);
  r = await edge('ai-proxy', { token: A.tok, body: tiny('flashcards') });
  check('B', 'B8', 'PERMIT', 'student with a charged action for an allowed subject → real AI call', beg.status === 200 && beg.body?.used === 1 && r.status === 200 && r.body?.choices?.length === 1,
    `begin used=${beg.body?.used}/${beg.body?.limit}; proxy HTTP ${r.status}`);

  // Over quota: free ai_questions = 20/day. A has used 1.
  const big = await rpc('begin_ai_action', { p_uid: A.uid, p_bucket: 'ai_questions', p_amount: 20 }, A.tok);
  check('B', 'B9', 'DENY', 'student asking for more than the rest of today\'s free quota (1 + 20 > 20)', pgErr(big, '54000', 'Daily limit reached for AI questions: used 1 of 20'), ev(big));
  const fill = await rpc('begin_ai_action', { p_uid: A.uid, p_bucket: 'ai_questions', p_amount: 19 }, A.tok);
  const over = await rpc('begin_ai_action', { p_uid: A.uid, p_bucket: 'ai_questions', p_amount: 1 }, A.tok);
  check('B', 'B10', 'DENY', 'student at 20/20 is refused the next one', fill.status === 200 && fill.body?.used === 20 && pgErr(over, '54000', 'used 20 of 20'), `fill ${fill.body?.used}/${fill.body?.limit}; next: ${ev(over)}`);
  const end = await rpc('end_ai_action', { p_uid: A.uid, p_action_id: fill.body?.action_id, p_actual: 0 }, A.tok);
  const after = await rpc('begin_ai_action', { p_uid: A.uid, p_bucket: 'ai_questions', p_amount: 1 }, A.tok);
  check('B', 'B11', 'PERMIT', 'a failed action is refunded (19 back), so the student can continue', end.body?.refunded === 19 && after.status === 200 && after.body?.used === 2, `refunded ${end.body?.refunded}; next begin used=${after.body?.used}`);

  // Campaign grant (the existing quota_overrides mechanism) raises the cap.
  const grant = await rpc('admin_set_quota_override', {
    p_caller: admin.uid, p_user_id: G.uid, p_ai_questions: 100, p_veda_messages: null, p_mock_tests: null,
    p_paper_evaluations: null, p_podcasts: null, p_paper_generations: null,
    p_expires_at: new Date(Date.now() + 2 * 86400000).toISOString(), p_reason: 'QA security pass 2 verification',
  }, tAdmin);
  const g50 = await rpc('begin_ai_action', { p_uid: G.uid, p_bucket: 'ai_questions', p_amount: 50 }, G.tok);
  const a50 = await rpc('begin_ai_action', { p_uid: B.uid, p_bucket: 'ai_questions', p_amount: 50 }, B.tok);
  check('B', 'B12', 'PERMIT', 'campaign grant still works: 50 AI questions allowed with a 100 grant (free cap is 20)',
    grant.status < 300 && g50.status === 200 && g50.body?.limit === 100 && pgErr(a50, '54000', 'of 20'), `grant ${grant.status}; granted student ${g50.body?.used}/${g50.body?.limit}; ungranted: ${a50.body?.message}`);

  const adm = await rpc('begin_ai_action', { p_uid: admin.uid, p_bucket: 'ai_questions', p_amount: 500 }, tAdmin);
  r = await edge('ai-proxy', { token: tAdmin, body: tiny('manifest-draft') });
  check('B', 'B13', 'PERMIT', 'admin is exempt: no charge, and an admin feature works', adm.body?.exempt === true && r.status === 200, `begin exempt=${adm.body?.exempt}; proxy HTTP ${r.status}`);

  const log = await rest('GET', `ai_call_log?select=caller_uid&feature=eq.flashcards&order=created_at.desc&limit=1`, { token: tAdmin });
  void log; // ai_call_log is RPC-only; checked separately via SQL after the run

  // Daily Mini Test: one per day
  const p1 = await rpc('pick_daily_challenge_subject', { p_uid: A.uid }, A.tok);
  const s1 = await rpc('save_daily_challenge', { p_uid: A.uid, p_exam_type: p1.body?.exam_type, p_subject: p1.body?.subject, p_chapter: 'QA', p_questions: [{ q: 'QA', answer: 'A', opts: ['A. 1', 'B. 2'] }] }, A.tok);
  const p2 = await rpc('pick_daily_challenge_subject', { p_uid: A.uid }, A.tok);
  const s2 = await rpc('save_daily_challenge', { p_uid: A.uid, p_exam_type: p1.body?.exam_type, p_subject: p1.body?.subject, p_chapter: 'QA2', p_questions: [{ q: 'QA', answer: 'A' }] }, A.tok);
  check('B', 'B14', 'DENY', 'Daily Mini Test: after today\'s test, pick says done_today and a second save is refused',
    p1.body?.status === 'ok' && s1.status === 200 && p2.body?.status === 'done_today' && pgErr(s2, '54000', 'already exists'),
    `first pick ${p1.body?.status}, save ${s1.status}; second pick ${p2.body?.status}; second save ${s2.body?.code}`);

  const uq = await rpc('upsert_usage_quota', { p_uid: B.uid, p_date: '2026-09-25', p_field: 'ai_questions_used', p_amount: 5 }, A.tok);
  const neg = await rpc('upsert_usage_quota', { p_uid: A.uid, p_date: '2026-09-25', p_field: 'ai_questions_used', p_amount: -100 }, A.tok);
  check('B', 'B15', 'DENY', 'old quota RPC holes: burn another student\'s quota / negative reset',
    pgErr(uq, '42501', 'caller mismatch') && pgErr(neg, '22023', 'Invalid amount'), `other: ${ev(uq)} | negative: ${ev(neg)}`);
}

// ═══════════════════════════ PART C — tables ═══════════════════════════════
{
  const xp = await rpc('award_xp_atomic', { p_user_id: A.uid, p_amount: 20 }, A.tok);
  const inc = await rpc('increment_field', { p_user_id: A.uid, p_field: 'total_tests_taken' }, A.tok);
  const g = await rest('GET', `user_gamification?select=xp,streak_days,total_tests_taken&user_id=eq.${A.uid}`, { token: A.tok });
  check('C', 'C1', 'PERMIT', 'XP + streak + activity counter now SAVE (were refused before)',
    xp.status === 200 && inc.status < 300 && g.body?.[0]?.xp === 20 && g.body?.[0]?.streak_days === 1 && g.body?.[0]?.total_tests_taken === 1,
    `award ${xp.status}; increment ${inc.status}; row ${JSON.stringify(g.body)}`);
  const cheat = await rpc('increment_field', { p_user_id: A.uid, p_field: 'xp' }, A.tok);
  const other = await rpc('award_xp_atomic', { p_user_id: B.uid, p_amount: 500 }, A.tok);
  check('C', 'C2', 'DENY', 'XP cheats: increment_field on xp / award XP to another student',
    pgErr(cheat, '22023', 'Field not allowed: xp') && pgErr(other, '42501', 'caller mismatch'), `xp field: ${ev(cheat)} | other: ${ev(other)}`);

  const ts = await rest('POST', 'test_sessions', { token: A.tok, prefer: 'return=representation', body: { firebase_uid: A.uid, test_name: 'QA mock', score: 6, total_marks: 8, correct: 2, wrong: 0, skipped: 0, question_count: 2, time_taken_seconds: 60, subject_breakdown: {}, exam_type: 'NONE' } });
  const mine = await rest('GET', `test_sessions?select=test_name,score&firebase_uid=eq.${A.uid}`, { token: A.tok });
  check('C', 'C3', 'PERMIT', 'mock-test result now SAVES and reads back for its owner', ts.status === 201 && mine.body?.length === 1 && mine.body[0].score === 6, `insert ${ts.status}; read ${JSON.stringify(mine.body)}`);
  const forged = await rest('POST', 'test_sessions', { token: A.tok, prefer: 'return=minimal', body: { firebase_uid: B.uid, test_name: 'x' } });
  const peek = await rest('GET', `test_sessions?select=score&firebase_uid=eq.${A.uid}`, { token: B.tok });
  check('C', 'C4', 'DENY', 'save a result as another student / read another student\'s results',
    pgErr(forged, '42501') && Array.isArray(peek.body) && peek.body.length === 0, `forge: ${ev(forged)} | peek rows: ${peek.body?.length}`);

  const kbAnon = await rest('GET', 'knowledge_base?select=id&limit=1', { headers: { Prefer: 'count=exact', Range: '0-0' } });
  const kbUser = await rest('GET', 'knowledge_base?select=id&limit=1', { token: A.tok, headers: { Prefer: 'count=exact', Range: '0-0' } });
  check('C', 'C5', 'BOTH', 'knowledge_base: anon sees nothing, a signed-in student still can (retrieval works)',
    kbAnon.range?.endsWith('/0') && Number(kbUser.range?.split('/')[1]) > 7000, `anon ${kbAnon.range} | signed-in ${kbUser.range}`);

  const ab = await rest('GET', 'chapter_manifests?select=approved_by&limit=1');
  const ok1 = await rest('GET', 'chapter_manifests?select=id,status&limit=1');
  const ub = await rest('GET', 'platform_settings?select=updated_by&limit=1');
  const ok2 = await rest('GET', 'platform_settings?select=key,value&limit=1');
  check('C', 'C6', 'BOTH', 'admin uids hidden (approved_by / updated_by) while normal public reads still work',
    pgErr(ab, '42501') && pgErr(ub, '42501') && ok1.status === 200 && ok2.status === 200, `approved_by: ${ev(ab)} | updated_by: ${ab.status === ub.status ? 'same' : ev(ub)} | normal reads ${ok1.status}/${ok2.status}`);

  const cl = await rest('POST', 'changelog', { token: A.tok, prefer: 'return=minimal', body: { entity_type: 'system', entity_id: 'x', action: 'update', actor_uid: admin.uid, actor_role: 'superadmin' } });
  const lc = await rpc('log_change', { p_entity_type: 'system', p_entity_id: 'qa-sp2-verify', p_action: 'update', p_note: 'QA security pass 2 verification' }, A.tok);
  check('C', 'C7', 'BOTH', 'changelog: forged direct insert refused; log_change works (actor from the token)', pgErr(cl, '42501') && lc.status === 200 && typeof lc.body === 'string', `forge: ${ev(cl)} | log_change ${lc.status}`);

  const qaDirect = await rest('POST', 'important_qa', { token: A.tok, prefer: 'return=minimal', body: { exam_type: 'CBSE Class 8', subject: 'Science', chapter: 'QA', questions: [] } });
  const qaOk = await rpc('save_important_qa', { p_exam_type: 'CBSE Class 8', p_subject: 'Science', p_chapter: 'QA sp2 verify', p_questions: [{ q: 'x' }] }, A.tok);
  const qaNo = await rpc('save_important_qa', { p_exam_type: 'CBSE Class 8', p_subject: 'Mathematics', p_chapter: 'QA sp2 verify', p_questions: [{ q: 'x' }] }, A.tok);
  check('C', 'C8', 'BOTH', 'shared Q&A cache: direct write refused; RPC allowed only with a recent charged action for that subject',
    pgErr(qaDirect, '42501') && qaOk.status < 300 && pgErr(qaNo, '42501', 'No recent generation'), `direct: ${ev(qaDirect)} | Science(has action) ${qaOk.status} | Mathematics(no action): ${qaNo.body?.message}`);

  const mis = await rpc('upsert_misconception', { p_user_id: B.uid, p_exam_type: 'x', p_subject: 'x', p_chapter: 'x', p_question_id: 'x', p_distractor: 'x', p_correct: 'x' }, A.tok);
  check('C', 'C9', 'DENY', 'write a misconception for another student (was unchecked)', pgErr(mis, '42501', 'caller mismatch'), ev(mis));

  const nulls = {
    important_qa: { exam_type: null }, topic_frequency: { exam_type: null }, question_cache: { cache_key: null },
    monitored_sources: { name: null }, question_papers: { subject: null }, crawl_jobs: { id: null }, crawl_pdfs: { id: null },
    concept_misconceptions: { user_id: null }, content_versions: { id: null }, user_chapter_progress: { user_id: null },
    user_daily_tasks: { user_id: null }, study_goals: { firebase_uid: null }, daily_usage_quota: { user_id: null },
  };
  const bad = [];
  for (const [t, body] of Object.entries(nulls)) {
    const r = await rest('POST', t, { prefer: 'return=minimal', body });
    if (!pgErr(r, '42501')) bad.push(`${t}: ${ev(r)}`);
  }
  check('C', 'C10', 'DENY', `anon INSERT refused on all ${Object.keys(nulls).length} previously-open tables (42501, not the old 23502)`, bad.length === 0, bad.join(' | ') || 'all 42501');

  const own = await rest('POST', 'user_daily_tasks', { token: A.tok, prefer: 'return=minimal', body: { user_id: A.uid, task_date: '2026-09-25', subject: 'Science', topic: 'QA', duration_min: 10, task_type: 'study', source: 'manual' } });
  const notOwn = await rest('POST', 'user_daily_tasks', { token: A.tok, prefer: 'return=minimal', body: { user_id: B.uid, task_date: '2026-09-25', subject: 'Science', topic: 'QA', duration_min: 10, task_type: 'study', source: 'manual' } });
  check('C', 'C11', 'BOTH', 'personal tables: own row allowed, someone else\'s refused (daily tasks)', own.status === 201 && pgErr(notOwn, '42501'), `own ${own.status} | other: ${ev(notOwn)}`);
}

for (const p of ['A', 'B', 'C']) {
  const rs = results.filter((r) => r.part === p);
  console.log(`\n=== Part ${p}: ${rs.filter((r) => r.ok).length} passed, ${rs.filter((r) => !r.ok).length} failed`);
}
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
