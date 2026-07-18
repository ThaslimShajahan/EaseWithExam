import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY         = Deno.env.get('OPENAI_API_KEY')!;

async function extractHtmlText(html: string): Promise<string> {
  // Strip scripts/styles/tags, collapse whitespace
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
    .slice(0, 8000);
}

async function callGpt(text: string, url: string, examBody: string): Promise<any[]> {
  const prompt = `You are parsing an Indian government exam notification website.

Website: ${url}
Organization: ${examBody}

Page content:
${text}

Extract ALL exam notifications, recruitment notices, application windows, admit card releases, result announcements, and syllabus updates.

For each item found, return:
- title: short title of the notification
- exam_name: specific exam name (e.g., "SSC CGL 2025", "IBPS PO XIV")
- notification_type: one of: "notification" | "application" | "admit_card" | "result" | "schedule" | "syllabus"
- description: 1-2 sentence description
- important_dates: object with any of these keys that are mentioned: { application_start, application_end, exam_date, admit_card_date, result_date, interview_date } — use "DD MMM YYYY" format or null
- source_url: "${url}"

Return JSON: { "notifications": [ ...array of objects... ] }
If no notifications found, return { "notifications": [] }`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert at parsing Indian government exam websites. Return only valid JSON.' },
        { role: 'user',   content: prompt },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
  const json  = await resp.json();
  const raw   = json.choices[0].message.content;
  const parsed = JSON.parse(raw);
  return parsed.notifications || [];
}

async function saveNotifications(notifications: any[], examBody: string, category: string) {
  if (!notifications.length) return;
  const rows = notifications.map((n) => ({
    exam_body:         examBody,
    exam_name:         n.exam_name  || n.title,
    notification_type: n.notification_type || 'notification',
    title:             n.title,
    description:       n.description || null,
    important_dates:   n.important_dates || {},
    source_url:        n.source_url || null,
    category,
  }));

  await fetch(`${SUPABASE_URL}/rest/v1/exam_notifications`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
}

async function updateSourceTimestamp(id: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/monitored_sources?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ last_scraped: new Date().toISOString() }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  try {
    const { url, examBody, category, sourceId } = await req.json();
    if (!url) return new Response(JSON.stringify({ error: 'url required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Fetch the page
    const pageResp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExamPilot-Bot/1.0)' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!pageResp.ok) {
      return new Response(JSON.stringify({ error: `Source returned ${pageResp.status}`, notifications: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const html   = await pageResp.text();
    const text   = await extractHtmlText(html);
    const notifications = await callGpt(text, url, examBody);

    await saveNotifications(notifications, examBody, category || 'General');
    if (sourceId) await updateSourceTimestamp(sourceId);

    return new Response(JSON.stringify({ notifications, count: notifications.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[exam-scraper]', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
