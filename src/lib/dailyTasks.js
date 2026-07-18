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

/* ── Parse AI study plan and save as daily tasks ────────────── */
export async function savePlanAsTasks(firebaseUid, planText) {
  if (!firebaseUid || !planText) return 0;

  // Delete existing plan tasks for today onwards
  const today = IST_DATE();
  await supabase
    .from('user_daily_tasks')
    .delete()
    .eq('user_id', firebaseUid)
    .eq('source', 'plan')
    .gte('task_date', today);

  const tasks = parsePlanToTasks(firebaseUid, planText);
  if (!tasks.length) return 0;

  const { error } = await supabase.from('user_daily_tasks').insert(tasks);
  if (error) throw error;
  return tasks.length;
}

/* ── Add a manual task ──────────────────────────────────────── */
export async function addManualTask(firebaseUid, { subject, topic, duration_min = 45, task_type = 'study' }) {
  const today = IST_DATE();
  const { error } = await supabase.from('user_daily_tasks').insert({
    user_id: firebaseUid, task_date: today, subject, topic, duration_min, task_type, source: 'manual',
  });
  if (error) throw error;
}

/* ── Internal: parse plan text → tasks ─────────────────────── */
function parsePlanToTasks(firebaseUid, planText) {
  const tasks = [];
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let dayOffset = 0;

  // Match patterns like "Day 1:", "Week 1, Day 1:", "Monday:", "Day 1 (Physics — Kinematics):"
  const lines = planText.split('\n');
  const dayPattern = /day\s*(\d+)|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i;
  const subjectPatterns = [
    /physics/i, /chemistry/i, /biology/i, /botany/i, /zoology/i,
    /mathematics|maths|math/i, /english/i, /science/i,
    /social studies|history|geography|civics|polity|economics/i,
  ];
  const subjectNames = ['Physics', 'Chemistry', 'Biology', 'Biology', 'Biology', 'Mathematics', 'English', 'Science', 'Social Studies'];

  lines.forEach((line) => {
    const dayMatch = line.match(dayPattern);
    if (dayMatch) {
      const dayNum = parseInt(dayMatch[1]);
      if (!isNaN(dayNum)) dayOffset = dayNum - 1;
      else {
        const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const wday = days.findIndex((d) => line.toLowerCase().includes(d));
        if (wday >= 0) {
          const todayWday = today.getDay();
          dayOffset = (wday - todayWday + 7) % 7;
        }
      }
    }

    // Extract subject and topic from the line
    let subject = 'Study';
    let topic   = line.replace(/^[-*•]\s*/, '').replace(/day\s*\d+[:\s]*/i, '').trim();

    for (let i = 0; i < subjectPatterns.length; i++) {
      if (subjectPatterns[i].test(line)) {
        subject = subjectNames[i];
        break;
      }
    }

    // Extract chapter/topic from dash-separated text (e.g. "Physics — Rotational Motion")
    const dashMatch = line.match(/[—–-]\s*(.+?)(?:\s*\(|$)/);
    if (dashMatch) topic = dashMatch[1].trim();

    if (topic.length > 5 && topic.length < 80 && subject !== 'Study') {
      const taskDate = new Date(today);
      taskDate.setDate(taskDate.getDate() + dayOffset);
      const dateStr = taskDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      // Estimate duration from text
      const durMatch = line.match(/(\d+)\s*(?:min|hour|hr)/i);
      const duration_min = durMatch
        ? (line.includes('hour') || line.includes('hr') ? parseInt(durMatch[1]) * 60 : parseInt(durMatch[1]))
        : 45;

      const task_type = /practice|questions|mcq|test/i.test(line) ? 'practice'
        : /revision|revise/i.test(line) ? 'revision'
        : /mock/i.test(line) ? 'mock_test'
        : 'study';

      tasks.push({
        user_id: firebaseUid,
        task_date: dateStr,
        subject,
        topic,
        duration_min: Math.min(duration_min, 180),
        task_type,
        source: 'plan',
        plan_week: Math.floor(dayOffset / 7) + 1,
      });
    }
  });

  return tasks.slice(0, 90); // max 90 tasks
}
