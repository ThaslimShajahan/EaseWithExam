// Supabase Edge Function — exam notification scraper
//
// Fetches a monitored source's page, extracts its text, and asks the model to
// pull out ONLY what that text actually contains.
//
// WHY THE GUARDS BELOW EXIST: the admin "Exam Watch" screen used to call
// src/lib/examAlerts.js, which never fetched the page at all — it asked GPT-4o
// to "list all currently relevant notifications" for an organisation given
// only its name and URL as text. That is model recall, not scraping, and it
// produced confidently-wrong rows: on a 2026-08-08 run against CBSE it
// returned "NEET UG 2024 Application Form Released ... apply through the
// official CBSE website" — an exam CBSE has not conducted since 2019, with
// 2023/2024 dates. The client now calls this function instead, and this
// function refuses to invoke the model unless it genuinely has page content.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY       = Deno.env.get('OPENAI_API_KEY')!;

// Below this, the page is a redirect stub, a bot-block page, or nav-only
// chrome — never enough to extract a real notification from. A genuine
// notice board runs to thousands of characters.
const MIN_CONTENT_CHARS = 500;

// Bot-block / error pages that return HTTP 200 with an error body, so the
// status check alone doesn't catch them.
const ERROR_PAGE_RE =
  /access denied|forbidden|not authorized|unauthorized|captcha|are you a human|cloudflare|request blocked|error 4\d\d|error 5\d\d|page not found/i;

function extractHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000);
}

async function isAdmin(uid: string): Promise<boolean> {
  if (!uid) return false;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/admins?select=role&uid=eq.${encodeURIComponent(uid)}&is_active=eq.true`,
    { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY } },
  );
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.some((x: any) => x.role === 'admin' || x.role === 'superadmin');
}

async function callGpt(text: string, url: string, examBody: string): Promise<any[]> {
  const prompt = `Below is the extracted text of a web page from an Indian exam/education organisation.

Website: ${url}
Organisation: ${examBody}

--- PAGE CONTENT START ---
${text}
--- PAGE CONTENT END ---

Extract every exam notification, application window, admit card release, result
announcement, counselling schedule or syllabus update that is EXPLICITLY PRESENT
in the page content above.

CRITICAL RULES:
- Use ONLY the page content above. Do NOT use prior knowledge, memory, or
  anything you know about this organisation from training data.
- Every title, exam name and date you return must be traceable to specific text
  in the content above. If a date is not written there, use null.
- If the content is an error page, access-denied notice, navigation menu, or
  otherwise contains no actual notifications, return an empty array. An empty
  result is correct and expected — do not fill it in to be helpful.

For each item return: title, exam_name, notification_type
("notification" | "application" | "admit_card" | "result" | "schedule" | "syllabus"),
description (1-2 sentences), important_dates (object with any of
application_start, application_end, exam_date, admit_card_date, result_date,
interview_date in "DD MMM YYYY" format, or null), and source_url: "${url}".

Return JSON: { "notifications": [ ... ] }`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract structured data from supplied web page text. You never add information that is not present in the text you are given. Returning an empty result is always preferable to guessing.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
  const json = await resp.json();
  const parsed = JSON.parse(json.choices[0].message.content);
  return Array.isArray(parsed.notifications) ? parsed.notifications : [];
}

async function saveNotifications(notifications: any[], examBody: string, category: string, url: string) {
  if (!notifications.length) return 0;

  // Dedupe against titles already stored for this source, so re-scraping the
  // same unchanged page doesn't pile up duplicates.
  const existingResp = await fetch(
    `${SUPABASE_URL}/rest/v1/exam_notifications?select=title&exam_body=eq.${encodeURIComponent(examBody)}`,
    { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY } },
  );
  const existing: any[] = existingResp.ok ? await existingResp.json() : [];
  const seen = new Set(existing.map((r) => String(r.title || '').toLowerCase().trim()));

  const rows = notifications
    .filter((n) => n?.title && !seen.has(String(n.title).toLowerCase().trim()))
    .map((n) => ({
      exam_body:         examBody,
      exam_name:         n.exam_name || n.title,
      notification_type: n.notification_type || 'notification',
      title:             n.title,
      description:       n.description || null,
      important_dates:   n.important_dates || {},
      source_url:        n.source_url || url,
      category,
      is_active:         true,
    }));

  if (!rows.length) return 0;

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/exam_notifications`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error(`Insert failed: ${ins.status} ${await ins.text()}`);
  return rows.length;
}

async function updateSourceTimestamp(id: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/monitored_sources?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ last_scraped: new Date().toISOString() }),
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    const { url, examBody, category, sourceId, caller_uid } = await req.json();

    // This endpoint spends real money on gpt-4o per call and runs with
    // verify_jwt disabled, so it needs its own caller check — same
    // admins-table pattern as the rest of the admin surface.
    if (!(await isAdmin(caller_uid))) return json({ ok: false, reason: 'access_denied' }, 403);
    if (!url) return json({ ok: false, reason: 'url_required' }, 400);

    let pageResp: Response;
    try {
      pageResp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ExamPilot-Bot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      // DNS failure / TLS error / timeout — several .nic.in hosts refuse
      // connections from outside India entirely.
      return json({ ok: false, reason: 'unreachable', detail: String((e as Error).message), count: 0 });
    }

    if (!pageResp.ok) {
      return json({ ok: false, reason: 'http_error', status: pageResp.status, count: 0 });
    }

    const text = extractHtmlText(await pageResp.text());

    // The two guards that actually prevent fabrication: never hand the model
    // an error stub or a nav-only page and ask it for notifications.
    if (text.length < MIN_CONTENT_CHARS) {
      return json({ ok: false, reason: 'content_too_thin', chars: text.length, count: 0 });
    }
    if (text.length < 2000 && ERROR_PAGE_RE.test(text)) {
      return json({ ok: false, reason: 'blocked_page', chars: text.length, count: 0 });
    }

    const notifications = await callGpt(text, url, examBody);
    const saved = await saveNotifications(notifications, examBody, category || 'General', url);

    // Only stamp last_scraped on a genuine successful read, so a permanently
    // blocked source keeps showing as stale instead of looking healthy.
    if (sourceId) await updateSourceTimestamp(sourceId);

    return json({ ok: true, count: saved, extracted: notifications.length, chars: text.length });
  } catch (err) {
    console.error('[exam-scraper]', err);
    return json({ ok: false, reason: 'error', detail: (err as Error).message }, 500);
  }
});
