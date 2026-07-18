import { supabase } from './supabase';
import { chatComplete } from './aiProxy';

const CURRENT_YEAR = new Date().getFullYear();

/* Ask GPT-4o for known notifications for a given exam body */
export async function fetchExamAlerts({ name, url, exam_category: category, id }) {
  const prompt = `You are an expert on Indian competitive exam schedules and official notifications for ${CURRENT_YEAR}.

Organisation: ${name}
Website: ${url}
Category: ${category}

List ALL currently relevant notifications, announcements, and important dates from this organisation.
Include any of:
- Application form open/close windows
- Exam dates (upcoming or recently announced)
- Admit card release dates
- Result announcements
- Counselling schedules
- New exam/recruitment notifications
- Syllabus or pattern changes

Be specific and accurate. Include only real, known events — no hallucinations.

Return ONLY valid JSON in this exact shape:
{
  "notifications": [
    {
      "title": "Brief notification headline",
      "exam_name": "Full exam name e.g. NEET UG 2025",
      "notification_type": "notification | application | admit_card | result | schedule | syllabus",
      "description": "1-2 sentence summary of what this notification means for students",
      "important_dates": {
        "application_start":  "DD MMM YYYY or null",
        "application_end":    "DD MMM YYYY or null",
        "exam_date":          "DD MMM YYYY or null",
        "admit_card_date":    "DD MMM YYYY or null",
        "result_date":        "DD MMM YYYY or null",
        "counselling_date":   "DD MMM YYYY or null"
      },
      "source_url": "${url}"
    }
  ]
}`;

  const res = await chatComplete({
    model: 'gpt-4o',
    max_tokens: 2500,
    temperature: 0.05,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a precise factual assistant. Return only valid JSON with real Indian competitive exam notification data. Never invent dates.' },
      { role: 'user',   content: prompt },
    ],
  });

  const raw  = res.choices[0].message.content;
  const data = JSON.parse(raw);
  const items = data.notifications || [];

  if (!items.length) return 0;

  // Deduplicate against existing titles before inserting
  const { data: existing } = await supabase
    .from('exam_notifications')
    .select('title')
    .eq('exam_body', name);

  const existingTitles = new Set((existing || []).map((r) => r.title?.toLowerCase()));

  const rows = items
    .filter((n) => n.title && !existingTitles.has(n.title.toLowerCase()))
    .map((n) => ({
      exam_body:         name,
      exam_name:         n.exam_name || n.title,
      notification_type: n.notification_type || 'notification',
      title:             n.title,
      description:       n.description || null,
      important_dates:   n.important_dates || {},
      source_url:        n.source_url || url,
      category:          category || 'General',
      is_active:         true,
    }));

  if (!rows.length) return 0;

  const { error } = await supabase.from('exam_notifications').insert(rows);
  if (error) throw error;

  // Update last_scraped on the monitored_sources row
  if (id) {
    await supabase
      .from('monitored_sources')
      .update({ last_scraped: new Date().toISOString() })
      .eq('id', id);
  }

  return rows.length;
}
