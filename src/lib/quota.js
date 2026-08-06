/**
 * Quota enforcement — reads live limits from:
 *   1. quota_overrides  (per-user admin override, highest priority)
 *   2. get_student_effective_plan RPC (checks personal sub + coaching centre plan)
 *   3. quota_config     (per-plan limits)
 *   4. FREE_LIMITS      (hardcoded fallback if DB unreachable)
 */

import { supabase } from './supabase';
import { getFeatureFlag, FLAGS } from './featureFlags';

const IST_DATE = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Monday-based ISO week start (IST), as a "YYYY-MM-DD" string — used by
// WEEKLY_FIELDS to sum usage across the current week instead of a single day.
// IST_DATE() already resolves "today" correctly in IST; its Y/M/D components
// are re-parsed into a plain local Date (no further timezone conversion,
// which is exactly what avoids the classic re-parse-a-tz-string bug) purely
// to ask "which weekday is this."
export function IST_WEEK_START() {
  const [y, m, d] = IST_DATE().split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day  = date.getDay(); // 0=Sun..6=Sat
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toLocaleDateString('en-CA');
}

// Free-tier mock tests are marketed as "1 per week" (not per day) — a
// free student who could take 1 test/day was effectively getting 7/week,
// which defeats the point of a hook-sized free tier. This is the only
// weekly field today; everything else resets daily.
const WEEKLY_FIELDS = new Set(['mock_tests_used']);

export const FREE_LIMITS = {
  ai_questions_used:       20,
  veda_messages_used:      15,
  mock_tests_used:          2, // per week — see WEEKLY_FIELDS
  paper_evaluations_used:   3,
  podcasts_used:            3,
  paper_generations_used:   2, // full Exam Center papers/day — see quota.js:resolveQuota callers
};

export const FIELD_LABELS = {
  ai_questions_used:      'AI questions',
  veda_messages_used:     'EWE messages',
  mock_tests_used:        'mock tests',
  paper_evaluations_used: 'paper evaluations',
  podcasts_used:          'podcasts',
  paper_generations_used: 'full papers',
};

const FIELD_TO_CONFIG = {
  ai_questions_used:      'ai_questions',
  veda_messages_used:     'veda_messages',
  mock_tests_used:        'mock_tests',
  paper_evaluations_used: 'paper_evaluations',
  podcasts_used:          'podcasts',
  paper_generations_used: 'paper_generations',
};

// Shared by checkQuota (gate) and getQuotaSnapshot (display-only, used by the
// Profile page's usage panel) so the limit-resolution logic — overrides,
// then per-plan config, then the hardcoded fallback — lives in one place.
async function resolveQuota(firebaseUid, field, isPremium, plan) {
  const today       = IST_DATE();
  const configField = FIELD_TO_CONFIG[field];

  // Determine effective plan — check coaching centre inheritance via RPC
  let effectivePlan = isPremium ? (plan && plan !== 'free' ? plan : 'premium_monthly') : 'free';

  try {
    const { data: centreplan } = await supabase.rpc('get_student_effective_plan', { p_uid: firebaseUid });
    if (centreplan && centreplan !== 'free') effectivePlan = centreplan;
  } catch { /* fall through to personal plan */ }

  const planId = effectivePlan;

  const isWeekly = WEEKLY_FIELDS.has(field);
  const usageQuery = isWeekly
    ? supabase.from('daily_usage_quota').select(field).eq('user_id', firebaseUid).gte('usage_date', IST_WEEK_START()).lte('usage_date', today)
    : supabase.from('daily_usage_quota').select(field).eq('user_id', firebaseUid).eq('usage_date', today).maybeSingle();

  const [overrideRes, configRes, usageRes] = await Promise.all([
    supabase.from('quota_overrides').select('*').eq('user_id', firebaseUid).maybeSingle(),
    supabase.from('quota_config').select('*').eq('plan_id', planId).maybeSingle(),
    usageQuery,
  ]);

  const override = overrideRes.data;
  const config   = configRes.data;

  let limit;
  const overrideVal = override?.[configField];
  const overrideActive =
    override &&
    configField &&
    overrideVal !== null &&
    overrideVal !== undefined &&
    (!override.expires_at || new Date(override.expires_at) > new Date());

  if (overrideActive) {
    limit = overrideVal;
  } else {
    limit = config?.[configField] ?? FREE_LIMITS[field];
  }

  // Weekly fields sum every daily_usage_quota row seen so far this week
  // (incrementQuota always writes to TODAY's row regardless of period —
  // only the read side needs to know a field spans more than one day).
  const used = isWeekly
    ? (usageRes.data ?? []).reduce((sum, row) => sum + (row?.[field] ?? 0), 0)
    : (usageRes.data?.[field] ?? 0);

  return { used, limit };
}

