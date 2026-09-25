/**
 * Server-enforced quota for AI features (security pass 2, 2026-09-25).
 *
 * Quota used to be checked only in the browser (checkQuota before, then
 * incrementQuota after) — skipping either, or calling ai-proxy directly, meant
 * unlimited use. Now a student action is charged ONCE, up front, on the server:
 *
 *   const action = await beginAiAction(uid, 'ai_questions', 10, { examType, subject });
 *   try { ...AI calls (any number of ai-proxy requests) ...
 *         await endAiAction(uid, action, questionsActuallyMade);   // refunds the rest
 *   } catch (e) { await endAiAction(uid, action, 0); throw e; }     // full refund
 *
 * begin_ai_action applies the SAME limit rule as before (campaign grant, else
 * the student's plan in quota_config; -1 = unlimited) and refuses with a
 * QuotaExceededError when the day's limit would be passed. ai-proxy then only
 * serves this student's calls while such an action is open (30 min). Admins
 * are exempt (nothing is charged). Exam+subject, when given, must be one of
 * the student's allowed pairs ('Mixed' = any allowed subject of that exam).
 */
import { supabase } from './supabase';
import { notifyQuotaChanged } from './quota';

export class QuotaExceededError extends Error {
  constructor(message, { used = null, limit = null, bucket = null, reason = null } = {}) {
    super(message);
    this.name = 'QuotaExceededError';
    this.used = used; this.limit = limit; this.bucket = bucket; this.reason = reason;
  }
}

/** Charge the action. Throws QuotaExceededError when over the limit. */
export async function beginAiAction(uid, bucket, amount = 1, { examType = null, subject = null } = {}) {
  if (!uid) throw new Error('Sign in to use this feature.');
  const { data, error } = await supabase.rpc('begin_ai_action', {
    p_uid: uid, p_bucket: bucket, p_amount: Math.max(1, Math.round(amount)),
    p_exam_type: examType, p_subject: subject,
  });
  if (error) {
    if (error.code === '54000') {
      let detail = {};
      try { detail = JSON.parse(error.hint ?? '{}'); } catch { /* keep message only */ }
      // The free Daily Mini Test bucket has no paid tier to upgrade to.
      const msg = detail.bucket === 'daily_test'
        ? error.message
        : `${error.message}. Upgrade to Premium for more, or try again tomorrow.`;
      throw new QuotaExceededError(msg, detail);
    }
    throw new Error(error.message);
  }
  if (!data?.exempt && !data?.free) notifyQuotaChanged(uid, `${bucket}_used`, amount);
  return { id: data?.action_id ?? null, bucket, amount, exempt: !!data?.exempt };
}

/**
 * Close the action, refunding whatever it did not use. `actual` = how many
 * units were really delivered (0 on failure → full refund). Never throws —
 * a failed refund must not turn a successful generation into an error.
 */
export async function endAiAction(uid, action, actual) {
  if (!uid || !action?.id) return;
  const { data, error } = await supabase.rpc('end_ai_action', {
    p_uid: uid, p_action_id: action.id, p_actual: Math.max(0, Math.round(actual ?? 0)),
  });
  if (error) { console.warn('[aiActions] end_ai_action failed:', error.message); return; }
  if (data?.refunded > 0 && !action.exempt) notifyQuotaChanged(uid, `${action.bucket}_used`, -data.refunded);
}
