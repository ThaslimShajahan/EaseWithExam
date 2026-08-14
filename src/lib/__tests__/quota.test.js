import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('../featureFlags', () => ({
  getFeatureFlag: vi.fn().mockResolvedValue(false),
  FLAGS: { ATOMIC_QUOTA_RPC: 'atomic_quota_rpc_enabled' },
}));

import { supabase } from '../supabase';
import { getFeatureFlag } from '../featureFlags';
import { checkQuota, incrementQuota, getQuotaSnapshot, FREE_LIMITS, FIELD_LABELS, invalidateQuotaCache } from '../quota';

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function mockRpc(returnVal = null) {
  supabase.rpc.mockResolvedValue({ data: returnVal, error: null });
}

// `usageRows` backs the weekly-field code path (mock_tests_used), which
// awaits the query directly instead of calling .maybeSingle() — Supabase's
// real query builder is thenable, so the mock needs its own `.then()` to
// resolve that shape; `.gte`/`.lte` just need to chain like `.eq` does.
function mockFrom({ override = null, config = null, usage = null, usageRows = null } = {}) {
  supabase.from.mockImplementation((table) => {
    const self = {
      select: () => self,
      eq:     () => self,
      gte:    () => self,
      lte:    () => self,
      maybeSingle: () => {
        if (table === 'quota_overrides')   return Promise.resolve({ data: override });
        if (table === 'quota_config')      return Promise.resolve({ data: config });
        if (table === 'daily_usage_quota') return Promise.resolve({ data: usage });
        return Promise.resolve({ data: null });
      },
      then: (resolve, reject) =>
        Promise.resolve({ data: table === 'daily_usage_quota' ? (usageRows ?? []) : null }).then(resolve, reject),
    };
    return self;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc('free');
  invalidateQuotaCache(); // each test's mockFrom() sets fresh override/config/usage; don't serve a previous test's cached values
});

describe('FREE_LIMITS', () => {
  it('defines limits for all three quota fields', () => {
    expect(FREE_LIMITS.ai_questions_used).toBeGreaterThan(0);
    expect(FREE_LIMITS.veda_messages_used).toBeGreaterThan(0);
    expect(FREE_LIMITS.mock_tests_used).toBeGreaterThan(0);
  });
});

describe('FIELD_LABELS', () => {
  it('covers all quota fields with human-readable labels', () => {
    expect(FIELD_LABELS.ai_questions_used).toBeTruthy();
    expect(FIELD_LABELS.veda_messages_used).toBeTruthy();
    expect(FIELD_LABELS.mock_tests_used).toBeTruthy();
  });
});

describe('checkQuota', () => {
  it('allows when no firebaseUid is provided', async () => {
    const result = await checkQuota(null, 'ai_questions_used', false);
    expect(result).toEqual({ allowed: true });
  });

  it('allows when usage is below limit', async () => {
    mockFrom({
      config: { ai_questions: 15 },
      usage:  { ai_questions_used: 5 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(5);
    expect(result.limit).toBe(15);
  });

  it('blocks when usage equals limit', async () => {
    mockFrom({
      config: { ai_questions: 15 },
      usage:  { ai_questions_used: 15 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(15);
    expect(result.limit).toBe(15);
    expect(result.reason).toContain("reached your daily limit");
  });

  // Regression test: a student at 8/15 requesting a 30-question paper used to
  // pass this check (8 < 15) and then incrementQuota added the full 30,
  // landing at 38/15 — visibly over the limit and never actually blocked.
  // Passing the batch size as `amount` must reject the request up front.
  it('blocks a batch request that would push usage past the limit, even though current usage is still under it', async () => {
    mockFrom({
      config: { ai_questions: 15 },
      usage:  { ai_questions_used: 8 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false, undefined, 30);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(7);
  });

  it('allows a batch request that fits within the remaining allowance', async () => {
    mockFrom({
      config: { ai_questions: 15 },
      usage:  { ai_questions_used: 8 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false, undefined, 5);
    expect(result.allowed).toBe(true);
  });

  it('falls back to FREE_LIMITS when no quota_config row', async () => {
    mockFrom({
      config: null,
      usage:  { ai_questions_used: 0 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(FREE_LIMITS.ai_questions_used);
  });

  it('allows unlimited when limit is -1', async () => {
    mockFrom({
      config: { ai_questions: -1 },
      usage:  { ai_questions_used: 9999 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', true, 'premium_yearly');
    expect(result).toEqual({ allowed: true, unlimited: true, used: 9999 });
  });

  it('respects active quota override over config', async () => {
    mockFrom({
      override: { ai_questions: 5, expires_at: null },
      config:   { ai_questions: 15 },
      usage:    { ai_questions_used: 6 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(5);
  });

  it('ignores expired quota overrides', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockFrom({
      override: { ai_questions: 2, expires_at: past },
      config:   { ai_questions: 15 },
      usage:    { ai_questions_used: 5 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(result.limit).toBe(15);
    expect(result.allowed).toBe(true);
  });
});

/* Both-halves cover for the per-student grant mechanism that replaced the
 * global campaign toggle (2026-08-14, same night): quota_overrides.expires_at
 * is the ENTIRE expiry mechanism — resolveQuota just stops selecting an
 * override the instant `expires_at` passes, with no cleanup job, no error, and
 * no stuck intermediate state. These pin that behaviour with the REAL preset
 * values (GRANT_PRESET in AdminStudents.jsx: 500 AI/day), not arbitrary
 * numbers, so a future change to the preset is what breaks these — not the
 * expiry mechanism drifting unnoticed underneath it. */
describe('checkQuota — per-student grant expiry (PERMIT active / DENY expired)', () => {
  it('PERMIT: an active grant well above the plan limit is honoured', async () => {
    mockFrom({
      override: { ai_questions: 500, expires_at: new Date(Date.now() + 3 * 86400000).toISOString() },
      config:   { ai_questions: 200 },   // premium's real plan limit
      usage:    { ai_questions_used: 350 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', true, 'premium_monthly');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(500);
  });

  it('PERMIT: the grant still blocks once ITS OWN (higher) ceiling is hit — "high", not infinite', async () => {
    mockFrom({
      override: { ai_questions: 500, expires_at: new Date(Date.now() + 3 * 86400000).toISOString() },
      config:   { ai_questions: 200 },
      usage:    { ai_questions_used: 500 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', true, 'premium_monthly');
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(500);
  });

  it('DENY: a grant expiring at this EXACT instant is already expired, not active', async () => {
    // Same boundary rule as the removed campaign's isCampaignActive() — "now <
    // end", strict, so the expiry instant itself belongs to "over".
    const now = new Date();
    mockFrom({
      override: { ai_questions: 500, expires_at: now.toISOString() },
      config:   { ai_questions: 200 },
      usage:    { ai_questions_used: 250 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', true, 'premium_monthly');
    expect(result.limit).toBe(200);         // reverted to the plan, not the grant
    expect(result.allowed).toBe(false);      // 250 used > 200 plan limit — correctly blocked now
  });

  it('DENY->PERMIT with NO stuck state: an expired grant reverts cleanly to a plan limit the student is still within', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    mockFrom({
      override: { ai_questions: 500, expires_at: past },
      config:   { ai_questions: 200 },
      usage:    { ai_questions_used: 50 },   // comfortably under the PLAN limit
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', true, 'premium_monthly');
    // Not an error, not "stuck" at the old grant, not silently unlimited —
    // just the plan's own number, exactly as if no grant had ever existed.
    expect(result).toEqual({ allowed: true, used: 50, limit: 200 });
  });

  it('getQuotaSnapshot (the badge/usage-panel read path) honours the same expiry rule', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockFrom({
      override: { ai_questions: 500, expires_at: future },
      config:   { ai_questions: 200 },
      usage:    { ai_questions_used: 10 },
    });
    const active = await getQuotaSnapshot('uid_123', 'ai_questions_used', true, 'premium_monthly');
    expect(active).toEqual({ used: 10, limit: 500, unlimited: false });

    invalidateQuotaCache();
    const past = new Date(Date.now() - 86400000).toISOString();
    mockFrom({
      override: { ai_questions: 500, expires_at: past },
      config:   { ai_questions: 200 },
      usage:    { ai_questions_used: 10 },
    });
    const expired = await getQuotaSnapshot('uid_123', 'ai_questions_used', true, 'premium_monthly');
    expect(expired).toEqual({ used: 10, limit: 200, unlimited: false });
  });

  it('a null-valued field on the override (mock_tests, deliberately left unset by the grant preset) falls through to the plan, not to 0', async () => {
    // GRANT_PRESET.mock_tests is null on purpose — premium already grants -1
    // there, and writing a number would DOWNGRADE a rewarded student. Confirms
    // resolveQuota's null-check treats "field present but null" as absent, the
    // same way the removed override-value check always has.
    mockFrom({
      override: { ai_questions: 500, mock_tests: null, expires_at: new Date(Date.now() + 86400000).toISOString() },
      config:   { ai_questions: 200, mock_tests: -1 },
      usageRows: [{ mock_tests_used: 4 }],   // weekly field — reads the array path, not the daily singleton
    });
    const result = await checkQuota('uid_123', 'mock_tests_used', true, 'premium_monthly');
    expect(result).toEqual({ allowed: true, unlimited: true, used: 4 });
  });
});

// mock_tests_used is the one WEEKLY_FIELDS entry (free tier: "1 mock test per
// week", not per day) — these confirm usage sums across the whole week's
// daily_usage_quota rows rather than reading a single day, which is what
// makes the weekly cap actually weekly instead of silently daily.
describe('checkQuota — weekly fields (mock_tests_used)', () => {
  it('sums usage across multiple days this week, not just today', async () => {
    mockFrom({
      config: { mock_tests: 1 },
      usageRows: [{ mock_tests_used: 1 }, { mock_tests_used: 0 }], // e.g. Mon + today
    });
    const result = await checkQuota('uid_123', 'mock_tests_used', false);
    expect(result.used).toBe(1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('weekly limit');
  });

  it('allows a fresh week with no usage rows yet', async () => {
    mockFrom({
      config: { mock_tests: 1 },
      usageRows: [],
    });
    const result = await checkQuota('uid_123', 'mock_tests_used', false);
    expect(result.used).toBe(0);
    expect(result.allowed).toBe(true);
  });

  it('still reads a single day for non-weekly fields (ai_questions_used)', async () => {
    mockFrom({
      config: { ai_questions: 10 },
      usage:  { ai_questions_used: 3 },
    });
    const result = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(result.used).toBe(3);
    expect(result.reason).toBeUndefined();
  });
});

describe('incrementQuota', () => {
  it('does nothing when firebaseUid is null', async () => {
    await incrementQuota(null, 'ai_questions_used');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('calls upsert_usage_quota RPC when atomic flag is off', async () => {
    getFeatureFlag.mockResolvedValue(false);
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    await incrementQuota('uid_123', 'ai_questions_used', 1);
    expect(supabase.rpc).toHaveBeenCalledWith('upsert_usage_quota', expect.objectContaining({
      p_uid:    'uid_123',
      p_field:  'ai_questions_used',
      p_amount: 1,
    }));
  });

  it('calls check_and_increment_quota RPC when atomic flag is on', async () => {
    getFeatureFlag.mockResolvedValue(true);
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    await incrementQuota('uid_123', 'veda_messages_used', 1);
    expect(supabase.rpc).toHaveBeenCalledWith('check_and_increment_quota', expect.objectContaining({
      p_uid:   'uid_123',
      p_field: 'veda_messages_used',
    }));
  });

  // Batch 13 Part A: getQuotaSnapshot/checkQuota now cache the daily usage
  // row (to collapse the 6-field-fetch-per-mount burst into one request) —
  // this guards against that cache serving a stale pre-increment count to a
  // read that happens right after a real increment (e.g. Sidebar/ProfilePage
  // re-fetching off the 'ewe:quota-updated' event incrementQuota dispatches).
  it('does not serve a stale cached usage count after incrementing', async () => {
    mockFrom({ override: null, config: { ai_questions: 20 }, usage: { ai_questions_used: 5 } });
    const before = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(before.used).toBe(5);

    mockFrom({ override: null, config: { ai_questions: 20 }, usage: { ai_questions_used: 6 } });
    await incrementQuota('uid_123', 'ai_questions_used', 1);

    const after = await checkQuota('uid_123', 'ai_questions_used', false);
    expect(after.used).toBe(6);
  });
});
