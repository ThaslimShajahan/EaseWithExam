import { supabase } from './supabase';
import { chatComplete } from './aiProxy';

// IST calendar date — avoids UTC midnight triggering wrong day in India
const todayKey = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/* ── Fetch today's challenge for a user ───────────────────── */
export async function getTodayChallenge(firebaseUid) {
  const today = todayKey();

  /* 1. Try user-specific challenge */
  const { data: userRow } = await supabase
    .from('daily_challenges')
    .select('*')
    .eq('user_id', firebaseUid)
    .eq('challenge_date', today)
    .maybeSingle();

  if (userRow) return userRow;

  /* 2. Fall back to global challenge for today */
  const { data: globalRow } = await supabase
    .from('daily_challenges')
    .select('*')
    .is('user_id', null)
    .eq('challenge_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return globalRow ?? null;
}

/* ── Save answer attempt ──────────────────────────────────── */
export async function saveChallengeAnswer(challengeId, firebaseUid, selectedOption, isCorrect) {
  await supabase.from('daily_challenge_attempts').upsert({
    challenge_id:    challengeId,
    user_id:         firebaseUid,
    selected_option: selectedOption,
    is_correct:      isCorrect,
  }, { onConflict: 'challenge_id,user_id' });
}

/* ── Get today's attempt by this user ─────────────────────── */
export async function getTodayAttempt(challengeId, firebaseUid) {
  if (!challengeId || !firebaseUid) return null;
  const { data } = await supabase
    .from('daily_challenge_attempts')
    .select('selected_option, is_correct')
    .eq('challenge_id', challengeId)
    .eq('user_id', firebaseUid)
    .maybeSingle();
  return data ?? null;
}

/* ── Fetch recently seen challenge topics for this user ──── */
async function getRecentTopics(userId) {
  if (!userId) return [];
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.rpc('get_recent_challenge_topics', { p_uid: userId, p_cutoff: cutoff });
    return (data ?? []).map(r => `${r.subject}: ${r.topic}`);
  } catch { return []; }
}

async function recordChallengeHistory(userId, subject, topic) {
  if (!userId) return;
  try {
    await supabase.rpc('upsert_challenge_history', {
      p_uid:     userId,
      p_subject: subject,
      p_topic:   topic,
      p_date:    todayKey(),
    });
  } catch { /* non-critical */ }
}

/* ── Generate a 5-question mini paper ────────────────────── */
export async function generateDailyChallenge({ examType = 'NEET', subject, userId = null } = {}) {
  const today = todayKey();
  const subList = subject ? [subject] : (
    examType === 'NEET'     ? ['Biology', 'Physics', 'Chemistry'] :
    examType === 'JEE Main' ? ['Physics', 'Chemistry', 'Mathematics'] :
    examType.includes('Class') || examType.includes('CBSE')
      ? ['Physics', 'Chemistry', 'Mathematics', 'Biology'] :
    ['Mathematics', 'Science', 'English']
  );
  const chosenSubject = subList[Math.floor(Math.random() * subList.length)];

  const recentTopics = await getRecentTopics(userId);
  const avoidHint = recentTopics.length > 0
    ? `\n\nAVOID repeating these recently used topics: ${recentTopics.join('; ')}. Pick a DIFFERENT chapter.`
    : '';

  const prompt = `Generate a 5-question daily mini test for ${examType} — subject: ${chosenSubject}.${avoidHint}
Mix question types:
- Q1, Q2, Q3: MCQ (single correct, 4 options A/B/C/D)
- Q4: Assertion-Reason (options exactly: A: Both A&R true and R is correct explanation; B: Both true but R is not correct explanation; C: A is true R is false; D: A is false)
- Q5: Numerical (integer/decimal answer, opts must be [])

All questions must be based on NCERT syllabus, realistic ${examType} difficulty. Use $...$ for LaTeX.

Return ONLY valid JSON:
{
  "chapter": "Primary chapter name",
  "questions": [
    {
      "type": "MCQ",
      "q": "Question text",
      "opts": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "Why B is correct"
    },
    {
      "type": "Assertion-Reason",
      "q": "Assertion (A): ...\\nReason (R): ...",
      "opts": ["A. Both A and R are true and R is the correct explanation of A", "B. Both A and R are true but R is not the correct explanation of A", "C. A is true but R is false", "D. A is false but R is true"],
      "answer": "A",
      "explanation": "..."
    },
    {
      "type": "Numerical",
      "q": "Question text requiring a numeric answer",
      "opts": [],
      "answer": "42",
      "explanation": "..."
    }
  ]
}`;

  const resp = await chatComplete({
    model:           'gpt-4o',
    max_tokens:      2000,
    temperature:     0.6,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert exam question setter. Return only valid JSON.' },
      { role: 'user',   content: prompt },
    ],
  });

  const raw = JSON.parse(resp.choices[0].message.content);

  // Store questions array in options field; mark with sentinel correct_answer="paper"
  const row = {
    user_id:        userId,
    challenge_date: today,
    exam_type:      examType,
    subject:        chosenSubject,
    question:       `Daily ${examType} · ${chosenSubject} · ${raw.chapter || 'Mixed'}`,
    options:        raw.questions || [],   // JSONB array of question objects
    correct_answer: 'paper',              // sentinel: tells UI this is a mini paper
    explanation:    '',
    chapter:        raw.chapter || chosenSubject,
  };

  const { data, error } = await supabase
    .from('daily_challenges')
    .insert(row)
    .select()
    .single();

  if (error) throw error;

  // Track topic to avoid repetition in future challenges
  recordChallengeHistory(userId, chosenSubject, raw.chapter || chosenSubject);

  return data;
}

/* ── SQL migration (run once in Supabase) ─────────────────── */
export const DAILY_CHALLENGE_SQL = `
-- Daily challenges table
CREATE TABLE IF NOT EXISTS daily_challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text,              -- null = global challenge
  challenge_date date NOT NULL,
  exam_type      text,
  subject        text,
  question       text NOT NULL,
  options        jsonb,
  correct_answer text,
  explanation    text,
  chapter        text,
  difficulty     text DEFAULT 'Medium',
  created_at     timestamptz DEFAULT now()
);

-- Attempts table
CREATE TABLE IF NOT EXISTS daily_challenge_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    uuid REFERENCES daily_challenges(id),
  user_id         text NOT NULL,
  selected_option text,
  is_correct      boolean,
  attempted_at    timestamptz DEFAULT now(),
  UNIQUE(challenge_id, user_id)
);

-- Enable RLS
ALTER TABLE daily_challenges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenge_attempts ENABLE ROW LEVEL SECURITY;

-- Allow anon read (public daily challenge)
CREATE POLICY "read daily challenges" ON daily_challenges FOR SELECT USING (true);
CREATE POLICY "insert daily challenges" ON daily_challenges FOR INSERT WITH CHECK (true);
CREATE POLICY "read attempts" ON daily_challenge_attempts FOR SELECT USING (true);
CREATE POLICY "upsert attempts" ON daily_challenge_attempts FOR INSERT WITH CHECK (true);
CREATE POLICY "update attempts" ON daily_challenge_attempts FOR UPDATE USING (true);
`;
