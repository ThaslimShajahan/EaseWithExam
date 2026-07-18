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
import { checkQuota, incrementQuota, FREE_LIMITS, FIELD_LABELS } from '../quota';

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function mockRpc(returnVal = null) {
  supabase.rpc.mockResolvedValue({ data: returnVal, error: null });
}

function mockFrom({ override = null, config = null, usage = null } = {}) {
  supabase.from.mockImplementation((table) => {
    const self = {
      select: () => self,
      eq:     () => self,
      maybeSingle: () => {
        if (table === 'quota_overrides')   return Promise.resolve({ data: override });
        if (table === 'quota_config')      return Promise.resolve({ data: config });
        if (table === 'daily_usage_quota') return Promise.resolve({ data: usage });
        return Promise.resolve({ data: null });
      },
    };
    return self;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc('free');
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
    expect(result.reason).toContain('Daily limit reached');
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
    expect(result).toEqual({ allowed: true, unlimited: true });
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
});
