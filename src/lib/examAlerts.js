/**
 * Exam Watch source scraping.
 *
 * This used to ask GPT-4o to "list all currently relevant notifications" for an
 * organisation, passing only its name/URL/category as TEXT — the page was never
 * fetched. That's model recall dressed up as scraping, and it produced
 * confidently-wrong rows: a 2026-08-08 run against CBSE returned "NEET UG 2024
 * Application Form Released ... apply through the official CBSE website", an
 * exam CBSE hasn't conducted since 2019, with 2023/2024 dates. The prompt's
 * "no hallucinations" instruction couldn't help — with no source material,
 * recall is all the model has.
 *
 * It now delegates to the `exam-scraper` edge function, which actually fetches
 * the page and refuses to call the model unless it has real content. The edge
 * function owns extraction, de-duplication and the insert (service role), so
 * this module just invokes it and surfaces a usable reason on failure.
 */

const FN_URL   = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exam-scraper`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Why a scrape produced nothing — shown to the admin instead of a silent zero,
// since "blocked" and "nothing new published" need very different responses.
const REASON_TEXT = {
  access_denied:    'Not authorised — admin sign-in required',
  url_required:     'Source has no URL',
  unreachable:      'Site unreachable (blocks external requests or is down)',
  http_error:       'Site refused the request',
  content_too_thin: 'Page had no readable content (JavaScript-rendered or bot-blocked)',
  blocked_page:     'Blocked by the site’s bot protection',
  error:            'Scrape failed',
};

export function describeScrapeFailure(result) {
  const base = REASON_TEXT[result?.reason] ?? 'Scrape failed';
  if (result?.reason === 'http_error' && result.status) return `${base} (HTTP ${result.status})`;
  return base;
}

/**
 * Scrape one monitored source.
 * @returns {Promise<{ ok: boolean, count: number, reason?: string, message?: string }>}
 *   Resolves either way — a blocked source is a normal outcome to report, not
 *   an exception to throw, since callers scrape a whole list in a loop.
 */
export async function fetchExamAlerts({ name, url, exam_category: category, id }, callerUid) {
  let res;
  try {
    res = await fetch(FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({
        url,
        examBody:   name,
        category,
        sourceId:   id,
        caller_uid: callerUid,
      }),
    });
  } catch (err) {
    return { ok: false, count: 0, reason: 'unreachable', message: err.message };
  }

  const data = await res.json().catch(() => ({}));
  if (!data.ok) return { ...data, ok: false, count: 0, message: describeScrapeFailure(data) };
  return { ok: true, count: data.count ?? 0, extracted: data.extracted ?? 0 };
}
