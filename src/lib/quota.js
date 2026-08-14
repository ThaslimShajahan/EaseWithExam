/**
 * Quota enforcement — reads live limits from:
 *   1. quota_overrides  (per-user admin override, highest priority)
 *   2. get_student_effective_plan RPC (checks personal sub + coaching centre plan)
 *   3. quota_config     (per-plan limits)
 *   4. FREE_LIMITS      (hardcoded fallback if DB unreachable)
 */

import { supabase } from './supabase';
import { getFeatureFlag, FLAGS } from './featureFlags';
import { isCampaignActive, CAMPAIGN_LIMIT } from './campaignQuota';

/* Campaign settings, cached briefly.
 *
 * 60s rather than the long-lived _ctxCache used for plan/override: a campaign is
 * switched on and off by hand and the owner will be watching for the effect, so
 * a stale minute is tolerable but a stale session is not. Deliberately its own
 * cache — folding it into _ctxCache would key it per user and refetch the same
 * global row once per student.
 *
 * Read failures resolve to "no campaign" rather than throwing: quota checks run
 * on the hot path of every generate action, and a settings hiccup must not block
 * a student. Failing closed here means normal limits apply, which is the safe
 * direction. */
let _campaignCache = null;
const CAMPAIGN_TTL_MS = 60_000;

export function invalidateCampaignCache() { _campaignCache = null; }

async function getCampaignSettings() {
  if (_campaignCache && Date.now() - _campaignCache.ts < CAMPAIGN_TTL_MS) return _campaignCache.value;
  let value = { enabled: 'false', endsAt: null };
  try {
    const { data } = await supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['campaign_unlimited_enabled', 'campaign_unlimited_ends_at']);
    const byKey = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    value = {
      enabled: byKey.campaign_unlimited_enabled ?? 'false',
      endsAt:  byKey.campaign_unlimited_ends_at ?? null,
    };
  } catch { /* leave the safe default */ }
  _campaignCache = { value, ts: Date.now() };
  return value;
}

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

// Override, per-plan config, and effective-plan (coaching centre inheritance)
// are identical for every field of a given user/plan — but getQuotaSnapshot
// and checkQuota are called once PER FIELD (Sidebar and ProfilePage both
// resolve all 6 FIELD_LABELS on mount), so without sharing, a single page
// load fired 6x these 3 identical requests from each of 2 components x
// React StrictMode's dev double-invoke = dozens of near-identical fetches
// in one burst. Same shape as the earlier feature_flags over-fetching bug:
// this data only changes via rare admin actions, so a short cache is safe —
// unlike daily_usage_quota below, which is NEVER cached here (it's the one
// thing that actually changes on every quota use, and staleness there would
// be a real correctness bug, not just a performance one).
const _ctxCache = new Map(); // `${uid}:${isPremium}:${plan}` -> { promise, ts }
const CTX_TTL_MS = 15000;

function getQuotaContext(firebaseUid, isPremium, plan) {
  const key = `${firebaseUid}:${isPremium}:${plan}`;
  const cached = _ctxCache.get(key);
  if (cached && Date.now() - cached.ts < CTX_TTL_MS) return cached.promise;

  // Wrap RPC in a try/catch because the RPC builder may not expose `.catch`
  const planReq = (async () => {
    try {
      return await supabase.rpc('get_student_effective_plan', { p_uid: firebaseUid });
    } catch (e) {
      return { data: null };
    }
  })();

  const promise = (async () => {
    let effectivePlan = isPremium ? (plan && plan !== 'free' ? plan : 'premium_monthly') : 'free';
    const [planRes, overrideRes] = await Promise.all([
      planReq,
      supabase.from('quota_overrides').select('*').eq('user_id', firebaseUid).maybeSingle(),
    ]);
    if (planRes?.data && planRes.data !== 'free') effectivePlan = planRes.data;
    const { data: config } = await supabase.from('quota_config').select('*').eq('plan_id', effectivePlan).maybeSingle();
    return { override: overrideRes.data, config };
  })();

  _ctxCache.set(key, { promise, ts: Date.now() });
  return promise;
}

// Same over-fetching shape as getQuotaContext above, but for the actual usage
// row: getQuotaSnapshot resolves all 6 FIELD_LABELS on mount, and 5 of them
// are daily fields that all live in the SAME daily_usage_quota row — reading
// the full row once and letting every field pull its own column out of it
// replaces 5 separate `select(field)` requests with 1. Kept deliberately
// short-lived (unlike the context cache) and explicitly invalidated by
// incrementQuota below on every successful write, so a quota check made
// right after an increment can never read a pre-increment cached count —
// this is the one piece of quota data that's expected to change on almost
// every action, so correctness here matters more than in getQuotaContext.
const _usageCache = new Map();   // `${uid}:${today}`     -> { promise, ts } (full daily row)
const _weeklyCache = new Map();  // `${uid}:${weekStart}` -> { promise, ts } (full week's rows)
const USAGE_TTL_MS = 5000;

