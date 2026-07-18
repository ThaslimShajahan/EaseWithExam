import { createClient } from '@supabase/supabase-js';
import { logChange, ENTITY, ACTION } from './changelog';
import { embedText } from './aiProxy';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnon);

/* ── Users ──────────────────────────────────────────────── */

export async function getUser(firebaseUid) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function upsertUser(firebaseUid, fields) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ firebase_uid: firebaseUid, ...fields }, { onConflict: 'firebase_uid' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateUser(firebaseUid, fields) {
  const { data, error } = await supabase
    .from('users')
    .update(fields)
    .eq('firebase_uid', firebaseUid)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Used to detect an existing account by phone number before creating a new one —
// Firebase treats phone and Google sign-in as separate identities (different uids)
// unless explicitly linked, so this is the app-level de-duplication check.
export async function getUserByPhone(phoneNumber) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* ── Test sessions ──────────────────────────────────────── */

export async function saveTestSession(firebaseUid, session) {
  const { data, error } = await supabase
    .from('test_sessions')
    .insert({ firebase_uid: firebaseUid, ...session })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTestSessions(firebaseUid, limit = 10) {
  const { data, error } = await supabase
    .from('test_sessions')
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/* Returns the first attempt record for a specific published test, or null */
export async function getTestAttempt(firebaseUid, testId) {
  if (!firebaseUid || !testId) return null;
  const { data } = await supabase
    .from('test_sessions')
    .select('id, score, total_marks, created_at, correct, wrong')
    .eq('firebase_uid', firebaseUid)
    .eq('test_id', testId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/* Returns a map of { testId → attempt } for the student — used by ExamCenter */
export async function getCompletedTestIds(firebaseUid) {
  if (!firebaseUid) return {};
  const { data } = await supabase
    .from('test_sessions')
    .select('test_id, score, total_marks, created_at')
    .eq('firebase_uid', firebaseUid)
    .not('test_id', 'is', null)
    .order('created_at', { ascending: false });
  return (data ?? []).reduce((acc, s) => {
    if (!acc[s.test_id]) acc[s.test_id] = s; // most recent first — keep first occurrence
    return acc;
  }, {});
}

/* ── Doubt chats ────────────────────────────────────────── */

export async function createDoubtChat(firebaseUid) {
  const { data, error } = await supabase
    .from('doubt_chats')
    .insert({ firebase_uid: firebaseUid })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveDoubtMessage(chatId, role, content) {
  const { data, error } = await supabase
    .from('doubt_messages')
    .insert({ chat_id: chatId, role, content })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getDoubtHistory(firebaseUid, limit = 20) {
  const { data, error } = await supabase
    .from('doubt_chats')
    .select('*, doubt_messages(*)')
    .eq('firebase_uid', firebaseUid)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/* ── Knowledge base (RAG) ───────────────────────────────── */

/**
 * Search knowledge base by keywords — returns top 3 relevant chunks.
 * Used by Veda before answering to inject context.
 */
export async function searchKnowledgeBase(query, embedding = null) {
  try {
    // pgvector semantic search (preferred)
    if (embedding) {
      const { data } = await supabase.rpc('match_knowledge_base', {
        query_embedding: embedding,
        match_count:     5,
        filter_subject:  null,
      });
      if (data?.length) return data;
    }

    // keyword fallback
    const keywords = query.split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
    if (!keywords.length) return [];
    const orFilter = keywords.map((k) => `content.ilike.%${k}%`).join(',');
    const { data } = await supabase
      .from('knowledge_base')
      .select('content, subject')
      .or(orFilter)
      .limit(5);
    return data ?? [];
  } catch {
    return [];
  }
}

/* ── Subscriptions ──────────────────────────────────────── */

export async function getSubscription(firebaseUid) {
  if (!firebaseUid) return null;
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, expires_at, starts_at')
    .eq('user_id', firebaseUid)
    .maybeSingle();
  if (!data) return null;
  const isActive = data.status === 'active' &&
    (!data.expires_at || new Date(data.expires_at) > new Date());
  return { ...data, isActive };
}

export async function adminGetAllSubscriptions() {
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id, plan, status, expires_at, amount_paid, starts_at');
  return (data ?? []).map((sub) => ({
    ...sub,
    isActive: sub.status === 'active' && (!sub.expires_at || new Date(sub.expires_at) > new Date()),
  }));
}

/* ── Admin helpers ──────────────────────────────────────── */

export async function adminGetAllUsers() {
  const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
  return data ?? [];
}

export async function adminGrantPremium(firebaseUid, plan = 'premium_yearly') {
  const expiryDays = plan === 'neet_complete' ? 365 : plan === 'premium_yearly' ? 365 : 30;
  const expires_at = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id:    firebaseUid,
      plan,
      status:     'active',
      starts_at:  new Date().toISOString(),
      expires_at,
      amount_paid: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;
  logChange(ENTITY.PLAN_CONFIG, firebaseUid, ACTION.UPDATE,
    { after: { plan, expires_at } }, 'Admin granted premium subscription');
}

export async function adminGetAllTestSessions() {
  const { data } = await supabase.from('test_sessions').select('*').order('created_at', { ascending: false });
  return data ?? [];
}

export async function adminGetDoubtChats() {
  const { data } = await supabase.from('doubt_chats').select('*').order('created_at', { ascending: false });
  return data ?? [];
}

export async function adminGetDoubtMessages(chatIds) {
  if (!chatIds?.length) return {};
  const { data } = await supabase
    .from('doubt_messages')
    .select('*')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: true });

  const map = {};
  (data ?? []).forEach((m) => {
    if (!map[m.chat_id]) map[m.chat_id] = [];
    map[m.chat_id].push(m);
  });
  return map;
}

export async function adminGetPapers() {
  const { data } = await supabase.from('question_papers').select('*').order('created_at', { ascending: false });
  return data ?? [];
}

export async function adminSavePaper(paper) {
  const { data } = await supabase.from('question_papers').insert(paper).select().single();
  return data;
}

/* Embed rows in batches of 20, one retry per item on failure.
   Returns { rows: rows-with-embeddings-where-possible, failedCount }. */
async function _addEmbeddings(rows) {
  const BATCH = 20;
  const out = rows.map((r) => ({ ...r }));
  let failedCount = 0;

  for (let i = 0; i < out.length; i += BATCH) {
    const end = Math.min(i + BATCH, out.length);
    await Promise.all(
      out.slice(i, end).map(async (row, j) => {
        let emb = await embedText(row.content);
        if (!emb) {
          await new Promise((r) => setTimeout(r, 1000));
          emb = await embedText(row.content);
        }
        if (emb) {
          out[i + j].embedding = emb;
        } else {
          failedCount++;
        }
      }),
    );
  }
  return { rows: out, failedCount };
}

export async function adminSaveKnowledgeChunks(chunks) {
  if (!chunks?.length) return;

  const { rows, failedCount } = await _addEmbeddings(chunks);

  if (failedCount > 0) {
    logChange(ENTITY.CONTENT_ITEM, 'bulk', ACTION.EMBED_FAILED,
      { total: chunks.length, failed: failedCount },
      `${failedCount} KB chunk(s) inserted without embeddings — embed API unavailable`);
  }

  const { data, error } = await supabase.from('knowledge_base').insert(rows).select('id');
  if (error) throw new Error(error.message);
  logChange(ENTITY.CONTENT_ITEM, 'bulk', ACTION.CREATE,
    {
      count:     chunks.length,
      embedded:  chunks.length - failedCount,
      subjects:  [...new Set(chunks.map((c) => c.subject))],
    },
    `Bulk-inserted ${chunks.length} KB chunks (${chunks.length - failedCount} with embeddings)`);
  return data;
}

export async function adminGetKBCount() {
  const { count } = await supabase.from('knowledge_base').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

export async function adminDeletePapers(ids) {
  if (!ids?.length) return;
  // Get storage paths before deleting
  const { data: rows } = await supabase
    .from('question_papers')
    .select('storage_path')
    .in('id', ids);

  // Delete DB records (cascades to knowledge_base)
  await supabase.from('question_papers').delete().in('id', ids);

  // Best-effort storage cleanup (may fail silently if RLS blocks it)
  const paths = (rows ?? []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length) {
    await supabase.storage.from('question-papers').remove(paths).catch(() => {});
  }
  logChange(ENTITY.CONTENT_ITEM, 'bulk', ACTION.BULK_DELETE,
    { ids }, `Deleted ${ids.length} question paper(s)`);
}

export async function adminDeleteAllPapers() {
  const { data: rows } = await supabase.from('question_papers').select('storage_path');
  await supabase.from('question_papers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const paths = (rows ?? []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length) {
    await supabase.storage.from('question-papers').remove(paths).catch(() => {});
  }
  logChange(ENTITY.CONTENT_ITEM, 'all', ACTION.BULK_DELETE,
    { count: (rows ?? []).length }, 'Admin deleted ALL question papers');
}

/* Clear ALL generated/uploaded content so a fresh upload can be made.
 * Deliberately leaves syllabus_nodes untouched — that's chapter structure,
 * not content, and losing it would mean rebuilding the syllabus from scratch.
 *
 * exam_blueprints has RLS that silently blocks anon-key deletes (the request
 * "succeeds" but affects 0 rows) — confirmed live, 6 rows survived a full
 * run of this function. Cleared via a SECURITY DEFINER RPC instead
 * (sql/0027_admin_clear_blueprints.sql), which is why this now needs a caller uid. */
export async function adminClearAllData(callerUid) {
  const DUMMY = '00000000-0000-0000-0000-000000000000';
  await Promise.allSettled([
    supabase.from('knowledge_base').delete().neq('id', DUMMY),
    supabase.from('question_cache').delete().neq('id', DUMMY),
    supabase.from('pyq_questions').delete().neq('id', DUMMY),
    supabase.from('published_tests').delete().neq('id', DUMMY),
    supabase.from('topic_frequency').delete().neq('exam_type', '__never__'),
    supabase.from('question_papers').delete().neq('id', DUMMY),
    supabase.from('study_notes').delete().neq('id', DUMMY),
    supabase.rpc('admin_clear_exam_blueprints', { p_caller: callerUid }),
  ]);
  logChange(ENTITY.SYSTEM, 'platform', ACTION.BULK_DELETE,
    { tables: ['knowledge_base', 'question_cache', 'pyq_questions', 'published_tests', 'topic_frequency', 'question_papers', 'study_notes', 'exam_blueprints'] },
    'Admin cleared ALL platform content (syllabus structure kept)');
}

/* ── Published tests ────────────────────────────────────── */

export async function publishTest({ title, subject, examType, difficulty, questions, durationMinutes, blueprintMatchPct }) {
  const insertRow = {
    title, subject, exam_type: examType, difficulty, questions,
    duration_minutes: durationMinutes, is_published: true,
    question_count: Array.isArray(questions) ? questions.length : 0,
  };
  if (blueprintMatchPct !== undefined) insertRow.blueprint_match_pct = blueprintMatchPct;

  const { data, error } = await supabase
    .from('published_tests')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw new Error(error.message);
  logChange(ENTITY.PUBLISHED_TEST, data.id, ACTION.PUBLISH,
    { title, subject, examType, difficulty, questionCount: Array.isArray(questions) ? questions.length : 0, blueprintMatchPct },
    'Admin published AI-generated test');
  return data;
}

/* Publish raw PYQ questions as a test (no AI generation needed) */
export async function publishPYQPaper({ title, examType, subject, durationMinutes, pyqRows }) {
  const batchId = Date.now().toString(36);
  const LETTER_IDX = { A: 0, B: 1, C: 2, D: 3 };
  const DESCRIPTIVE = new Set(['Short Answer', 'Long Answer']);

  const questions = pyqRows.map((q, i) => {
    const type       = q.question_type || 'MCQ';
    const marksVal   = q.marks ?? (type === 'MCQ' ? 1 : 2);
    const isNum      = type === 'Numerical';
    const isDescr    = DESCRIPTIVE.has(type);
    return {
      id:             `${batchId}-${String(i + 1).padStart(4, '0')}`,
      type,
      subject:        q.subject || subject,
      chapter:        q.chapter || null,
      section:        q.section || null,
      question:       q.question_text,
      options:        isNum || isDescr ? null : (q.options || []).map((o) => String(o).replace(/^[A-D]\.\s*/, '')),
      correctOption:  isNum || isDescr ? null : (LETTER_IDX[String(q.correct_answer ?? '').toUpperCase().charAt(0)] ?? 0),
      correctAnswer:  isNum ? String(q.correct_answer ?? '') : null,
      explanation:    q.explanation || '',
      marks:          marksVal,
      year:           q.year || null,
      image_url:      q.image_url || null,
    };
  });

  const totalMarks    = pyqRows.reduce((s, q) => s + (q.marks ?? 1), 0);
  const difficultyTag = 'Mixed';

  const { data, error } = await supabase
    .from('published_tests')
    .insert({
      title,
      subject,
      exam_type:        examType,
      difficulty:       difficultyTag,
      questions,
      duration_minutes: durationMinutes,
      is_published:     true,
      question_count:   questions.length,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  logChange(ENTITY.PUBLISHED_TEST, data.id, ACTION.PUBLISH,
    { title, examType, subject, durationMinutes, questionCount: questions.length, totalMarks },
    'Admin published PYQ paper as test');
  return data;
}

export async function getPublishedTests() {
  const { data } = await supabase
    .from('published_tests')
    .select('id, title, subject, exam_type, difficulty, duration_minutes, question_count, created_at, is_published')
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getPublishedTest(id) {
  const { data } = await supabase
    .from('published_tests')
    .select('*')
    .eq('id', id)
    .single();
  return data;
}

export async function deletePublishedTest(id) {
  await supabase.from('published_tests').delete().eq('id', id);
  logChange(ENTITY.PUBLISHED_TEST, id, ACTION.DELETE_REQUEST, null, 'Admin deleted published test');
}

/* ── Crawl job persistence ──────────────────────────────── */

export async function adminCreateCrawlJob(url) {
  const { data } = await supabase
    .from('crawl_jobs')
    .insert({ url, status: 'running' })
    .select()
    .single();
  return data;
}

export async function adminUpdateCrawlJob(id, fields) {
  await supabase.from('crawl_jobs').update(fields).eq('id', id);
}

export async function adminBulkInsertCrawlPdfs(jobId, pdfs) {
  // pdfs: [{ source_url, filename, status, skip_reason }]
  if (!pdfs.length) return [];
  const { data } = await supabase
    .from('crawl_pdfs')
    .insert(pdfs.map((p) => ({ job_id: jobId, ...p })))
    .select();
  return data ?? [];
}

export async function adminUpdateCrawlPdf(id, fields) {
  await supabase.from('crawl_pdfs').update(fields).eq('id', id);
}

export async function adminGetLatestCrawlJob() {
  const { data } = await supabase
    .from('crawl_jobs')
    .select('*, crawl_pdfs(*)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/* ── Exam notifications ─────────────────────────────────── */

export async function getExamNotifications({ category = null, limit = 50 } = {}) {
  try {
    let q = supabase
      .from('exam_notifications')
      .select('*')
      .eq('is_active', true)
      .order('scraped_at', { ascending: false })
      .limit(limit);
    if (category) q = q.eq('category', category);
    const { data } = await q;
    return data ?? [];
  } catch { return []; }
}

export async function getMonitoredSources() {
  try {
    const { data } = await supabase
      .from('monitored_sources')
      .select('*')
      .order('created_at', { ascending: false });
    return data ?? [];
  } catch { return []; }
}

export async function addMonitoredSource({ name, url, examCategory }) {
  const { data, error } = await supabase
    .from('monitored_sources')
    .insert({ name, url, exam_category: examCategory })
    .select()
    .single();
  if (error) throw new Error(error.message);
  logChange(ENTITY.SYSTEM, data.id, ACTION.CREATE,
    { name, url, examCategory }, 'Monitored source added');
  return data;
}

export async function deleteMonitoredSource(id) {
  await supabase.from('monitored_sources').delete().eq('id', id);
  logChange(ENTITY.SYSTEM, id, ACTION.BULK_DELETE,
    null, 'Monitored source removed');
}

export async function deactivateExamNotification(id) {
  await supabase.from('exam_notifications').update({ is_active: false }).eq('id', id);
  logChange(ENTITY.SYSTEM, id, ACTION.ARCHIVE,
    { after: { is_active: false } }, 'Exam notification deactivated');
}

export async function clearExamNotifications() {
  await supabase.from('exam_notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  logChange(ENTITY.SYSTEM, 'exam_notifications', ACTION.BULK_DELETE,
    null, 'All exam notifications cleared');
}

/* ── PYQ question bank ──────────────────────────────────── */

export async function getPYQQuestions({ subject, examType, chapter, limit = 20, status = null } = {}) {
  try {
    let q = supabase
      .from('pyq_questions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (subject && subject !== 'Mixed') q = q.eq('subject', subject);
    if (examType) q = q.eq('exam_type', examType);
    if (chapter?.trim()) q = q.ilike('chapter', `%${chapter}%`);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    return data ?? [];
  } catch { return []; }
}

export async function getPYQCount() {
  try {
    const { count } = await supabase
      .from('pyq_questions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');
    return count ?? 0;
  } catch { return 0; }
}

export async function clearPYQQuestions() {
  try {
    await supabase.from('pyq_questions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  } catch {}
}

/* ── Topic frequency (PYQ analysis) ────────────────────── */

export async function getKBTopics(subject) {
  let q = supabase.from('knowledge_base').select('content, subject, tags').limit(60);
  if (subject && subject !== 'Mixed') q = q.eq('subject', subject);
  const { data } = await q;
  return data ?? [];
}

export async function upsertTopicFrequency(rows) {
  if (!rows?.length) return;
  await supabase.from('topic_frequency').upsert(rows, { onConflict: 'exam_type,subject,topic' });
}

export async function getTopicFrequency(subject, examType) {
  try {
    let q = supabase.from('topic_frequency').select('*').order('frequency', { ascending: false }).limit(30);
    if (subject && subject !== 'Mixed') q = q.eq('subject', subject);
    if (examType) q = q.eq('exam_type', examType);
    const { data } = await q;
    return data ?? [];
  } catch { return []; }
}

/* ── Study goals ─────────────────────────────────────────── */

export async function saveStudyGoal(firebaseUid, goal) {
  const { data, error } = await supabase
    .from('study_goals')
    .upsert({ firebase_uid: firebaseUid, ...goal, updated_at: new Date().toISOString() },
             { onConflict: 'firebase_uid' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getStudyGoal(firebaseUid) {
  const { data } = await supabase
    .from('study_goals')
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();
  return data;
}

/* ── KB stats (admin) ────────────────────────────────────── */

export async function getKBStats() {
  const { data } = await supabase
    .from('knowledge_base')
    .select('subject, created_at');
  const bySubject = {};
  (data ?? []).forEach((r) => {
    bySubject[r.subject || 'Unknown'] = (bySubject[r.subject || 'Unknown'] || 0) + 1;
  });
  return { total: (data ?? []).length, bySubject };
}

export async function getPublishedTestsCount() {
  const { count } = await supabase
    .from('published_tests')
    .select('*', { count: 'exact', head: true });
  return count ?? 0;
}

export async function adminGetTestSessionsStats() {
  const { data } = await supabase
    .from('test_sessions')
    .select('firebase_uid, score, total_marks, test_name, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  return data ?? [];
}
