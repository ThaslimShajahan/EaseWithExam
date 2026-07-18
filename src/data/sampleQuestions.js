export const SAMPLE_NEET_TEST = {
  id: 'neet-mock-001',
  title: 'NEET 2024 Full Mock Test',
  exam: 'NEET',
  duration: 180,
  totalMarks: 720,
  sections: ['Physics', 'Chemistry', 'Biology'],
  instructions: [
    'This test contains 180 questions (Physics: 45, Chemistry: 45, Biology: 90).',
    'Each correct answer carries +4 marks. Each incorrect answer carries −1 mark.',
    'Unattempted questions carry 0 marks.',
    'Do not close the browser tab during the test.',
  ],
};

export const SAMPLE_QUESTIONS = [
  {
    id: 'q001',
    subject: 'Physics',
    topic: 'Circular Motion',
    subtopic: "Newton's Laws",
    difficulty: 'medium',
    question:
      'A body of mass 5 kg is moving in a circle of radius 2 m with angular velocity 4 rad/s. The centripetal force acting on the body is:',
    options: ['80 N', '160 N', '40 N', '320 N'],
    correctOption: 1,
    explanation:
      'Centripetal force F = mω²r = 5 × (4)² × 2 = 5 × 16 × 2 = 160 N.',
    marks: { correct: 4, incorrect: -1 },
    year: 2023,
  },
  {
    id: 'q002',
    subject: 'Physics',
    topic: 'Thermodynamics',
    subtopic: 'First Law',
    difficulty: 'medium',
    question:
      'An ideal gas expands isothermally from volume 2 L to 10 L against a constant external pressure of 2 atm. The work done by the gas is: (1 L·atm = 101.3 J)',
    options: ['-1622 J', '+1622 J', '-810 J', '+810 J'],
    correctOption: 0,
    explanation:
      'W = −P_ext × ΔV = −2 × (10 − 2) = −16 L·atm = −16 × 101.3 = −1620.8 J ≈ −1622 J. Work done ON gas is positive; BY gas is negative (compression convention).',
    marks: { correct: 4, incorrect: -1 },
    year: 2022,
  },
  {
    id: 'q003',
    subject: 'Physics',
    topic: 'Modern Physics',
    subtopic: 'Photoelectric Effect',
    difficulty: 'easy',
    question:
      'A photon has wavelength 600 nm. The energy of the photon is (h = 6.63 × 10⁻³⁴ J·s, c = 3 × 10⁸ m/s):',
    options: ['2.07 eV', '3.30 eV', '1.65 eV', '4.14 eV'],
    correctOption: 0,
    explanation:
      'E = hc/λ = (6.63×10⁻³⁴ × 3×10⁸) / (600×10⁻⁹) = 3.315×10⁻¹⁹ J = 3.315×10⁻¹⁹ / 1.6×10⁻¹⁹ eV ≈ 2.07 eV.',
    marks: { correct: 4, incorrect: -1 },
    year: 2024,
  },
  {
    id: 'q004',
    subject: 'Chemistry',
    topic: 'Organic Chemistry',
    subtopic: 'Nomenclature',
    difficulty: 'easy',
    question: 'The IUPAC name of the compound CH₃-CH(OH)-CH₂-CH₃ is:',
    options: ['1-butanol', 'butan-2-ol', '2-methylpropanol', 'butan-3-ol'],
    correctOption: 1,
    explanation:
      'The parent chain has 4 carbons (but-). The OH group is on C2. Hence: butan-2-ol.',
    marks: { correct: 4, incorrect: -1 },
    year: 2023,
  },
  {
    id: 'q005',
    subject: 'Chemistry',
    topic: 'Atomic Structure',
    subtopic: 'd-block Elements',
    difficulty: 'medium',
    question:
      'The number of unpaired electrons in the Fe³⁺ ion is: (Fe: Z = 26)',
    options: ['3', '4', '5', '6'],
    correctOption: 2,
    explanation:
      'Fe = [Ar] 3d⁶ 4s². Fe³⁺ loses 3 electrons → [Ar] 3d⁵. The half-filled 3d⁵ has 5 unpaired electrons (Hund\'s rule).',
    marks: { correct: 4, incorrect: -1 },
    year: 2022,
  },
  {
    id: 'q006',
    subject: 'Chemistry',
    topic: 'Chemical Bonding',
    subtopic: 'Sigma & Pi Bonds',
    difficulty: 'easy',
    question: 'The total number of sigma (σ) bonds in benzene (C₆H₆) is:',
    options: ['6', '9', '12', '18'],
    correctOption: 2,
    explanation:
      'Benzene has 6 C−C bonds + 6 C−H bonds = 12 sigma bonds. The 3 pi bonds are part of the delocalized π system.',
    marks: { correct: 4, incorrect: -1 },
    year: 2024,
  },
  {
    id: 'q007',
    subject: 'Biology',
    topic: 'Photosynthesis',
    subtopic: 'Light Reactions',
    difficulty: 'easy',
    question: 'The light reactions of photosynthesis occur in the:',
    options: [
      'Stroma of chloroplast',
      'Thylakoid membrane',
      'Mitochondrial matrix',
      'Cytoplasm',
    ],
    correctOption: 1,
    explanation:
      'Light reactions (photophosphorylation, water splitting, NADPH formation) occur on the thylakoid membranes where photosystems I and II are embedded.',
    marks: { correct: 4, incorrect: -1 },
    year: 2023,
  },
  {
    id: 'q008',
    subject: 'Biology',
    topic: 'Genetics',
    subtopic: 'Protein Synthesis',
    difficulty: 'medium',
    question:
      'A tRNA has the anticodon 3′-AAA-5′. The mRNA codon that it recognises (5′→3′) is:',
    options: ['AAA', 'UUU', 'TTT', 'GGG'],
    correctOption: 1,
    explanation:
      "Anticodons are read 3′→5′ while codons are read 5′→3′. Anticodon 3′-AAA-5′ pairs with mRNA codon 5′-UUU-3′ (A pairs with U in RNA).",
    marks: { correct: 4, incorrect: -1 },
    year: 2022,
  },
  {
    id: 'q009',
    subject: 'Biology',
    topic: 'Plant Kingdom',
    subtopic: 'Reproduction',
    difficulty: 'easy',
    question: 'Double fertilisation is a characteristic feature of:',
    options: ['Algae', 'Bryophytes', 'Gymnosperms', 'Angiosperms'],
    correctOption: 3,
    explanation:
      'Double fertilisation (syngamy + triple fusion) is unique to angiosperms. One sperm fertilises the egg (→ zygote); the other fuses with polar nuclei (→ triploid endosperm).',
    marks: { correct: 4, incorrect: -1 },
    year: 2024,
  },
  {
    id: 'q010',
    subject: 'Biology',
    topic: 'Respiration',
    subtopic: 'Krebs Cycle',
    difficulty: 'easy',
    question: 'The Krebs cycle (TCA cycle) takes place in the:',
    options: [
      'Cytoplasm',
      'Mitochondrial matrix',
      'Inner mitochondrial membrane',
      'Nucleus',
    ],
    correctOption: 1,
    explanation:
      'The Krebs/TCA cycle enzymes are dissolved in the mitochondrial matrix. Electron transport chain is on the inner membrane.',
    marks: { correct: 4, incorrect: -1 },
    year: 2023,
  },
];

export const SUBJECT_COLORS = {
  Physics:   { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  Chemistry: { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500'  },
  Biology:   { bg: 'bg-rose-50',   text: 'text-rose-700',   dot: 'bg-rose-500'   },
};
