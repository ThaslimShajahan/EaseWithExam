import { supabase } from './supabase';
import { getTopicFrequency } from './supabase';
import { chatComplete, embedText } from './aiProxy';
import { getFeatureFlag, FLAGS } from './featureFlags';
import { getChapters } from './syllabus';

/* ── Convert GPT output → MockTestEngine question format ─── */
const LETTER_IDX = { A: 0, B: 1, C: 2, D: 3 };

/* Exams that use per-question integer marks with no negative marking */
const CBSE_STYLE_EXAMS = new Set([
  'CBSE', 'ICSE', 'State Board',
  'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12',
  'CBSE Class 8', 'CBSE Class 9', 'CBSE Class 10', 'CBSE Class 11', 'CBSE Class 12',
  'ICSE Class 8', 'ICSE Class 9', 'ICSE Class 10', 'ICSE Class 11', 'ICSE Class 12',
  'State Board Class 8', 'State Board Class 9', 'State Board Class 10',
  'State Board Class 11', 'State Board Class 12',
]);

/* Resolve board+class combos ("CBSE Class 10") to their pattern key ("Class 10") */
function resolvePatternKey(examType) {
  if (PAPER_PATTERNS?.[examType]) return examType;
  const m = examType.match(/^(?:CBSE|ICSE|State Board) (Class \d+)$/);
  return m ? m[1] : examType;
}

/* Derive marks for AI-generated CBSE questions when the AI returned a section */
function cbseMarksForSection(section, type) {
  if (section === 'A' || type === 'MCQ' || type === 'Assertion-Reason') return 1;
  if (section === 'B') return 2;
  if (section === 'C' || type === 'Short Answer') return 3;
  if (section === 'D' || section === 'E' || type === 'Long Answer') return 5;
  return 1; // default
}

export function toEngineFormat(questionsInput, subject, examType = 'NEET') {
  // generateQuestionPaper() returns { questions, meta, ... }, not a bare array — accept
  // either shape here instead of requiring every caller to remember to unwrap it (one
  // caller didn't, which is exactly what threw "questions.filter is not a function").
  const questions = Array.isArray(questionsInput)
    ? questionsInput
    : (questionsInput?.questions ?? []);

  const year      = new Date().getFullYear();
  const batchId   = Date.now().toString(36);
  const isCBSE    = CBSE_STYLE_EXAMS.has(examType);

  const DESCRIPTIVE_TYPES = new Set(['Short Answer', 'Long Answer']);

  return questions
    .filter((q) => {
      if (!q.question) return false;
      if (q.type === 'Numerical') return true;
      if (DESCRIPTIVE_TYPES.has(q.type)) return true;
      return Array.isArray(q.options) && q.options.length >= 2;
    })
    .map((q, i) => {
      const type         = q.type || 'MCQ';
      const isNumerical  = type === 'Numerical';
      const isDescr      = DESCRIPTIVE_TYPES.has(type);
      const section      = q.section || null;

      // Marks: explicit field wins; otherwise infer from exam style
      let marks;
      if (typeof q.marks === 'number') {
        marks = q.marks;  // explicit integer from PDF extract or AI
      } else if (isCBSE) {
        marks = cbseMarksForSection(section, type);  // CBSE: 1/2/3/5, no negative
      } else {
        marks = { correct: 4, incorrect: isNumerical ? 0 : -1 };  // NTA: +4/-1
      }

      return {
        id:                  `${batchId}-${String(i + 1).padStart(4, '0')}`,
        type,
        subject,
        chapter:             q.chapter || q.topic || null,
        topic:               q.chapter || q.topic || 'AI Generated',
        section,
        difficulty:          q.difficulty || 'medium',
        question:            q.question,
        diagram_description: q.diagram_description || null,
        image_url:           q.image_url || null,
        columnI:             q.columnI  || null,
        columnII:            q.columnII || null,
        options:             isNumerical || isDescr ? null : (q.options || []).map((o) => o.replace(/^[A-D]\.\s*/, '')),
        correctOption:       isNumerical || isDescr ? null : (LETTER_IDX[String(q.answer ?? '').toUpperCase().charAt(0)] ?? 0),
        correctAnswer:       isNumerical ? String(q.answer ?? '') : null,
        explanation:         q.explanation || '',
        marks,
        year:                q.year || year,
      };
    });
}


