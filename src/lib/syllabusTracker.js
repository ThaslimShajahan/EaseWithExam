import { supabase } from './supabase';

/* ── Fetch all chapter progress for a user+exam ─────────────── */
export async function getChapterProgress(firebaseUid, examType) {
  const { data, error } = await supabase
    .from('user_chapter_progress')
    .select('*')
    .eq('user_id', firebaseUid)
    .eq('exam_type', examType);
  if (error) throw error;
  return data ?? [];
}

/* ── Upsert a single chapter's status ─────────────────────────── */
export async function upsertChapter(firebaseUid, examType, chapter, status, confidence = 0) {
  const completed_at = status === 'done' ? new Date().toISOString() : null;
  const { error } = await supabase
    .from('user_chapter_progress')
    .upsert({
      user_id:      firebaseUid,
      exam_type:    examType,
      subject:      chapter.subject,
      chapter_key:  chapter.key,
      chapter_name: chapter.name,
      class_level:  chapter.class,
      status,
      confidence,
      completed_at,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id,exam_type,chapter_key' });
  if (error) throw error;
}

/* ── Bulk init — create "not_started" rows for all chapters ──── */
export async function initChapterProgress(firebaseUid, examType, allChapters) {
  const rows = allChapters.map((ch) => ({
    user_id:      firebaseUid,
    exam_type:    examType,
    subject:      ch.subject,
    chapter_key:  ch.key,
    chapter_name: ch.name,
    class_level:  ch.class,
    status:       'not_started',
  }));
  // Insert only rows that don't already exist
  const { error } = await supabase
    .from('user_chapter_progress')
    .upsert(rows, { onConflict: 'user_id,exam_type,chapter_key', ignoreDuplicates: true });
  if (error) throw error;
}

/* ── Progress summary ────────────────────────────────────────── */
export function computeProgress(chapters, progressMap) {
  const total    = chapters.length;
  const done     = chapters.filter(c => progressMap[c.key]?.status === 'done').length;
  const reading  = chapters.filter(c => progressMap[c.key]?.status === 'reading').length;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, reading, pct };
}
