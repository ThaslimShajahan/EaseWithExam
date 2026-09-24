import { supabase } from './supabase';

const IST_DATE = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/* ── Get today's tasks ──────────────────────────────────────── */
export async function getTodayTasks(firebaseUid) {
  const today = IST_DATE();
  const { data, error } = await supabase
    .from('user_daily_tasks')
    .select('*')
    .eq('user_id', firebaseUid)
    .eq('task_date', today)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ── Mark a task done ───────────────────────────────────────── */
export async function markTaskDone(taskId, done = true) {
  const { error } = await supabase
    .from('user_daily_tasks')
    .update({ is_done: done, done_at: done ? new Date().toISOString() : null })
    .eq('id', taskId);
  if (error) throw error;
}

// savePlanAsTasks + its regex plan parser were removed 2026-09-25: never called
// anywhere, and they carried their own hardcoded subject list. Study Plan saves
// tasks via addManualTask with a server-checked subject (StudyPlanPage).

/* ── Add a manual task ──────────────────────────────────────── */
export async function addManualTask(firebaseUid, { subject, topic, duration_min = 45, task_type = 'study' }) {
  const today = IST_DATE();
  const { error } = await supabase.from('user_daily_tasks').insert({
    user_id: firebaseUid, task_date: today, subject, topic, duration_min, task_type, source: 'manual',
  });
  if (error) throw error;
}