/* ── NEET / JEE paper patterns (strict) ──────────────────── */
export const PAPER_PATTERNS = {
  'NEET': {
    label: 'NEET-UG',
    totalQ: 180, duration: 200, totalMarks: 720,
    marking: { correct: 4, wrong: -1, skipped: 0 },
    sections: {
      Physics:   { total: 45, secA: 35, secB_total: 15, secB_attempt: 10 },
      Chemistry: { total: 45, secA: 35, secB_total: 15, secB_attempt: 10 },
      Botany:    { total: 45, secA: 35, secB_total: 15, secB_attempt: 10 },
      Zoology:   { total: 45, secA: 35, secB_total: 15, secB_attempt: 10 },
    },
    questionStyle: `
NEET STRICT PAPER PATTERN (2019-2024 trend):
- Section A: 35 MCQs (all compulsory, single correct answer)
- Section B: 15 MCQs (attempt any 10; extra attempts = last 5 ignored)
- Marking: +4 correct, -1 wrong, 0 skipped
- 65% questions are direct NCERT-based (Class 11+12)
- 25% are application/reasoning (based on NCERT concepts)
- 10% are HOTS (Higher Order Thinking — multi-step, assertion-reason)
- 10-15% of questions MUST be diagram-based: include a "diagram_description" field describing the figure (e.g. "A schematic of the human nephron with parts A, B, C, D labelled")
- Biology dominates (90/180 Q): focus on factual recall, classification, definitions
- Physics/Chemistry: mostly formula application, reaction mechanisms, unit conversions
- Commonly tested chapters in Biology (NEET top PYQ): Cell division, Genetics, Photosynthesis, Human Physiology (digestion, respiration, neural), Evolution, Biotechnology, Ecosystem
- Commonly tested in Physics: Laws of Motion, Work-Energy, Electrostatics, Modern Physics, Ray Optics, SHM
- Commonly tested in Chemistry: p-block, d-block, Chemical Bonding, Organic Reactions, Thermodynamics, Electrochemistry`,
  },
  'JEE Main': {
    label: 'JEE Main',
    totalQ: 90, duration: 180, totalMarks: 300,
    marking: { MCQ: { correct: 4, wrong: -1 }, Numerical: { correct: 4, wrong: 0 } },
    sections: {
      Physics:     { MCQ: 20, Numerical: 10, numericalAttempt: 5 },
      Chemistry:   { MCQ: 20, Numerical: 10, numericalAttempt: 5 },
      Mathematics: { MCQ: 20, Numerical: 10, numericalAttempt: 5 },
    },
    questionStyle: `
JEE MAIN STRICT PAPER PATTERN (2019-2024 trend):
- 20 MCQs (single correct, +4/-1) + 10 Numerical (integer/decimal, attempt any 5, +4/0)
- Total effective: 25 questions per subject (20 MCQ + 5 Numerical)
- Difficulty: 30% Easy, 50% Medium, 20% Hard
- MCQ: 4 options (A/B/C/D), exactly one correct
- Numerical: answer is a non-negative integer (0-9) or decimal rounded to 2 places
- Topics heavily tested in Physics: Kinematics, NLM, WEP, Rotational Motion, Current Electricity, Magnetism, Wave Optics, Modern Physics, Thermodynamics
- Chemistry: Mole Concept, Chemical Equilibrium, Electrochemistry, p/d-block, Organic (GOC, Hydrocarbons, Functional groups), Polymers, Coordination
- Math: Calculus (limits, derivatives, integrals), Algebra (complex numbers, matrices, sequences), Coordinate Geometry, Probability, Trigonometry`,
  },
  'JEE Advanced': {
    label: 'JEE Advanced',
    totalQ: 54, duration: 180, totalMarks: 180, // per paper; 2 papers total
    marking: { varies: true },
    questionStyle: `
JEE ADVANCED STRICT PAPER PATTERN (2024):
Paper 1 (per subject):
- Section 1: 4 MCQs, single correct, +3/-1
- Section 2: 4 MCQs, one or more correct, +4 full/+3 partial/-2 wrong/0 unattempted
- Section 3: 6 Single-digit non-negative integer answers, +3/0
- Section 4: 4 Match-list questions (4×4 matrix), single correct option, +3/-1

Paper 2 (per subject):
- Section 1: 4 MCQs, only one correct, +3/-1
- Section 2: 3 Paragraphs with 2 MCQs each (6 total), one correct, +3/0
- Section 3: 4 MCQs, one or more correct, +4 partial/-2
- Section 4: 4 Match-list, single correct, +3/-1

Key notes:
- Questions test deep conceptual understanding, not formula application
- Paragraph/comprehension questions are common
- Multi-correct MCQs require all correct options to be selected for full marks
- NEVER include trivial NCERT-recall questions — all questions should require multi-step reasoning`,
  },
  'CBSE': {
    label: 'CBSE Board (Class 12)',
    totalQ: 33, duration: 180, totalMarks: 70,
    marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5, 'Section E': 5 },
    sections: {
      'Section A (MCQ)':        { count: 16, marks: 1 },
      'Section B (VSA-I)':      { count: 5,  marks: 2 },
      'Section C (SA-II)':      { count: 7,  marks: 3 },
      'Section D (LA)':         { count: 2,  marks: 5 },
      'Section E (Case-Based)': { count: 3,  marks: 5 },
    },
    questionStyle: `
CBSE CLASS 12 BOARD EXACT PAPER PATTERN (2025-26, Subject Code 043/042/041):

SECTION A (Q.1–16) — 16 MCQs, 1 mark each, NO negative marking
- Direct recall, definition-based, one-line answer
- One correct option from A/B/C/D
- Based strictly on NCERT textbook lines
- Examples: identify the correct formula, name the compound, fill in the blank type

SECTION B (Q.17–21) — 5 Short Answer-I, 2 marks each
- Expected answer: 2–3 lines / 2–3 steps
- May have internal choice (OR) in one question
- Examples: define with example, state two differences, write the IUPAC name, give two reasons

SECTION C (Q.22–28) — 7 Short Answer-II, 3 marks each
- Expected answer: 4–5 lines or a solved numerical with 3 steps
- May have internal choice (OR) in two questions
- Examples: derive an expression, solve a 3-step numerical, explain with mechanism, compare two concepts

SECTION D (Q.29–30) — 2 Long Answer, 5 marks each, ALWAYS has internal choice (OR)
- Expected answer: detailed explanation, multi-step derivation, or comprehensive comparison
- Sub-parts carry combined marks (e.g. 2+3 or 3+2)
- Examples: explain the whole mechanism of a reaction, derive + apply a formula, compare industrial processes

SECTION E (Q.31–33) — 3 Case-Based / Competency Questions, 5 marks each
- Each question has a short passage/scenario followed by 3–4 sub-questions (a, b, c, d)
- Sub-questions carry marks like 1+1+2+1 or 1+2+2
- Tests application, analysis and understanding of NCERT concepts in real-world context
- NOT direct recall — requires interpreting data, applying concepts to new situations

STRICT RULES:
- All questions from NCERT Class 11 + Class 12 syllabus ONLY
- No negative marking for any section
- For OR questions: provide both the main question AND the OR alternative
- Diagrams: describe in text what the diagram should show (no images)
- Numerical problems: use SI units, show formula → substitution → answer format
- Equations/formulas: always use LaTeX ($...$) for expressions, reactions, structures`,
  },
  'Class 8': {
    label: 'CBSE Class 8',
    totalQ: 39, duration: 180, totalMarks: 80,
    marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5 },
    sections: {
      'Section A (MCQ)': { count: 10, marks: 1 },
      'Section B (VSA)': { count: 12, marks: 2 },
      'Section C (SA)':  { count: 7,  marks: 3 },
      'Section D (LA)':  { count: 5,  marks: 5 },
    },
    questionStyle: `
CBSE CLASS 8 PAPER PATTERN (as per sample paper template — 80 marks, 3 hours):

SECTION A (Q.1, sub-parts a–j) — 10 MCQs, 1 mark each = 10 marks
- All compulsory, single correct option (a/b/c/d)
- Direct recall and concept-based from NCERT Class 8 syllabus
- Examples: identify property used, which value satisfies, fill in the blank type
- No negative marking

SECTION B (Q.11–Q.22 approx) — 12 Very Short Answers, 2 marks each = 24 marks
- Expected answer: 2–3 lines or 2-step calculation
- Examples: find the value, state one difference, write one example, 2-step word problem
- No negative marking

SECTION C (Q.23–Q.29 approx) — 7 Short Answers, 3 marks each = 21 marks
- Expected answer: 3–4 lines or 3-step calculation
- Examples: prove/verify a property, solve a 3-step word problem, factorise, find area/volume
- No negative marking

SECTION D (Q.30–Q.34 approx) — 5 Long Answers, 5 marks each = 25 marks
- Expected answer: detailed explanation + complete calculation, may have sub-parts (a, b)
- Examples: full word problem with diagram, constructing/comparing figures, cost/profit problems
- No negative marking

STRICT RULES:
- All questions ONLY from NCERT Class 8 Mathematics chapters:
  Rational Numbers, Linear Equations, Quadrilaterals, Practical Geometry,
  Data Handling, Squares & Square Roots, Cubes & Cube Roots, Comparing Quantities,
  Algebraic Expressions, Exponents & Powers, Direct & Inverse Proportions,
  Factorisation, Introduction to Graphs, Playing with Numbers
- No negative marking for ANY section
- Numericals: write formula → substitution → answer (every step must be clear)
- Use LaTeX for all mathematical expressions`,
  },
  'Class 9': {
    label: 'CBSE Class 9',
    totalQ: 38, duration: 180, totalMarks: 80,
    marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5, 'Section E': 4 },
    sections: {
      'Section A (MCQ + AR)': { count: 20, marks: 1 },
      'Section B (VSA)':       { count: 5,  marks: 2 },
      'Section C (SA)':        { count: 6,  marks: 3 },
      'Section D (LA)':        { count: 4,  marks: 5 },
      'Section E (Case-Based)':{ count: 3,  marks: 4 },
    },
    questionStyle: `
CBSE CLASS 9 PAPER PATTERN (2025-26, 80 marks, 3 hours):
Section A (Q.1-20): 18 MCQs + 2 Assertion-Reason, 1 mark each, no negative marking
Section B (Q.21-25): 5 Very Short Answers, 2 marks each (2-3 lines or 2-step calculation)
Section C (Q.26-31): 6 Short Answers, 3 marks each (3-4 lines or 3-step solution)
Section D (Q.32-35): 4 Long Answers, 5 marks each, with internal choice (OR)
Section E (Q.36-38): 3 Case-Based Questions, 4 marks each (2+1+1 or 1+1+2 sub-parts)
- NCERT Class 9 syllabus only
- No negative marking
- Diagrams: describe in text with labelled parts
- Numericals: formula → substitution → answer`,
  },
  'Class 11': {
    label: 'CBSE Class 11',
    totalQ: 35, duration: 180, totalMarks: 80,
    marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5, 'Section E': 4 },
    sections: {
      'Section A (MCQ + AR)': { count: 20, marks: 1 },
      'Section B (VSA)':       { count: 5,  marks: 2 },
      'Section C (SA)':        { count: 7,  marks: 3 },
      'Section D (LA)':        { count: 2,  marks: 5 },
      'Section E (Case-Based)':{ count: 3,  marks: 4 },
    },
    questionStyle: `
CBSE CLASS 11 PAPER PATTERN (2025-26, 80 marks, 3 hours):
Section A (Q.1-20): 18 MCQs + 2 Assertion-Reason, 1 mark each, no negative marking
Section B (Q.21-25): 5 Short Answer-I, 2 marks each
Section C (Q.26-32): 7 Short Answer-II, 3 marks each
Section D (Q.33-34): 2 Long Answers, 5 marks each, with internal choice (OR)
Section E (Q.35-38): 3 Case-Based Questions, 4 marks each
- NCERT Class 11 syllabus only
- No negative marking
- Numericals: formula → substitution → answer with units`,
  },
  'Class 12': {
    label: 'CBSE Class 12',
    totalQ: 33, duration: 180, totalMarks: 80,
    marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5, 'Section E': 4 },
    sections: {
      'Section A (MCQ + AR)': { count: 20, marks: 1 },
      'Section B (VSA)':       { count: 5,  marks: 2 },
      'Section C (SA)':        { count: 6,  marks: 3 },
      'Section D (LA)':        { count: 2,  marks: 5 },
      'Section E (Case-Based)':{ count: 3,  marks: 4 },
    },
    questionStyle: `
CBSE CLASS 12 PAPER PATTERN (2025-26, 80 marks, 3 hours):
Section A (Q.1-20): 18 MCQs + 2 Assertion-Reason, 1 mark each, no negative marking
Section B (Q.21-25): 5 Short Answer-I, 2 marks each
Section C (Q.26-31): 6 Short Answer-II, 3 marks each
Section D (Q.32-33): 2 Long Answers, 5 marks each, with internal choice (OR)
Section E (Q.34-38): 3 Case-Based Questions, 4 marks each
- NCERT Class 11 + 12 syllabus only
- No negative marking
- Numericals: formula → substitution → answer with units`,
  },
  'Class 10': {
    label: 'CBSE Class 10',
    totalQ: 36, duration: 180, totalMarks: 80,
    marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5, 'Section E': 4 },
    sections: {
      'Section A (MCQ + AR)': { count: 20, marks: 1 },
      'Section B (VSA)':       { count: 6,  marks: 2 },
      'Section C (SA)':        { count: 7,  marks: 3 },
      'Section D (LA)':        { count: 3,  marks: 5 },
      'Section E (Case-Based)':{ count: 3,  marks: 4 },
    },
    questionStyle: `
CBSE CLASS 10 BOARD PATTERN (Science/Maths 2025-26):
Section A (Q.1-20): 16 MCQs + 4 Assertion-Reason, 1 mark each, no negative marking
Section B (Q.21-26): 6 Very Short Answers, 2 marks each (2-3 lines)
Section C (Q.27-33): 7 Short Answers, 3 marks each (4-5 lines or 3-step numerical)
Section D (Q.34-36): 3 Long Answers, 5 marks each with internal choice (OR)
Section E (Q.37-39): 3 Case-Based Questions, 4 marks each with subparts (a,b,c)
- All from NCERT Class 9 + 10 syllabus only
- No negative marking
- Diagrams: describe in text
- Numericals: formula → substitution → answer format`,
  },
};

