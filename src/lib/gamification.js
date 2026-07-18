import { supabase } from './supabase';
import { createNotification } from './notifications';

/* ── XP rewards table ───────────────────────────────────── */

export const XP_REWARDS = {
  daily_challenge:     20,
  practice_question:    1,
  mock_test:          100,
  paper_mode_complete: 50,
  veda_session:        10,
  study_plan_created:  30,
  perfect_score:       50,
  streak_7_days:       75,
  streak_30_days:     200,
};

/* ── Level thresholds ───────────────────────────────────── */

const THRESHOLDS = [0, 100, 250, 500, 1_000, 2_000, 3_500, 5_000, 7_500, 10_000, 15_000];

export function getLevel(xp) {
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export function getLevelProgress(xp) {
  const level = getLevel(xp);
  const floor = THRESHOLDS[level - 1] ?? 0;
  const ceil  = THRESHOLDS[level]     ?? THRESHOLDS[THRESHOLDS.length - 1];
  const range = ceil - floor;
  const prog  = xp - floor;
  return { level, progress: prog, range, pct: Math.min(100, Math.round((prog / range) * 100)), nextXP: ceil };
}

export const LEVEL_TITLES = [
  '', 'Beginner', 'Curious', 'Focused', 'Practitioner', 'Scholar',
  'Expert', 'Master', 'Champion', 'Elite', 'Legend', 'Zenith',
];

/* ── Fetch gamification record ──────────────────────────── */

export async function getUserGamification(firebaseUid) {
  const { data } = await supabase
    .from('user_gamification')
    .select('*')
    .eq('user_id', firebaseUid)
    .maybeSingle();

  return data ?? {
    user_id: firebaseUid,
    xp: 0,
    level: 1,
    streak_days: 0,
    longest_streak: 0,
    last_activity_date: null,
    total_questions_answered: 0,
    total_tests_taken: 0,
    total_veda_sessions: 0,
  };
}

/* ── Award XP + update streak ───────────────────────────── */

// IST calendar date — avoids UTC midnight triggering wrong day in India
const istToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export async function awardXP(firebaseUid, action) {
  const amount = XP_REWARDS[action] ?? 0;
  if (!amount) return null;

  const today = istToday();

  // Atomic read-modify-write via SQL RPC — eliminates race condition
  const { data, error } = await supabase.rpc('award_xp_atomic', {
    p_user_id: firebaseUid,
    p_amount:  amount,
    p_today:   today,
  });

  if (error) {
    // Fallback to client-side path if RPC not yet deployed
    console.warn('award_xp_atomic RPC unavailable, using fallback:', error.message);
    const existing = await getUserGamification(firebaseUid);
    const lastDate  = existing.last_activity_date;
    let streak = existing.streak_days ?? 0;
    if (lastDate) {
      const yesterday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) ).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const yDate = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (lastDate === yDate)      streak += 1;
      else if (lastDate !== today) streak  = 1;
    } else { streak = 1; }
    const longest = Math.max(existing.longest_streak ?? 0, streak);
    const newXP   = (existing.xp ?? 0) + amount;
    await supabase.from('user_gamification').upsert({
      user_id: firebaseUid, xp: newXP, level: getLevel(newXP),
      streak_days: streak, longest_streak: longest,
      last_activity_date: today, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    return { xp_earned: amount, streak_bonuses: [] };
  }

  const row = typeof data === 'string' ? JSON.parse(data) : data;
  const bonusActions = [];
  if (row?.streak_days === 7)  bonusActions.push('streak_7_days');
  if (row?.streak_days === 30) bonusActions.push('streak_30_days');

  // Streak milestone notifications
  const STREAK_MILESTONES = new Set([3, 7, 14, 30, 60, 100]);
  if (STREAK_MILESTONES.has(row?.streak_days)) {
    createNotification(
      firebaseUid,
      'streak_milestone',
      `${row.streak_days}-day streak! 🔥`,
      `You've studied ${row.streak_days} days in a row. Keep the momentum going!`,
      '/dashboard',
    ).catch(() => {});
  }

  // Level-up notification (compare old vs new level)
  const prevLevel = getLevel((row?.xp ?? 0) - amount);
  const newLevel  = getLevel(row?.xp ?? 0);
  if (newLevel > prevLevel) {
    createNotification(
      firebaseUid,
      'level_up',
      `Level Up! You reached Level ${newLevel} 🌟`,
      `${LEVEL_TITLES[Math.min(newLevel, LEVEL_TITLES.length - 1)]} — you've earned ${row?.xp ?? 0} XP total.`,
      '/dashboard',
    ).catch(() => {});
  }

  return { ...row, xp_earned: amount, streak_bonuses: bonusActions };
}

/* ── Increment activity counts ──────────────────────────── */

export async function incrementActivityCount(firebaseUid, field) {
  // Use Postgres increment to avoid read-write race condition
  const { error } = await supabase.rpc('increment_field', {
    p_user_id: firebaseUid,
    p_field:   field,
  });

  if (error) {
    // Fallback if RPC not deployed
    const { data: row } = await supabase
      .from('user_gamification')
      .select(`user_id, ${field}`)
      .eq('user_id', firebaseUid)
      .maybeSingle();
    const current = row?.[field] ?? 0;
    await supabase
      .from('user_gamification')
      .upsert({ user_id: firebaseUid, [field]: current + 1 }, { onConflict: 'user_id' });
  }
}