function getDailyUsageRow(firebaseUid, today) {
  const key = `${firebaseUid}:${today}`;
  const cached = _usageCache.get(key);
  if (cached && Date.now() - cached.ts < USAGE_TTL_MS) return cached.promise;
  const promise = supabase.from('daily_usage_quota').select('*')
    .eq('user_id', firebaseUid).eq('usage_date', today).maybeSingle()
    .then(({ data }) => data);
  _usageCache.set(key, { promise, ts: Date.now() });
  return promise;
}

function getWeeklyUsageRows(firebaseUid, weekStart, today) {
  const key = `${firebaseUid}:${weekStart}`;
  const cached = _weeklyCache.get(key);
  if (cached && Date.now() - cached.ts < USAGE_TTL_MS) return cached.promise;
  const promise = supabase.from('daily_usage_quota').select('*')
    .eq('user_id', firebaseUid).gte('usage_date', weekStart).lte('usage_date', today)
    .then(({ data }) => data ?? []);
  _weeklyCache.set(key, { promise, ts: Date.now() });
  return promise;
}

// incrementQuota calls this on every successful write — override/config/plan
// don't change from a usage increment, so only the usage rows need dropping.
function invalidateUsageCache(uid) {
  for (const key of _usageCache.keys())  if (key.startsWith(`${uid}:`)) _usageCache.delete(key);
  for (const key of _weeklyCache.keys()) if (key.startsWith(`${uid}:`)) _weeklyCache.delete(key);
}

// Exposed for tests (isolating cache state between cases, where the same uid
// is reused across cases with different mocked responses) and for any admin
// action that changes a user's override/plan/usage mid-session and needs the
// next quota read to reflect it immediately rather than waiting out the TTL.
export function invalidateQuotaCache(uid) {
  if (uid == null) { _ctxCache.clear(); _usageCache.clear(); _weeklyCache.clear(); return; }
  for (const key of _ctxCache.keys()) if (key.startsWith(`${uid}:`)) _ctxCache.delete(key);
  invalidateUsageCache(uid);
}

// Shared by checkQuota (gate) and getQuotaSnapshot (display-only, used by the
// Profile page's usage panel) so the limit-resolution logic — overrides,
// then per-plan config, then the hardcoded fallback — lives in one place.
async function resolveQuota(firebaseUid, field, isPremium, plan) {
  const today       = IST_DATE();
  const configField = FIELD_TO_CONFIG[field];

  const isWeekly = WEEKLY_FIELDS.has(field);
  const usagePromise = isWeekly
    ? getWeeklyUsageRows(firebaseUid, IST_WEEK_START(), today)
    : getDailyUsageRow(firebaseUid, today);

  const [{ override, config }, usageData] = await Promise.all([
    getQuotaContext(firebaseUid, isPremium, plan),
    usagePromise,
  ]);

  // Campaign mode sits ABOVE the per-user override, and that ordering is
  // deliberate. An override is normally the most specific answer and wins, but a
  // campaign is a blanket promise made to everyone at once — a student who had
  // been throttled by an override must not be the one person still throttled
  // during it. `realLimit` below is preserved so the admin UI can show what the
  // limit WOULD be, side by side with what the campaign is currently granting.
  const campaignOn = isCampaignActive(await getCampaignSettings());

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

  // What this student would be entitled to with no campaign running. Returned
  // alongside the effective limit so the admin UI can show both columns, and so
  // the moment a campaign ends nothing has to be recomputed or un-done.
  const realLimit = limit;
  if (campaignOn) limit = CAMPAIGN_LIMIT;

  // Weekly fields sum every daily_usage_quota row seen so far this week
  // (incrementQuota always writes to TODAY's row regardless of period —
  // only the read side needs to know a field spans more than one day).
  const used = isWeekly
    ? (usageData ?? []).reduce((sum, row) => sum + (row?.[field] ?? 0), 0)
    : (usageData?.[field] ?? 0);

  return { used, limit, realLimit, campaignActive: campaignOn };
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
    // Must run before dispatching the event below — Sidebar/ProfilePage's
    // 'ewe:quota-updated' listeners re-call getQuotaSnapshot immediately, and
    // without invalidating first they'd get served the pre-increment row
    // straight back out of the cache instead of the fresh count.
    invalidateUsageCache(firebaseUid);
    // Sidebar's Usage & Limits panel (and anything else showing live quota
    // numbers) has no other way to know usage just changed — it only reads
    // on mount/when uid changes, so without this it stayed stale until a full
    // page refresh even though the DB was updated correctly. A plain window
    // event keeps this decoupled (no context/prop drilling needed) for any
    // listener anywhere in the tree.
    window.dispatchEvent(new CustomEvent('ewe:quota-updated', { detail: { field, amount } }));
  } catch { /* silent */ }
}