/* ── Full chapter syllabus for chapter-spread enforcement ─── */
export const FULL_SYLLABUS = {
  NEET: {
    Physics: [
      'Physical World & Measurement', 'Kinematics', 'Laws of Motion', 'Work Energy Power',
      'Centre of Mass & Collisions', 'Rotational Motion', 'Gravitation', 'Properties of Bulk Matter',
      'Thermodynamics', 'Kinetic Theory of Gases', 'Oscillations', 'Waves',
      'Electrostatics', 'Current Electricity', 'Magnetic Effects of Current', 'Magnetism & Matter',
      'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves',
      'Ray Optics', 'Wave Optics', 'Dual Nature of Radiation', 'Atoms', 'Nuclei',
      'Semiconductor Electronics',
    ],
    Chemistry: [
      'Some Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements & Periodicity',
      'Chemical Bonding & Molecular Structure', 'States of Matter', 'Thermodynamics', 'Equilibrium',
      'Redox Reactions', 'Hydrogen', 's-Block Elements', 'p-Block Elements (Gr 13-14)',
      'Organic Chemistry Basic Principles', 'Hydrocarbons', 'Environmental Chemistry',
      'Solid State', 'Solutions', 'Electrochemistry', 'Chemical Kinetics', 'Surface Chemistry',
      'd & f Block Elements', 'Coordination Compounds', 'Haloalkanes & Haloarenes',
      'Alcohols Phenols & Ethers', 'Aldehydes Ketones & Carboxylic Acids', 'Amines',
      'Biomolecules', 'Polymers', 'Chemistry in Everyday Life', 'p-Block Elements (Gr 15-18)',
    ],
    Biology: [
      'The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom',
      'Morphology of Flowering Plants', 'Anatomy of Flowering Plants',
      'Structural Organisation in Animals', 'Cell: Unit of Life', 'Biomolecules',
      'Cell Cycle & Cell Division', 'Transport in Plants', 'Mineral Nutrition',
      'Photosynthesis', 'Respiration in Plants', 'Plant Growth & Development',
      'Digestion & Absorption', 'Breathing & Exchange of Gases',
      'Body Fluids & Circulation', 'Excretory Products & Elimination',
      'Locomotion & Movement', 'Neural Control & Coordination', 'Chemical Coordination',
      'Reproduction in Organisms', 'Sexual Reproduction in Flowering Plants',
      'Human Reproduction', 'Reproductive Health',
      'Principles of Inheritance & Variation', 'Molecular Basis of Inheritance', 'Evolution',
      'Human Health & Disease', 'Microbes in Human Welfare',
      'Biotechnology Principles & Processes', 'Biotechnology & Its Applications',
      'Organisms & Populations', 'Ecosystem', 'Biodiversity & Conservation', 'Environmental Issues',
    ],
  },
  'JEE Main': {
    Physics: [
      'Units & Dimensions', 'Kinematics (1D & 2D)', 'Laws of Motion & Friction',
      'Work Energy Power', 'Centre of Mass & Collisions', 'Rotational Motion',
      'Gravitation', 'Properties of Matter', 'Fluid Mechanics',
      'Thermodynamics', 'Kinetic Theory', 'Simple Harmonic Motion', 'Waves & Sound',
      'Electrostatics', 'Capacitors', 'Current Electricity', 'Moving Charges & Magnetism',
      'Magnetism', 'Electromagnetic Induction', 'Alternating Current',
      'Electromagnetic Waves', 'Ray Optics', 'Wave Optics',
      'Dual Nature of Matter', 'Atoms & Nuclei', 'Semiconductors & Logic Gates',
    ],
    Chemistry: [
      'Mole Concept & Stoichiometry', 'Atomic Structure', 'Chemical Bonding',
      'Gaseous State', 'Liquid & Solid State', 'Thermodynamics', 'Thermochemistry',
      'Chemical Equilibrium', 'Ionic Equilibrium', 'Electrochemistry', 'Chemical Kinetics',
      'Nuclear Chemistry', 's-Block Elements', 'p-Block (Gr 13-18)', 'd & f Block Elements',
      'Coordination Compounds', 'Metallurgy', 'Qualitative Analysis',
      'GOC (General Organic Chemistry)', 'Hydrocarbons (Alkane/Alkene/Alkyne/Aromatic)',
      'Haloalkanes & Haloarenes', 'Alcohols Phenols Ethers',
      'Carbonyl Compounds (Aldehyde/Ketone/Acid)', 'Amines',
      'Biomolecules', 'Polymers', 'Chemistry in Everyday Life',
    ],
    Mathematics: [
      'Sets Relations Functions', 'Complex Numbers', 'Quadratic Equations',
      'Sequences & Series', 'Permutations & Combinations', 'Binomial Theorem',
      'Matrices', 'Determinants',
      'Limits Continuity & Differentiability', 'Differentiation',
      'Application of Derivatives', 'Indefinite Integration', 'Definite Integration',
      'Differential Equations', 'Straight Lines', 'Circles',
      'Parabola', 'Ellipse', 'Hyperbola',
      'Vectors', '3D Geometry',
      'Probability', 'Statistics',
      'Trigonometric Functions', 'Inverse Trigonometry', 'Heights & Distances',
    ],
  },
  'JEE Advanced': {
    Physics: [
      'Mechanics (Kinematics, NLM, WEP, Rotation, Gravitation)', 'Fluid Mechanics & Thermal Physics',
      'Electricity & Magnetism', 'Electromagnetic Induction & AC',
      'Optics (Ray & Wave)', 'Modern Physics',
    ],
    Chemistry: [
      'Physical Chemistry (Thermodynamics, Equilibrium, Electrochemistry, Kinetics)',
      'Inorganic Chemistry (Periodicity, s/p/d-block, Coordination)',
      'Organic Chemistry (GOC, Reactions, Named Reactions, Stereochemistry, Biomolecules)',
    ],
    Mathematics: [
      'Algebra (Complex Numbers, Polynomials, Matrices, Probability)',
      'Calculus (Limits, Differentiation, Integration, Differential Equations)',
      'Trigonometry', 'Coordinate Geometry', 'Vectors & 3D Geometry',
    ],
  },
};

