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

export const FREE_LIMITS = {
  ai_questions_used:      15,
  veda_messages_used:     20,
  mock_tests_used:         3,
  paper_evaluations_used:  3,
};

export const FIELD_LABELS = {
  ai_questions_used:      'AI questions',
  veda_messages_used:     'EWE messages',
  mock_tests_used:        'mock tests',
  paper_evaluations_used: 'paper evaluations',
};

const FIELD_TO_CONFIG = {
  ai_questions_used:      'ai_questions',
  veda_messages_used:     'veda_messages',
  mock_tests_used:        'mock_tests',
  paper_evaluations_used: 'paper_evaluations',
};

/**
 * Returns { allowed: true } or { allowed: false, reason, used, limit }
 */
export async function checkQuota(firebaseUid, field, isPremium, plan = 'free') {
  if (!firebaseUid) return { allowed: true };

  const today       = IST_DATE();
  const configField = FIELD_TO_CONFIG[field];

  // Determine effective plan — check coaching centre inheritance via RPC
  let effectivePlan = isPremium ? (plan && plan !== 'free' ? plan : 'premium_monthly') : 'free';

  try {
    const { data: centreplan } = await supabase.rpc('get_student_effective_plan', { p_uid: firebaseUid });
    if (centreplan && centreplan !== 'free') effectivePlan = centreplan;
  } catch { /* fall through to personal plan */ }

  const planId = effectivePlan;

  const [overrideRes, configRes, usageRes] = await Promise.all([
    supabase.from('quota_overrides').select('*').eq('user_id', firebaseUid).maybeSingle(),
    supabase.from('quota_config').select('*').eq('plan_id', planId).maybeSingle(),
    supabase.from('daily_usage_quota').select(field).eq('user_id', firebaseUid).eq('usage_date', today).maybeSingle(),
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

  if (limit === -1) return { allowed: true, unlimited: true };

  const used = usageRes.data?.[field] ?? 0;

  if (used >= limit) {
    return {
      allowed: false,
      reason: `Daily limit reached: ${used}/${limit} ${FIELD_LABELS[field]}. Upgrade to Premium for unlimited access.`,
      used,
      limit,
    };
  }

  return { allowed: true, used, limit };
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
      return;
    }

    // Safe path: SECURITY DEFINER RPC (eliminates anon-key direct write)
    await supabase.rpc('upsert_usage_quota', {
      p_uid:    firebaseUid,
      p_date:   IST_DATE(),
      p_field:  field,
      p_amount: amount,
    });
  } catch { /* silent */ }
}
