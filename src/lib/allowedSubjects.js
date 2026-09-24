/**
 * Which exams and subjects this student may see and generate — decided by the
 * SERVER (allowed_subjects_for_caller, migration 20260925000000), never here.
 *
 * Every student-facing subject picker reads from this module, so an admin
 * hiding a subject for an exam (exam_categories.hidden_subjects), a subject
 * with no content, or an exam the student doesn't belong to disappears from
 * all of them at once. The server applies the same rules again when saving
 * (e.g. save_daily_challenge), so this list is a convenience, not the gate.
 *
 * Shape (one entry per exam context, competitive first):
 *   { exam_type, kind, subjects: string[], needs_setup: boolean, content_sources: string[] }
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

// One fetch per (uid + profile shape). A profile edit changes the key, so the
// next read refetches instead of serving a list for the old exam/class.
let cacheKey = null;
let cachePromise = null;

function keyFor(uid, profile) {
  return JSON.stringify([uid, profile?.target_exam, profile?.syllabus, profile?.class_level, profile?.subjects]);
}

export async function fetchAllowedSubjects(uid, profile) {
  if (!uid) return [];
  const key = keyFor(uid, profile);
  if (key !== cacheKey || !cachePromise) {
    cacheKey = key;
    cachePromise = supabase.rpc('allowed_subjects_for_caller', { p_uid: uid }).then(({ data, error }) => {
      if (error) {
        cacheKey = null;                       // don't cache a failure
        throw new Error(error.message);
      }
      return Array.isArray(data) ? data : [];
    });
  }
  return cachePromise;
}

/** Drop the cache — e.g. after an admin hides/shows a subject in this tab. */
export function invalidateAllowedSubjects() {
  cacheKey = null;
  cachePromise = null;
}

/** The entry for one exam, or null when the student has no such context. */
export function contextFor(contexts, examType) {
  return (contexts ?? []).find((c) => c.exam_type === examType) ?? null;
}

/** Keep only the subjects allowed for this exam, preserving the input order. */
export function filterAllowed(contexts, examType, subjects) {
  const ctx = contextFor(contexts, examType);
  if (!ctx || ctx.needs_setup) return [];
  return (subjects ?? []).filter((s) => ctx.subjects.includes(s));
}

/**
 * React hook: { contexts, loading, error }. `loading` is true until the first
 * answer arrives — callers must not render "no subjects" during it.
 */
export function useAllowedSubjects() {
  const { currentUser, userProfile } = useAuth();
  const uid = currentUser?.uid;
  const key = keyFor(uid, userProfile);
  const [state, setState] = useState({ contexts: [], loading: true, error: '' });

  useEffect(() => {
    let cancelled = false;
    if (!uid) { setState({ contexts: [], loading: false, error: '' }); return undefined; }
    setState((s) => ({ ...s, loading: true, error: '' }));
    fetchAllowedSubjects(uid, userProfile)
      .then((contexts) => { if (!cancelled) setState({ contexts, loading: false, error: '' }); })
      .catch((e) => { if (!cancelled) setState({ contexts: [], loading: false, error: e.message }); });
    return () => { cancelled = true; };
    // key captures every profile field the server's answer depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key]);

  return state;
}