/* ── Fetch KB chunks — pgvector primary, keyword fallback ─── */
async function fetchKBChunks(subject, topicHints) {
  const query = [subject !== 'Mixed' ? subject : '', topicHints || ''].filter(Boolean).join(' ');

  // Try semantic search first
  const embedding = query ? await embedText(query) : null;
  if (embedding) {
    try {
      const { data } = await supabase.rpc('match_knowledge_base', {
        query_embedding:  embedding,
        match_count:      15,
        filter_subject:   subject !== 'Mixed' ? subject : null,
      });
      if (data?.length) {
        if (import.meta.env.DEV) console.log(`[fetchKBChunks] semantic path → ${data.length} chunks (subject=${subject})`);
        return data.map((r) => r.content);
      }
    } catch { /* fall through to keyword search */ }
  }
  if (import.meta.env.DEV) console.log(`[fetchKBChunks] keyword path (embedding=${embedding ? 'ok but 0 results' : 'null'}, subject=${subject})`);

  // Keyword fallback
  let q = supabase.from('knowledge_base').select('content, subject');
  if (subject !== 'Mixed') q = q.eq('subject', subject);
  const { data } = await q.limit(50);
  const chunks = (data || []).map((c) => c.content);
  if (!topicHints?.trim() || !chunks.length) return chunks.slice(0, 15);

  const terms = topicHints.toLowerCase().split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 2);
  if (!terms.length) return chunks.slice(0, 15);

  const scored = chunks.map((c) => ({
    text:  c,
    score: terms.filter((t) => c.toLowerCase().includes(t)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 15).map((c) => c.text);
}

/* ── Fetch real PYQ examples from DB (randomised each call) ── */
async function fetchPYQExamples(subject, topic, examType, limit = 6) {
  try {
    // Fetch a larger pool then randomly sample so every generation gets different examples
    let q = supabase
      .from('pyq_questions')
      .select('question_text, options, correct_answer, explanation, year, chapter, question_type')
      .eq('status', 'published')
      .neq('question_type', 'KB_NOTE')
      .limit(80);
    if (subject && subject !== 'Mixed') q = q.eq('subject', subject);
    // For board+class combos, accept both "CBSE Class 10" and the standalone "Class 10"
    if (examType) {
      const altKey = resolvePatternKey(examType); // "CBSE Class 10" → "Class 10"
      if (altKey !== examType) {
        q = q.in('exam_type', [examType, altKey]);
      } else {
        q = q.eq('exam_type', examType);
      }
    }
    if (topic?.trim()) {
      const term = topic.split(',')[0].trim();
      q = q.ilike('chapter', `%${term}%`);
    }
    const { data } = await q;
    if (!data?.length) return [];
    // Fisher-Yates shuffle then take limit
    const pool = [...data];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, limit);
  } catch {
    return [];
  }
}

/* ── Analyze topic distribution ──────────────────────────── */
export async function analyzeTopicDistribution(subject, examType) {
  const freqRows = await getTopicFrequency(subject, examType);
  if (freqRows.length) return freqRows;

  let q = supabase.from('knowledge_base').select('content, subject').limit(40);
  if (subject !== 'Mixed') q = q.eq('subject', subject);
  const { data } = await q;
  const chunks = (data ?? []).map((c) => c.content).slice(0, 20);
  if (!chunks.length) return [];

  const resp = await chatComplete({
    model: 'gpt-4o-mini',
    max_tokens: 800,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Extract topics from text. Return JSON.' },
      { role: 'user', content: `From these ${examType} ${subject} excerpts, identify the top 15 topics and estimate their relative frequency (1-10 scale).\n\n${chunks.join('\n---\n')}\n\nReturn: { "topics": [{ "topic": "...", "frequency": 5 }] }` },
    ],
  });

  const raw    = JSON.parse(resp.choices[0].message.content);
  const topics = (raw.topics || []).slice(0, 15);

  const rows = topics.map((t) => ({
    exam_type: examType, subject, topic: t.topic, frequency: t.frequency,
  }));
  if (rows.length) {
    supabase.from('topic_frequency').upsert(rows, { onConflict: 'exam_type,subject,topic' }).then(() => {});
  }

  return topics;
}

/* ── Question cache helpers ──────────────────────────────── */
function makeCacheKey({ subject, topics, examType, difficulty, count, qTypes, rotationSlot }) {
  const slot  = rotationSlot ?? 0;
  const parts = [examType, subject, (topics || '').trim().toLowerCase(), difficulty, count, [...qTypes].sort().join(','), `s${slot}`];
  return parts.join('::');
}

async function cacheGet(key) {
  try {
    const { data } = await supabase
      .from('question_cache')
      .select('id, questions, use_count')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!data) return null;
    // Increment use_count in background, don't block caller
    supabase.from('question_cache').update({ use_count: (data.use_count ?? 0) + 1 }).eq('id', data.id).then(() => {});
    return data.questions;
  } catch { return null; }
}

