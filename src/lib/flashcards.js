import { supabase } from './supabase';
import { chatComplete } from './aiProxy';

const IST_DATE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/* ── Generate flashcards for a chapter via GPT-4o-mini ──────── */
export async function generateFlashcards(firebaseUid, chapter, examType, count = 10) {
  const prompt = `Generate ${count} concise flashcards for the chapter "${chapter.name}" (${chapter.subject}, ${examType}).
Each flashcard must test a distinct factual concept — definition, classification, formula, or mechanism.
Prioritise NCERT-level recall important for ${examType === 'NEET' ? 'NEET-UG biology/chemistry/physics MCQs' : 'JEE Main problem-solving'}.

Return a JSON object with a "cards" key containing an array of flashcard objects:
{
  "cards": [
    { "front": "What is the powerhouse of the cell?", "back": "Mitochondria — site of aerobic respiration (ATP synthesis via oxidative phosphorylation)" }
  ]
}`;

  const res = await chatComplete({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 1800,
    response_format: { type: 'json_object' },
  }, { feature: 'flashcards' });

  const raw = res.choices?.[0]?.message?.content || '{"cards":[]}';
  let cards;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cards = parsed;
    } else {
      cards = parsed.cards
        || parsed.flashcards
        || parsed.data
        || parsed.items
        || parsed.results
        || Object.values(parsed).find(v => Array.isArray(v))
        || [];
    }
  } catch { cards = []; }

  if (!cards.length) throw new Error('AI returned no flashcards');

  const rows = cards
    .filter(c => c.front && c.back)
    .slice(0, count)
    .map(c => ({
      exam_type:    examType,
      subject:      chapter.subject,
      chapter_key:  chapter.key,
      chapter_name: chapter.name,
      front:        c.front.trim(),
      back:         c.back.trim(),
    }));

  // Delete existing for this chapter first, then insert fresh set (both via SECURITY DEFINER RPC)
  await supabase.rpc('delete_chapter_flashcards', { p_uid: firebaseUid, p_chapter_key: chapter.key });

  const { data, error } = await supabase.rpc('insert_flashcards', {
    p_uid:   firebaseUid,
    p_cards: JSON.stringify(rows),
  });
  if (error) throw error;
  return data ?? [];
}

/* ── Fetch flashcards for a chapter ────────────────────────── */
export async function getFlashcards(firebaseUid, chapterKey) {
  const { data, error } = await supabase.rpc('get_user_flashcards', {
    p_uid:         firebaseUid,
    p_chapter_key: chapterKey,
  });
  if (error) throw error;
  return data ?? [];
}

/* ── Get all chapters that have flashcards ──────────────────── */
export async function getFlashcardSummary(firebaseUid) {
  const { data, error } = await supabase.rpc('get_flashcard_summary', { p_uid: firebaseUid });
  if (error) throw error;
  return data ?? [];
}

/* ── Grade a card review (SM-2) ──────────────────────────────
   grade: 1=again (forgot), 3=hard, 4=good, 5=easy — same scale as the
   Error Notebook's recordReview(). Returns the card's new SRS state. */
export async function reviewFlashcard(firebaseUid, id, grade) {
  const { data, error } = await supabase.rpc('review_flashcard', {
    p_uid:   firebaseUid,
    p_id:    id,
    p_grade: grade,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}
