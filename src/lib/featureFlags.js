/**
 * Feature flag helper — reads from the `feature_flags` Supabase table.
 *
 * All Phase 0–6 flags default to false so every new flow is opt-in.
 * Flags are fetched once at app boot and cached in memory for the session;
 * hard-refresh picks up any admin change.
 *
 * Usage:
 *   import { getFeatureFlag, useFeatureFlag } from './featureFlags';
 *
 *   // Async helper (lib code, outside React):
 *   const enabled = await getFeatureFlag('syllabus_graph_enabled');
 *
 *   // React hook (component code):
 *   const blueprintEnabled = useFeatureFlag('exam_blueprint_enabled');
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** In-memory cache — loaded once per session */
let _cache = null;
let _loadPromise = null;

/**
 * Load all flags from DB into the in-memory cache.
 * Deduplicates concurrent calls so the DB is hit exactly once per session.
 */
async function _loadFlags() {
  if (_cache) return _cache;
  if (_loadPromise) return _loadPromise;

  _loadPromise = supabase
    .from('feature_flags')
    .select('key, enabled')
    .then(({ data, error }) => {
      if (error) {
        console.warn('[featureFlags] failed to load flags:', error.message);
        _loadPromise = null;
        _cache = {};
        return {};
      }
      _cache = (data ?? []).reduce((acc, row) => {
        acc[row.key] = row.enabled;
        return acc;
      }, {});
      _loadPromise = null;
      return _cache;
    });

  return _loadPromise;
}

/**
 * Async helper for use outside React (lib functions, edge cases).
 * Falls back to false if the table is unreachable.
 *
 * @param {string} key  - flag key, e.g. 'syllabus_graph_enabled'
 * @returns {Promise<boolean>}
 */
export async function getFeatureFlag(key) {
  try {
    const flags = await _loadFlags();
    return flags[key] ?? false;
  } catch {
    return false;
  }
}

/**
 * Get multiple flags at once (avoids serial awaits).
 *
 * @param {string[]} keys
 * @returns {Promise<Record<string, boolean>>}
 */
export async function getFeatureFlags(keys) {
  try {
    const flags = await _loadFlags();
    return keys.reduce((acc, key) => {
      acc[key] = flags[key] ?? false;
      return acc;
    }, {});
  } catch {
    return keys.reduce((acc, key) => { acc[key] = false; return acc; }, {});
  }
}

/**
 * React hook — returns the flag value and a loading boolean.
 * Re-uses the same cache as getFeatureFlag().
 *
 * @param {string} key
 * @returns {{ value: boolean, loading: boolean }}
 */
export function useFeatureFlag(key) {
  const [value,   setValue]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getFeatureFlag(key).then((v) => {
      if (!cancelled) { setValue(v); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [key]);

  return { value, loading };
}

/**
 * React hook — returns all flags as a map.
 *
 * @returns {{ flags: Record<string, boolean>, loading: boolean }}
 */
export function useFeatureFlags() {
  const [flags,   setFlags]   = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    _loadFlags().then((f) => {
      if (!cancelled) { setFlags(f); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  return { flags, loading };
}

/**
 * Invalidate the in-memory cache so the next getFeatureFlag() call
 * re-fetches from DB. Call this after an admin changes a flag.
 */
export function invalidateFlagCache() {
  _cache = null;
  _loadPromise = null;
}

/** Convenience constants — use in JSX conditions without async */
export const FLAGS = {
  SYLLABUS_GRAPH:        'syllabus_graph_enabled',
  CONTENT_REVIEW_QUEUE:  'content_review_queue_enabled',
  CONTENT_VERSIONING:    'content_versioning_enabled',
  CENTRE_CONTENT_POOL:   'centre_content_pool_enabled',
  CENTRE_TEST_BUILDER:   'centre_test_builder_enabled',
  MISCONCEPTION_ENGINE:  'misconception_engine_enabled',
  ATOMIC_QUOTA_RPC:      'atomic_quota_rpc_enabled',
  DALLE_PROXY:           'dalle_proxy_enabled',
  CENTRE_INVITES:        'centre_invites_enabled',
  BLUEPRINT_V2:          'blueprint_v2_enabled',
  PAPER_MODE_V2:         'paper_mode_v2_enabled',
  MAINTENANCE_MODE:      'maintenance_mode_enabled',
  // Opt-OUT, unlike every flag above. Semantic answer verification protects the
  // student path from wrong answer keys, so it runs by default — and a missing
  // flag row reads as false, which keeps it on. Insert this key as `true` to
  // disable it without a deploy.
  ANSWER_VERIFICATION_OFF: 'answer_verification_off',
};