async function cacheSet(key, examType, subject, topics, questions) {
  try {
    await supabase.from('question_cache').upsert({
      cache_key:  key,
      exam_type:  examType,
      subject,
      chapter:    topics || subject,
      questions,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'cache_key' });
  } catch { /* non-critical */ }
}

/* ── Main question generator ─────────────────────────────── */
const TYPE_GUIDE = {
  MCQ:                  'Standard MCQ with 4 options (A/B/C/D), exactly one correct.',
  'Assertion-Reason':   'Assertion-Reason. Use exactly: A: Both A&R true, R explains A; B: Both true, R doesn\'t explain; C: A true R false; D: A false.',
  'Match the Following':'Match Column I (P,Q,R,S) with Column II (1,2,3,4). Provide standard MCQ options A/B/C/D for the matched combination.',
  Numerical:            'Numerical/integer answer (0-9 for JEE, or any integer for NEET). "options" field must be null.',
  'Short Answer':       'Short written answer (2–5 lines). No options. "answer" is a concise written response. "options" must be null.',
  'Long Answer':        'Long detailed answer (8–15 lines, multi-step). May include sub-parts (a, b, c). No options. "answer" is a comprehensive written response. "options" must be null.',
  'Case-Based':         'Passage-based question with 3–4 sub-questions. Include the passage in "question" field, sub-questions as lettered parts. "options" is null.',
};

