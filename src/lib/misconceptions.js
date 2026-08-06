import { supabase } from './supabase';

/* ── Weak concepts by chapter, most-repeated first ───────────
   Each row is a chapter-level rollup: total repeat count across every
   distractor logged for that chapter, plus the single most-repeated
   mistake as a concrete example. */
export async function getUserMisconceptions(firebaseUid, limit = 6) {
  if (!firebaseUid) return [];
  const { data, error } = await supabase.rpc('get_user_misconceptions', {
    p_uid:   firebaseUid,
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

/* ── Admin: platform-wide top misconceptions in the last N days ──── */
export async function adminGetTopMisconceptions(callerUid, days = 7, limit = 20) {
  const { data, error } = await supabase.rpc('admin_get_top_misconceptions', {
    p_caller: callerUid,
    p_days:   days,
    p_limit:  limit,
  });
  if (error) throw error;
  return data ?? [];
}