/**
 * Returns { allowed: true } or { allowed: false, reason, used, limit }
 *
 * `amount` is how much this ONE action is about to consume (e.g. a 30-
 * question paper consumes 30 of the ai_questions_used bucket in a single
 * incrementQuota call, not 1). Without checking against the full amount up
 * front, a student sitting at 8/15 could still generate a 30-question paper
 * — the pre-check only compared 8 to 15 and passed, then incrementQuota
 * added the whole 30, landing at 38/15. Checking used+amount here is what
 * actually prevents that overshoot instead of just detecting it next time.
 */
export async function checkQuota(firebaseUid, field, isPremium, plan = 'free', amount = 1) {
  if (!firebaseUid) return { allowed: true };

  const { used, limit } = await resolveQuota(firebaseUid, field, isPremium, plan);

  if (limit === -1) return { allowed: true, unlimited: true, used };

  const period = WEEKLY_FIELDS.has(field) ? 'weekly' : 'daily';

  if (used >= limit) {
    return {
      allowed: false,
      reason: `You've reached your ${period} limit of ${limit} ${FIELD_LABELS[field]}. Upgrade to Premium for unlimited access.`,
      used,
      limit,
    };
  }

  if (used + amount > limit) {
    const remaining = limit - used;
    return {
      allowed: false,
      reason: `This needs ${amount} ${FIELD_LABELS[field]}, but you only have ${remaining} left this ${period === 'weekly' ? 'week' : 'today'}. Upgrade to Premium for unlimited access, or choose a smaller amount.`,
      used,
      limit,
      remaining,
    };
  }

  return { allowed: true, used, limit };
}

/**
 * Display-only snapshot of today's usage vs. limit for a quota field —
 * doesn't gate anything, just reports where the student stands. Used by the
 * Profile page's "Usage & Limits" panel so both free and premium students
 * can see their actual numbers, not just the plan name.
 */
export async function getQuotaSnapshot(firebaseUid, field, isPremium, plan = 'free') {
  if (!firebaseUid) return { used: 0, limit: 0, unlimited: false };
  const { used, limit } = await resolveQuota(firebaseUid, field, isPremium, plan);
  return { used, limit, unlimited: limit === -1 };
}

/**
 * Increments usage after a successful AI operation.
 * When atomic_quota_rpc_enabled flag is on, uses the check_and_increment_quota
 * RPC (eliminates client-side read-modify-write race condition).
 */
export async function incrementQuota(firebaseUid, field, amount = 1) {
  if (!firebaseUid) return;
  try {
    const useRpc = await getFeatureFlag(FLAGS.ATOMIC_QUOTA_RPC);
    if (useRpc) {
      await supabase.rpc('check_and_increment_quota', {
        p_uid:    firebaseUid,
        p_field:  field,
        p_amount: amount,
        p_date:   IST_DATE(),
      });
    } else {
      // Safe path: SECURITY DEFINER RPC (eliminates anon-key direct write)
      await supabase.rpc('upsert_usage_quota', {
        p_uid:    firebaseUid,
        p_date:   IST_DATE(),
        p_field:  field,
        p_amount: amount,
      });
    }
    // Sidebar's Usage & Limits panel (and anything else showing live quota
    // numbers) has no other way to know usage just changed — it only reads
    // on mount/when uid changes, so without this it stayed stale until a full
    // page refresh even though the DB was updated correctly. A plain window
    // event keeps this decoupled (no context/prop drilling needed) for any
    // listener anywhere in the tree.
    window.dispatchEvent(new CustomEvent('ewe:quota-updated', { detail: { field, amount } }));
  } catch { /* silent */ }
}