export async function generateQuestionPaper({ subject, topics, examType, difficulty, count, qTypes }) {
  // No caching — always generate fresh so students never get repeated papers
  let pattern = PAPER_PATTERNS[resolvePatternKey(examType)];

  // Blueprint V2: compute per-subject chapter allocation from live PYQ data.
  // Only applies when no specific topic was requested and the flag is on.
  let blueprintAllocation = null; // { chapter: targetCount } | null
  const blueprintV2Enabled = await getFeatureFlag(FLAGS.BLUEPRINT_V2);
  if (blueprintV2Enabled && !topics?.trim() && subject && subject !== 'Mixed') {
    const { data: subjectPYQs } = await supabase
      .from('pyq_questions')
      .select('chapter')
      .eq('exam_type', examType)
      .eq('subject', subject)
      .eq('status', 'published');

    const chapterCounts = {};
    for (const { chapter } of (subjectPYQs ?? [])) {
      if (!chapter) continue;
      chapterCounts[chapter] = (chapterCounts[chapter] ?? 0) + 1;
    }
    const pyqTotal = Object.values(chapterCounts).reduce((s, v) => s + v, 0);

    if (pyqTotal >= 20) {
      const entries = Object.entries(chapterCounts).sort(([, a], [, b]) => b - a);
      const alloc   = {};
      let allocated = 0;
      for (const [ch, cnt] of entries) {
        alloc[ch] = Math.floor((cnt / pyqTotal) * count);
        allocated += alloc[ch];
      }
      // Distribute any remainder to the highest-frequency chapters
      let rem = count - allocated;
      for (const [ch] of entries) {
        if (rem <= 0) break;
        alloc[ch]++;
        rem--;
      }
      blueprintAllocation = alloc;
      if (import.meta.env.DEV) {
        console.log('[questionGen] blueprint_v2 allocation (chapter → target):', alloc);
      }
    }
  }

  // Fetch PYQs as the PRIMARY style reference (these are the real uploaded exam questions)
  const pyqExamples = await fetchPYQExamples(subject, topics, examType, 20);

  // Fetch study notes from knowledge_base for this subject+exam (board/class mapped by examTag)
  const examTag = examType?.toLowerCase().replace(/\s+/g, '_');
  let kbQuery = supabase.from('knowledge_base').select('content').limit(12);
  if (subject && subject !== 'Mixed') kbQuery = kbQuery.eq('subject', subject);
  if (examTag) kbQuery = kbQuery.or(`tags.cs.{${examTag}},tags.cs.{${subject.toLowerCase()}}`);
  const { data: kbRows } = await kbQuery;
  const studyNotes = kbRows ?? [];

  // For CBSE/school exams, always include all section types regardless of qTypes selection.
  // This ensures Long Answer and Short Answer are never accidentally omitted.
  const isCBSEPrompt = CBSE_STYLE_EXAMS.has(examType);
  const effectiveTypes = isCBSEPrompt
    ? ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer', 'Case-Based']
    : (qTypes?.length ? qTypes : ['MCQ']);
  const typeInstr = effectiveTypes.map((t) => `- ${t}: ${TYPE_GUIDE[t]}`).join('\n');
  const diffNote  = difficulty === 'Mixed' ? '30% Easy, 50% Medium, 20% Hard' : `All ${difficulty}`;
  const seed      = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; // unique per call

  // If we have real PYQs, make them the centrepiece of the prompt
  const hasPYQs = pyqExamples.length >= 3;
  const pyqBlock = hasPYQs
    ? `\n\nREAL EXAM QUESTIONS FROM UPLOADED PAPERS — STUDY THESE AS STYLE REFERENCE ONLY:
These are actual questions from ${examType} papers for ${subject}. Your generated questions MUST:
• Match the exact same language style, sentence structure, and vocabulary
• Match the same level of depth and difficulty
• Follow the same question formats shown below
• Cover DIFFERENT topics/chapters/sub-topics than these examples wherever possible
• NEVER copy or paraphrase any of these — they are style guides, not templates. All generated questions must be 100% original.

${pyqExamples.map((p, i) =>
  `[PYQ ${i + 1}${p.year ? ` — ${p.year}` : ''}${p.chapter ? ` | ${p.chapter}` : ''}]
Q: ${p.question_text}
${p.options ? `Options: ${p.options.join(' | ')}` : ''}
Answer: ${p.correct_answer}${p.explanation ? `\nExplanation: ${p.explanation}` : ''}`
).join('\n\n')}`
    : '\n\nNOTE: No PYQ examples available — generate based on standard exam pattern.';

  // When no topic specified, spread across syllabus chapters — read live from
  // Admin > Syllabus (syllabus_nodes) first, since that's what admins actually
  // configure. FULL_SYLLABUS below is only a last-resort fallback for exam
  // types with no DB rows and no seeded syllabusData.js entry either.
  let fullChapters = null;
  if (!blueprintAllocation && !topics?.trim()) {
    const liveChapters = await getChapters(examType, subject);
    fullChapters = liveChapters.length
      ? liveChapters.map((c) => c.name)
      : (FULL_SYLLABUS[examType]?.[subject] ?? null);
  }
  const chapterNote = blueprintAllocation
    ? `\nCHAPTER ALLOCATION — MANDATORY (blueprint-matched distribution):\n` +
      Object.entries(blueprintAllocation)
        .filter(([, n]) => n > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([ch, n]) => `${ch}: ${n} question${n > 1 ? 's' : ''}`)
        .join('\n') +
      `\nTag each question's "chapter" field with the exact chapter name as listed above.`
    : fullChapters
    ? `\nCHAPTER DISTRIBUTION — MANDATORY:
Distribute questions proportionally across these chapters (same distribution as real ${examType} papers):
${fullChapters.join(' | ')}
Tag each question's "chapter" field with the exact chapter name.`
    : topics?.trim() ? `\nChapters/topics: ${topics}` : '';

  const patternNote = pattern
    ? `\n\nEXAM PATTERN — STRICTLY FOLLOW:\n${pattern.questionStyle}\n\n⚠️ SUBJECT OVERRIDE: This paper is for ${subject}. Generate ONLY ${subject} questions. Follow the section structure and mark scheme above exactly, but use ${subject} content — not Mathematics or any other subject mentioned above.`
    : '';

  const studyNotesBlock = studyNotes.length >= 2
    ? `\n\nSTUDY MATERIAL FROM KNOWLEDGE BASE (use these concepts and terminology in your questions):
These are uploaded notes for ${examType} ${subject}. Base question content, terminology, and conceptual depth on this material where possible.
${studyNotes.map((r, i) => `[Note ${i + 1}]\n${r.content.slice(0, 400)}`).join('\n\n').slice(0, 4000)}`
    : '';

  const prompt = `You are a senior ${examType} question paper setter with 20+ years of experience setting official exam papers.
Generation ID: ${seed} — THIS IS A FRESH GENERATION. You MUST produce a completely different set of questions from any previous generation. Vary the chapters, question angles, numbers used, and sub-topics. If you think of a question you have seen before, discard it and write a new one.

TARGET EXAM: ${examType}
SUBJECT: ${subject}
DIFFICULTY: ${diffNote}
QUESTION COUNT: exactly ${count}
QUESTION TYPES (distribute as per real paper):
${typeInstr}
${chapterNote}
${patternNote}
${studyNotesBlock}
${pyqBlock}

DIAGRAM QUESTIONS (10-15% must be diagram-based for NEET/JEE):
- Include a "diagram_description" field: plain-English description of the figure (e.g. "A schematic of the human nephron with parts A, B, C, D labelled")
- Question should reference the diagram: "Refer to the figure. Which part labelled..."

EQUATION FORMATTING (mandatory):
- All math in LaTeX: inline → $...$, display → $$...$$
- Chemical formulas: $\\text{H}_2\\text{SO}_4$, $\\text{CO}_2$
- Reactions: $\\text{A} + \\text{B} \\rightarrow \\text{C}$
- Physics: $F = ma$, $E = \\frac{1}{2}mv^2$

RULES:
1. Generate 100% original questions — NEVER copy PYQ examples verbatim
2. Match the style, depth, and difficulty of the PYQ examples above
3. Match the Following → Column I: P/Q/R/S, Column II: 1/2/3/4
4. Each question MUST have answer + explanation (1-3 sentences with LaTeX)
5. ${examType === 'NEET' ? 'NEET Biology: direct NCERT recall or direct application — never ambiguous' : ''}
6. ${examType === 'JEE Advanced' ? 'Every question requires multi-step reasoning — no trivial recall' : ''}

Return ONLY a valid JSON object in this exact shape — no markdown, no code fences:
${CBSE_STYLE_EXAMS.has(examType) ? `{
  "questions": [
    {
      "type": "MCQ" | "Short Answer" | "Long Answer" | "Assertion-Reason",
      "section": "A" | "B" | "C" | "D" | "E",
      "marks": 1 | 2 | 3 | 5,
      "chapter": "exact chapter name",
      "difficulty": "Easy" | "Medium" | "Hard",
      "question": "question text with LaTeX",
      "diagram_description": "description of figure if needed (omit otherwise)",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."] or null,
      "answer": "A" or "short written answer",
      "explanation": "concise explanation with LaTeX"
    }
  ]
}
SECTION → TYPE → MARKS mapping (MANDATORY — every question MUST include section and marks):
- Section A: MCQ or Assertion-Reason → marks: 1, options array required
- Section B: Short Answer (2-3 lines) → marks: 2, options: null
- Section C: Short Answer (4-5 lines/3-step numerical) → marks: 3, options: null
- Section D: Long Answer (detailed, multi-step) → marks: 5, options: null
- Section E: Case-Based (passage + sub-questions) → marks: 5, options: null` : `{
  "questions": [
    {
      "type": "MCQ" | "Assertion-Reason" | "Match the Following" | "Numerical",
      "chapter": "exact chapter name",
      "difficulty": "Easy" | "Medium" | "Hard",
      "question": "question text with LaTeX",
      "diagram_description": "description of figure (omit if no diagram)",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."] or null,
      "columnI":  ["P. ...", "Q. ...", "R. ...", "S. ..."] or null,
      "columnII": ["1. ...", "2. ...", "3. ...", "4. ..."] or null,
      "answer": "A" or "P-2,Q-3,R-1,S-4" or 42,
      "explanation": "concise explanation with LaTeX"
    }
  ]
}`}`;

  /* School exams with SA/LA need more tokens; split large batches to avoid truncation */
  const isCBSEGen    = CBSE_STYLE_EXAMS.has(examType);
  const tokensPerQ   = isCBSEGen ? 750 : 300; // SA/LA need extra headroom
  const safePerBatch = isCBSEGen ? 8  : 20;   // smaller CBSE batches = less risk of truncation

  /* If count exceeds safe per-batch size, split into multiple API calls */
  const batches = [];
  let remaining = count;
  while (remaining > 0) {
    batches.push(Math.min(remaining, safePerBatch));
    remaining -= safePerBatch;
  }

  const allQuestions = [];

  for (const batchCount of batches) {
    const askFor      = batchCount + 2;  // buffer: AI often returns N-1, ask N+2 and trim later
    const batchPrompt = prompt.replace(
      `exactly ${count}`,
      `exactly ${askFor}`
    );

    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      Math.min(16000, askFor * tokensPerQ + 1200),
      temperature:     0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert exam question generator who creates questions indistinguishable from official exam papers. Return only valid JSON.' },
        { role: 'user',   content: batchPrompt },
      ],
    });

    const choice = resp.choices?.[0];
    if (!choice) { console.warn('[questionGen] empty choices in batch — skipping'); continue; }
    if (choice.finish_reason === 'length') {
      console.warn(`[questionGen] batch truncated (finish_reason=length) — recovering partial response`);
    }
    const raw = choice.message.content.trim();
    const qs  = parseAIQuestions(raw);
    allQuestions.push(...qs);
  }

  // Compute blueprint match % when blueprint_v2 allocation was used
  let blueprintMatchPct = undefined;
  let allocationTable   = undefined;

  if (blueprintAllocation && allQuestions.length > 0) {
    const generatedCounts = {};
    for (const q of allQuestions) {
      const ch = q.chapter ?? 'Uncategorised';
      generatedCounts[ch] = (generatedCounts[ch] ?? 0) + 1;
    }
    const N = allQuestions.length;
    const allChs = new Set([...Object.keys(blueprintAllocation), ...Object.keys(generatedCounts)]);
    let totalDiff = 0;
    for (const ch of allChs) {
      const targetPct = ((blueprintAllocation[ch] ?? 0) / count) * 100;
      const actualPct = ((generatedCounts[ch] ?? 0) / N)  * 100;
      totalDiff += Math.abs(actualPct - targetPct);
    }
    blueprintMatchPct = Math.round(Math.max(0, 100 - totalDiff / 2));

    allocationTable = Object.entries(blueprintAllocation)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([ch, planned]) => ({ chapter: ch, planned, generated: generatedCounts[ch] ?? 0 }));

    if (import.meta.env.DEV) {
      console.log(`[questionGen] blueprint_match_pct: ${blueprintMatchPct}%`);
      console.table(allocationTable);
    }
  }

  return {
    questions:           allQuestions,
    blueprint_match_pct: blueprintMatchPct,
    allocation_table:    allocationTable,
    meta: {
      pyqCount:        pyqExamples.length,
      studyNotesCount: studyNotes.length,
    },
  };
}

