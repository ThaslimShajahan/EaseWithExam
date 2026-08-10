/**
 * Runs full-paper AI generation in the background instead of blocking the
 * student on a modal — fire-and-forget from the triggering component, not
 * tied to any component's mount lifecycle, so navigating away no longer
 * loses or (per the previous batch's fix) cancels the generation. On
 * completion, notifies the student in-app and via push (reusing the
 * existing notification infra) rather than requiring them to sit and wait.
 *
 * Scope note: this is "background" within the same browser tab/session —
 * a plain client-side SPA has no way to keep running after the tab itself
 * is closed (no service-worker background sync is wired up). Navigating
 * to another page or route within the app is fully supported; closing the
 * tab mid-generation still loses it, same as it always would have.
 */

import { generateQuestionPaper, toEngineFormat } from './questionGen';
import { verifyQuestions } from './answerVerification';
import { publishTest } from './supabase';
import { incrementQuota } from './quota';
import { createNotification, getNotificationPrefs } from './notifications';
import { sendTransactionalEmail } from './email';

// Prevents the same student from starting a second background generation
// while one is already running (e.g. reopening the modal and hitting
// Generate again before the first finishes) — module-level, resets on tab
// close/reload, which is fine since a fresh generation is legitimate then.
const inFlight = new Set();

export function isGenerationInFlight(firebaseUid) {
  return inFlight.has(firebaseUid);
}

export async function startBackgroundPaperGeneration({
  firebaseUid, subject, topics, examType, difficulty, count, qTypes, durationMinutes,
}) {
  if (inFlight.has(firebaseUid)) {
    throw new Error('A paper is already generating — wait for it to finish first.');
  }
  inFlight.add(firebaseUid);

  try {
    const raw = await generateQuestionPaper({
      subject, topics, examType, difficulty, count, qTypes,
      rotationSlot: Math.floor(Math.random() * 5),
      // Deliberately no AbortSignal here — unlike the blocking-modal flow
      // this replaces, navigating away is now the expected, supported
      // path, not an abandonment signal.
    });
    const engineQs = toEngineFormat(raw?.questions ?? raw, subject, examType);

    // This is a STUDENT path — it publishes straight to the student and the
    // result scores them and writes weak_topics accuracy — but it was never
    // filtering needs_review, so it served questions the blocking flow in
    // PracticeGeneratorPage has withheld since session 17. Same treatment here:
    // verify, then drop anything either check distrusts.
    const { questions: checked } = await verifyQuestions(engineQs);
    const formatted = checked.filter((q) => !q.needs_review);
    if (!formatted.length) throw new Error('No questions returned. Try different settings.');

    const published = await publishTest({
      title:           `${examType} · ${subject} · ${difficulty}`,
      subject, examType, difficulty,
      questions:       formatted,
      durationMinutes,
      createdBy:       'student',
      userId:          firebaseUid,
    });

    incrementQuota(firebaseUid, 'paper_generations_used').catch(() => {});

    // Tell any open Exam Center to refetch. Generation is fire-and-forget and
    // can finish while that page is already mounted, in which case the new
    // paper wouldn't show up until a manual reload. A plain window event keeps
    // this decoupled, same pattern as 'ewe:quota-updated'.
    try { window.dispatchEvent(new CustomEvent('ewe:paper-ready', { detail: { examType, subject } })); } catch { /* non-browser */ }

    const link = '/exams?tab=papers';
    await createNotification(
      firebaseUid,
      'paper_ready',
      'Your paper is ready! 📝',
      `${examType} · ${subject} · ${formatted.length} questions — tap to start.`,
      link,
    ).catch(() => {});
    sendPaperReadyPush(firebaseUid, formatted.length, examType, subject, link).catch(() => {});
    sendTransactionalEmail(firebaseUid, 'paper_ready', {
      examType, subject, questionCount: formatted.length, link,
    });

    return published;
  } catch (e) {
    await createNotification(
      firebaseUid,
      'paper_failed',
      'Paper generation failed',
      e.message || 'Something went wrong generating your paper. Try again from Exam Mode.',
      '/exams?tab=papers',
    ).catch(() => {});
    throw e;
  } finally {
    inFlight.delete(firebaseUid);
  }
}

async function sendPaperReadyPush(firebaseUid, questionCount, examType, subject, link) {
  // Skip the edge-function round trip entirely if the student never
  // enabled push — avoids a pointless network call on every generation.
  const prefs = await getNotificationPrefs(firebaseUid).catch(() => null);
  if (!prefs?.push_enabled) return;

  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    body: JSON.stringify({
      caller_uid: firebaseUid,
      user_id:    firebaseUid,
      title:      'Your paper is ready! 📝',
      body:       `${examType} · ${subject} · ${questionCount} questions — tap to start.`,
      url:        link,
    }),
  }).catch(() => {});
}
