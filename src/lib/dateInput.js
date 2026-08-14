/**
 * A stored UTC instant -> the local-time string a
 * <input type="datetime-local"> expects.
 *
 * Extracted from AdminStudents.jsx (2026-08-14) rather than left inline, after
 * a second admin screen (AdminQuota.jsx's override form) needed the identical
 * conversion for the identical reason: a datetime-local input displays and
 * PARSES its value as local wall-clock time with no timezone marker, so
 * `date.toISOString()` (UTC) is the wrong conversion. It silently shifts the
 * displayed time by the viewer's UTC offset (5.5h for IST) and, if the field
 * is re-saved untouched, shifts the REAL stored value by the same amount,
 * since a save handler round-trips whatever string is in the field back
 * through `new Date(str).toISOString()`. Subtracting the timezone offset
 * before formatting is what makes that round-trip actually be a round-trip.
 *
 * One shared implementation because two independent copies is exactly how
 * this class of bug drifts apart unnoticed — the whole reason it is a
 * function here instead of being retyped a second time.
 */
export function toLocalInputValue(date) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