/* ── Robust JSON parser that recovers truncated AI responses ── */
function parseAIQuestions(raw) {
  const extractArray = (parsed) => {
    if (Array.isArray(parsed)) return parsed;
    // Search all top-level values for the first array
    const arr = Object.values(parsed).find(Array.isArray);
    return arr ?? [];
  };

  // 1. Try as-is (clean response)
  try {
    const parsed = JSON.parse(raw);
    const arr = extractArray(parsed);
    if (arr.length) return arr;
  } catch { /* fall through */ }

  // Find where the questions array actually starts — strip any wrapper object prefix
  const arrayStart = raw.indexOf('[');
  const slice = arrayStart >= 0 ? raw.slice(arrayStart) : raw;

  // 2. Close array after last complete object followed by comma  e.g. "...}, {"
  const lastComma = slice.lastIndexOf('},');
  if (lastComma > 0) {
    try {
      const repaired = slice.slice(0, lastComma + 1) + ']';
      const parsed   = JSON.parse(repaired);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* fall through */ }
  }

  // 3. Close array after the last } (final item, no trailing comma)
  const lastBrace = slice.lastIndexOf('}');
  if (lastBrace > 0) {
    try {
      const repaired = slice.slice(0, lastBrace + 1) + ']';
      const parsed   = JSON.parse(repaired);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* fall through */ }
  }

  // 4. Append closing brackets to seal a truncated `{"questions":[...` response
  for (const suffix of [']}', '"}]}', '"]]}', '"]}']) {
    try {
      const parsed = JSON.parse(raw + suffix);
      const arr = extractArray(parsed);
      if (arr.length) return arr;
    } catch { /* fall through */ }
  }

  // 5. Last-resort: extract each individual {...} object with a regex
  //    Works even when truncation hits the middle of the first question
  const objects = [];
  const re = /\{(?:[^{}]|\{[^{}]*\})*\}/g;
  let m;
  while ((m = re.exec(slice)) !== null) {
    try {
      const q = JSON.parse(m[0]);
      // Accept if it looks like a question object
      if (q && (q.question || q.type || q.options)) objects.push(q);
    } catch { /* skip malformed fragment */ }
  }
  if (objects.length) return objects;

  throw new Error(`Could not parse AI response as JSON. Content starts with: ${raw.slice(0, 80)}`);
}

/* ── PYQ extraction from KB chunks ───────────────────────── */
export async function extractPYQFromKB({ subject, examType, onProgress }) {
  let q = supabase.from('knowledge_base').select('content, subject');
  if (subject && subject !== 'Mixed') q = q.eq('subject', subject);
  const { data: chunks } = await q.limit(80);
  if (!chunks?.length) return { extracted: 0 };

  const texts  = chunks.map((c) => c.content);
  const batches = [];
  for (let i = 0; i < texts.length; i += 8) batches.push(texts.slice(i, i + 8));

  const allQuestions = [];

  for (let bi = 0; bi < batches.length; bi++) {
    onProgress?.(`Scanning batch ${bi + 1} of ${batches.length}…`);
    const batchText = batches[bi].join('\n---\n').slice(0, 12000);

    try {
      const resp = await chatComplete({
        model:           'gpt-4o-mini',
        max_tokens:      3000,
        temperature:     0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You extract exam questions from text. Return only valid JSON.',
          },
          {
            role: 'user',
            content: `Extract all complete exam questions (with 4 options and a correct answer) from the following ${examType} ${subject} text.
If a question is incomplete or has no options, skip it.
Return JSON: { "questions": [ { "question_text": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "correct_answer": "A", "explanation": "..." or null, "chapter": "...", "year": 2023 or null, "difficulty": "Easy"|"Medium"|"Hard" } ] }

TEXT:
${batchText}`,
          },
        ],
      });

      const parsed = JSON.parse(resp.choices[0].message.content);
      const qs     = parsed.questions || [];
      allQuestions.push(...qs.filter((q) => q.question_text && Array.isArray(q.options) && q.options.length === 4));
    } catch {
      // skip bad batches silently
    }
  }

  if (!allQuestions.length) return { extracted: 0 };

  const reviewQueueOn = await getFeatureFlag(FLAGS.CONTENT_REVIEW_QUEUE);

  const rows = allQuestions.map((q) => ({
    exam_type:      examType,
    subject:        subject === 'Mixed' ? 'General' : subject,
    chapter:        q.chapter || null,
    question_text:  q.question_text,
    options:        q.options,
    correct_answer: q.correct_answer || 'A',
    explanation:    q.explanation || null,
    year:           q.year || null,
    question_type:  'MCQ',
    difficulty:     q.difficulty || 'Medium',
    source:         'kb_extraction',
    status:         reviewQueueOn ? 'in_review' : 'published',
  }));

  const { error: insErr } = await supabase.from('pyq_questions').insert(rows);
  if (insErr) throw new Error(`pyq_questions insert failed: ${insErr.message}`);

  return { extracted: rows.length };
}

