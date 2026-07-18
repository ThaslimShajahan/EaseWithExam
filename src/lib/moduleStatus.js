/**
 * Temporary module-level toggles for large features being paused/resumed during
 * active development — distinct from the DB-driven `feature_flags` system
 * (src/lib/featureFlags.js), which is for admin-toggleable runtime behavior.
 * These are plain build-time constants for "pause this whole area, resume later"
 * decisions, so they don't need a database round-trip or deploy coordination.
 */
export const COACHING_MODULE_ENABLED = false;
