import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing the module under test
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../supabase';
import {
  getFeatureFlag,
  getFeatureFlags,
  invalidateFlagCache,
  FLAGS,
} from '../featureFlags';

const mockFlags = [
  { key: 'syllabus_graph_enabled',  enabled: true  },
  { key: 'dalle_proxy_enabled',      enabled: false },
  { key: 'centre_invites_enabled',   enabled: true  },
];

function setupSupabaseMock(data, error = null) {
  const selectFn = vi.fn().mockResolvedValue({ data, error });
  supabase.from.mockReturnValue({ select: selectFn });
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateFlagCache();
});

describe('getFeatureFlag', () => {
  it('returns true for an enabled flag', async () => {
    setupSupabaseMock(mockFlags);
    const result = await getFeatureFlag('syllabus_graph_enabled');
    expect(result).toBe(true);
  });

  it('returns false for a disabled flag', async () => {
    setupSupabaseMock(mockFlags);
    const result = await getFeatureFlag('dalle_proxy_enabled');
    expect(result).toBe(false);
  });

  it('returns false for an unknown flag (not in DB)', async () => {
    setupSupabaseMock(mockFlags);
    const result = await getFeatureFlag('nonexistent_flag');
    expect(result).toBe(false);
  });

  it('returns false when supabase returns an error', async () => {
    setupSupabaseMock(null, { message: 'connection refused' });
    const result = await getFeatureFlag('syllabus_graph_enabled');
    expect(result).toBe(false);
  });

  it('caches the result — DB called only once across multiple lookups', async () => {
    setupSupabaseMock(mockFlags);
    await getFeatureFlag('syllabus_graph_enabled');
    await getFeatureFlag('dalle_proxy_enabled');
    await getFeatureFlag('centre_invites_enabled');
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateFlagCache', () => {
  it('forces a fresh DB fetch after invalidation', async () => {
    setupSupabaseMock(mockFlags);
    await getFeatureFlag('syllabus_graph_enabled');
    expect(supabase.from).toHaveBeenCalledTimes(1);

    invalidateFlagCache();
    setupSupabaseMock([{ key: 'syllabus_graph_enabled', enabled: false }]);
    const result = await getFeatureFlag('syllabus_graph_enabled');

    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(result).toBe(false);
  });
});

describe('getFeatureFlags (batch)', () => {
  it('returns correct values for multiple keys', async () => {
    setupSupabaseMock(mockFlags);
    const result = await getFeatureFlags(['syllabus_graph_enabled', 'dalle_proxy_enabled', 'nonexistent']);
    expect(result).toEqual({
      syllabus_graph_enabled: true,
      dalle_proxy_enabled:    false,
      nonexistent:            false,
    });
  });

  it('returns all-false on DB error', async () => {
    setupSupabaseMock(null, { message: 'error' });
    const result = await getFeatureFlags(['syllabus_graph_enabled', 'dalle_proxy_enabled']);
    expect(result).toEqual({ syllabus_graph_enabled: false, dalle_proxy_enabled: false });
  });
});

describe('FLAGS constants', () => {
  it('has entries for all documented feature flags', () => {
    expect(FLAGS.SYLLABUS_GRAPH).toBe('syllabus_graph_enabled');
    expect(FLAGS.DALLE_PROXY).toBe('dalle_proxy_enabled');
    expect(FLAGS.CENTRE_INVITES).toBe('centre_invites_enabled');
    expect(FLAGS.ATOMIC_QUOTA_RPC).toBe('atomic_quota_rpc_enabled');
  });

  it('all flag values are non-empty strings', () => {
    Object.entries(FLAGS).forEach(([k, v]) => {
      expect(typeof v, k).toBe('string');
      expect(v.length, k).toBeGreaterThan(0);
    });
  });
});