/* ── Chapter study notes generator (deep) ───────────────── */
export async function generateChapterNotes({ subject, chapter, examType }) {
  const pattern = PAPER_PATTERNS[resolvePatternKey(examType)];

  let q = supabase.from('knowledge_base').select('content, subject').limit(30);
  if (subject && subject !== 'Mixed') q = q.eq('subject', subject);
  const chapterTerm = chapter?.trim() ? chapter.split(',')[0].trim() : null;
  if (chapterTerm) {
    // Escape braces in chapterTerm so PostgREST doesn't treat them as array literals
    const safeTerm = chapterTerm.replace(/[{}]/g, '');
    q = q.or(`content.ilike.%${safeTerm}%,tags.cs.{${safeTerm}}`);
  }
  const { data: chunks, error: kbErr } = await q;
  if (kbErr) console.warn('[generateChapterNotes] KB query failed:', kbErr.message);
  const context = ((chunks ?? []).map((c) => c.content)).join('\n---\n').slice(0, 8000);

  const freqData = await getTopicFrequency(subject, examType);
  const topicRow = freqData.find((f) => f.topic?.toLowerCase().includes((chapter || '').toLowerCase()));
  const pyqScore = topicRow ? topicRow.frequency : null;

  const isChemistry   = subject === 'Chemistry';
  const isMath        = subject === 'Mathematics';
  const isPhysics     = subject === 'Physics';
  const isBiology     = subject === 'Biology';
  const patternNote   = pattern ? pattern.questionStyle.slice(0, 600) : '';

  const latexGuide = `
FORMATTING RULES (CRITICAL — follow exactly):
- Wrap ALL mathematical expressions in $...$: e.g. $F = ma$, $E = \\frac{1}{2}mv^2$, $K_a = \\frac{[H^+][A^-]}{[HA]}$
- Wrap display equations (stand-alone) in $$...$$: e.g. $$\\int_0^\\infty e^{-x}dx = 1$$
- Chemical formulas: use $\\text{H}_2\\text{SO}_4$, $\\text{CH}_3\\text{COOH}$, $\\text{CO}_2$
- Chemical reactions: $\\text{Reactant} \\rightarrow \\text{Product}$ or $\\rightleftharpoons$ for reversible
- Ionic equations: include state symbols $(s)$, $(l)$, $(g)$, $(aq)$
- Organic structures: write IUPAC name + describe briefly; no SVG/images
- Bond notation: single bond as single dash, double bond as $=$ in text
- Subscripts/superscripts in plain text: use Unicode like H₂O, Fe³⁺ — ONLY for inline mentions, not equations
- Never use markdown ** bold ** or # headers inside JSON string values`;

  const resp = await chatComplete({
    model:       'gpt-4o',
    max_tokens:  8000,
    temperature: 0.35,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a senior ${examType} tutor with 20 years of experience teaching Indian students. You write extremely detailed, exam-focused study notes that go far beyond surface-level summaries. Every concept must be explained deeply with mechanisms, exceptions, worked examples, and memory tricks. Return only valid JSON.`,
      },
      {
        role: 'user',
        content: `Generate COMPREHENSIVE, IN-DEPTH study notes for the chapter "${chapter}" — ${subject} for ${examType}.
${pyqScore ? `PYQ frequency: ${pyqScore}/10 — this is a ${pyqScore >= 7 ? 'very high priority' : pyqScore >= 4 ? 'medium priority' : 'lower priority'} chapter.` : ''}

${patternNote ? `EXAM PATTERN:\n${patternNote}` : ''}

${context ? `REFERENCE MATERIAL FROM KNOWLEDGE BASE:\n${context}` : ''}

${latexGuide}

DEPTH REQUIREMENTS:
- Each keyConcept explanation must be AT LEAST 8-12 lines — full detailed explanation, NOT a summary
- Include the "why" behind every rule and formula, not just the what
${isChemistry ? '- For reactions: include mechanism steps, reagents, conditions (temperature, catalyst, solvent), side products, exceptions\n- Show orbital overlaps, hybridization changes, electron pair movements where relevant' : ''}
${isPhysics ? '- Include derivation steps for each formula (numbered steps)\n- Include dimensional analysis for formulas\n- Explain the physical significance of each quantity' : ''}
${isMath ? '- Show derivation/proof for theorems\n- Include worked numerical examples with step-by-step solutions\n- List standard results and special cases' : ''}
${isBiology ? '- Include full diagrams described in text (label all parts)\n- Include classification tables\n- List all examples with scientific names where relevant' : ''}

Return this EXACT JSON structure — populate every field richly:
{
  "chapter": "${chapter}",
  "subject": "${subject}",
  "examType": "${examType}",
  "overview": "3-4 sentence overview explaining what this chapter covers, its importance in ${examType}, and which sub-topics are most frequently tested",
  "keyConcepts": [
    {
      "title": "Full concept name",
      "explanation": "DETAILED explanation — minimum 8 lines. Cover definition, mechanism/derivation, conditions, exceptions, physical significance, and real-world context. Use LaTeX for all equations.",
      "subpoints": ["Specific sub-rule or case 1", "Sub-rule 2", "Exception or special case 3"],
      "worked_example": "Full worked example with step-by-step solution using LaTeX for math",
      "tip": "Exam trick, mnemonic, or most common mistake students make"
    }
  ],
  "importantFormulas": [
    {
      "formula": "$...$ LaTeX formula",
      "variables": "What each variable represents",
      "conditions": "When to apply / when NOT to apply",
      "derivation_hint": "Key step in derivation or how to remember it"
    }
  ],
  ${isChemistry ? `"reactions": [
    {
      "name": "Reaction name",
      "equation": "$\\\\text{Reactant} \\\\rightarrow \\\\text{Product}$ with conditions above arrow",
      "conditions": "Temperature, catalyst, solvent, pressure",
      "mechanism": "Brief mechanism — which bond breaks, nucleophile/electrophile, intermediate",
      "exceptions": "When this reaction does NOT work or gives different product",
      "pyq_note": "How this reaction appeared in past papers"
    }
  ],` : ''}
  ${isPhysics ? `"derivations": [
    {
      "title": "Derivation name",
      "steps": ["Step 1: Start from ...", "Step 2: Apply ...", "Step 3: Simplify to get $...$"],
      "result": "$final formula$",
      "assumptions": "Assumptions made during derivation"
    }
  ],` : ''}
  ${isMath ? `"worked_problems": [
    {
      "problem": "Problem statement",
      "solution_steps": ["Step 1", "Step 2", "Step 3"],
      "answer": "Final answer with units"
    }
  ],` : ''}
  "ncertHighlights": ["Important NCERT line 1 that is directly asked in ${examType}", "Important line 2", "Important line 3", "Important line 4", "Important line 5"],
  "previousYearTrend": "Detailed analysis of how this chapter appeared in ${examType} from 2019-2024 — which sub-topics were asked most, what type of questions (factual/application/HOTS), approximate number of questions per year",
  "mustRemember": ["Critical fact/value 1", "Critical fact/value 2", "Critical fact/value 3", "Critical fact/value 4", "Critical fact/value 5", "Critical fact/value 6"],
  "commonMistakes": ["Detailed description of mistake 1 and how to avoid it", "Mistake 2", "Mistake 3"],
  "mnemonics": ["Mnemonic 1 — what it helps remember", "Mnemonic 2"]
}`,
      },
    ],
  });

  return JSON.parse(resp.choices[0].message.content);
}

/* ── Study plan generator ────────────────────────────────── */
export async function generateStudyPlan({ examType, examDate, dailyHours, weakSubjects, focusChapters }) {
  const daysLeft = Math.max(1, Math.ceil((new Date(examDate) - new Date()) / 86400000));
  const totalHours = daysLeft * dailyHours;

  const prompt = `You are an expert NEET/JEE study planner. Create a detailed, realistic study plan.

Student profile:
- Target exam: ${examType}
- Exam date: ${examDate} (${daysLeft} days from today)
- Daily study hours: ${dailyHours}h/day (total ${Math.round(totalHours)}h available)
- ${weakSubjects.length > 0 ? `IMPORTANT: Plan covers ONLY these subjects — do NOT include any other subjects in weeklyPlan, subjectStrategy, or phases: ${weakSubjects.join(', ')}` : 'Subjects: All subjects for this exam (distribute evenly)'}
- Priority chapters: ${focusChapters || 'Full syllabus (follow standard PYQ frequency)'}

Create a personalized study plan. Return ONLY valid JSON:
{
  "overview": "2-3 sentence summary of the strategy",
  "totalWeeks": number,
  "dailyHours": number,
  "phases": [
    {
      "phase": "Foundation / Revision / Mock Practice",
      "weeks": "Week 1-3",
      "goal": "What to achieve in this phase",
      "focus": ["subject1 - topic", "subject2 - topic"]
    }
  ],
  "weeklyPlan": [
    {
      "week": 1,
      "theme": "Week theme",
      "days": [
        {
          "day": "Monday",
          "subject": "Physics",
          "topics": ["Kinematics basics", "Newton's Laws"],
          "hours": 2,
          "task": "Read NCERT + solve 20 MCQs"
        }
      ]
    }
  ],
  "dailyRoutine": {
    "morning": "What to do in morning session",
    "evening": "What to do in evening session",
    "night": "Revision routine"
  },
  "subjectStrategy": {
    "Physics": "Strategy for Physics",
    "Chemistry": "Strategy for Chemistry",
    "Biology": "Strategy for Biology (or Maths for JEE)"
  },
  "weeklyTargets": ["Complete X chapters", "Attempt Y mock tests", "Revise Z topics"],
  "importantTips": ["tip1", "tip2", "tip3", "tip4", "tip5"]
}

Make the plan realistic for ${daysLeft} days.${weakSubjects.length > 0 ? ` Only include ${weakSubjects.join(', ')} — NO other subjects.` : ' Cover all subjects equally.'}`;

  const res = await chatComplete({
    model: 'gpt-4o',
    max_tokens: 4000,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a precise study planner. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ],
  });

  return JSON.parse(res.choices[0].message.content);
}
