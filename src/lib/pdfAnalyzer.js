import { chatComplete } from './aiProxy';

// Lazy-load pdfjs to avoid bundling it into the initial app bundle. This
// keeps the large `pdfjs-dist` code in a separate chunk that's only fetched
// when a PDF is actually processed.
const PDFJS_VERSION = '6.0.227';
const PDFJS_CDN     = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsLib = null;
async function ensurePdfjs() {
  if (pdfjsLib) return pdfjsLib;

  // pdfjs-dist v6 ships ESM only — the build is `pdf.min.mjs`. Pointing at
  // `pdf.min.js` 404s on that version, which meant EVERY browser-side PDF read
  // (the whole Content Intake screen) failed at the loader before it ever
  // reached extraction. The worker URL below was already correct, which is what
  // made the mismatch easy to miss.
  try {
    pdfjsLib = await import(/* @vite-ignore */ `${PDFJS_CDN}/pdf.min.mjs`);
  } catch {
    // pdfjs-dist is a real dependency, so a CDN outage (or an offline dev
    // machine) doesn't have to take PDF ingestion down with it. Vite serves
    // this from node_modules; it costs a lazy chunk instead of a CDN hit.
    pdfjsLib = await import('pdfjs-dist/build/pdf.min.mjs');
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

/* ── Download strategy: Edge Fn → direct → proxy chain ─── */

const EDGE_URL     = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pdf-proxy`;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY;
const EDGE_HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

const FALLBACK_PROXIES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function tryFetch(url, init = {}, ms = 25_000) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

/**
 * Fetch a PDF from any URL, trying multiple strategies:
 *  1. Supabase Edge Function (server-side, bypasses hotlink protection)
 *  2. Direct browser fetch (works when site allows CORS)
 *  3. Three public CORS proxies
 */
function assertIsPdf(buffer) {
  const bytes = new Uint8Array(buffer, 0, 5);
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!isPdf) throw new Error('Downloaded file is not a valid PDF — site may require login or returned a redirect page');
}

export async function fetchPdfBuffer(pdfUrl) {
  const fname = pdfUrl.split('/').pop().split('?')[0];

  /* 1. Edge Function — most reliable (server-side, bypasses hotlink protection) */
  try {
    const edgeEndpoint = `${EDGE_URL}?url=${encodeURIComponent(pdfUrl)}`;
    if (import.meta.env.DEV) console.log(`[pdf] Edge Function → ${fname}`);
    const r = await tryFetch(edgeEndpoint, { headers: EDGE_HEADERS });
    if (import.meta.env.DEV) console.log(`[pdf] Edge Function ✓ (${r.headers.get('Content-Type')})`);
    const buf = await r.arrayBuffer();
    assertIsPdf(buf);
    return buf;
  } catch (e) {
    // 404 = file genuinely doesn't exist — skip all fallbacks
    if (e.status === 404) throw new Error(`File not found (404): ${fname}`);
    if (import.meta.env.DEV) console.warn(`[pdf] Edge Function failed: ${e.message}`);
  }

  /* 2. Direct fetch */
  try {
    const r = await tryFetch(pdfUrl, {}, 20_000);
    const buf = await r.arrayBuffer();
    assertIsPdf(buf);
    return buf;
  } catch {}

  /* 3. Public proxies */
  for (const make of FALLBACK_PROXIES) {
    try {
      const r = await tryFetch(make(pdfUrl), {}, 25_000);
      const buf = await r.arrayBuffer();
      assertIsPdf(buf);
      return buf;
    } catch {}
  }

  throw new Error('All download methods failed — site may require login or blocks all proxies.');
}

/* ── Stage 1: URL/filename pre-filter (free, instant) ───── */

const EDU_POSITIVE = [
  'question', 'paper', 'syllabus', 'exam', 'test', 'sample', 'model',
  'neet', 'jee', 'cbse', 'ncert', 'scert', 'previous', 'pyq', 'mock',
  'practice', 'answer', 'solution', 'key', 'biology', 'physics',
  'chemistry', 'mathematics', 'maths', 'science', 'curriculum',
  'chapter', 'unit', 'topic', 'lesson', 'study', 'revision', 'notes',
  'textbook', 'book', 'material', 'resource', 'worksheet',
];

const EDU_NEGATIVE = [
  'annual-report', 'tender', 'empanelment', 'procurement', 'gazette',
  'budget', 'salary', 'payroll', 'recruitment', 'job', 'vacancy',
  'notice-inviting', 'minutes-of', 'memorandum', 'invoice', 'bill',
  'quotation', 'agreement', 'contract', 'mou', 'policy', 'guideline',
  'circular-no', 'office-order', 'press-release', 'media', 'brochure',
  'prospectus', 'advertisement', 'manual', 'handbook', 'privacy',
  'terms', 'conditions', 'report-2', 'report-1', 'financial',
  'audit', 'account', 'balance-sheet',
];

export function preFilterUrl(pdfUrl) {
  const normalized = decodeURIComponent(pdfUrl).toLowerCase().replace(/[-_/]/g, ' ');
  const hasPositive = EDU_POSITIVE.some((k) => normalized.includes(k));
  const hasNegative = EDU_NEGATIVE.some((k) => normalized.includes(k));

  if (hasNegative && !hasPositive) {
    const hit = EDU_NEGATIVE.find((k) => normalized.includes(k));
    return { likely: false, reason: `Contains "${hit}" — looks non-educational` };
  }
  return { likely: true };
}

/* ── PDF text extraction ─────────────────────────────────── */

/**
 * Returns an array of one string per PDF page (1-indexed by array position),
 * in original document order. Callers that need the exact, unparaphrased
 * source text for a specific page range (e.g. a literature lesson's real
 * passage, for extract-based English/Hindi/Sanskrit questions) should slice
 * this array directly instead of asking an LLM to "reproduce" the text —
 * models paraphrase even when told not to, so the only reliable verbatim
 * copy is the one taken straight from extraction, never round-tripped
 * through a chat completion.
 */
/** The loaded pdfjs module — needed for its OPS enum when inspecting a page's
 *  operator list (see pageHasRasterImage in pdfVision.js). */
export async function getPdfjs() {
  return ensurePdfjs();
}

/**
 * Opens a PDF and returns the pdfjs document handle.
 *
 * Exported because the vision path (src/lib/pdfVision.js) needs to both read
 * the text layer AND rasterise pages — sharing one parsed document instead of
 * calling getDocument twice on the same bytes.
 */
export async function loadPdfDocument(arrayBuffer) {
  const lib = await ensurePdfjs();
  return lib.getDocument({ data: arrayBuffer }).promise;
}

export async function extractPdfPages(arrayBuffer) {
  const pdf = await loadPdfDocument(arrayBuffer);
  // No page cap — a whole textbook unit (or a full past-paper compilation) must
  // be read in full regardless of how many pages it runs to. This used to be
  // capped (first 20, then 60) to bound how much text a single downstream AI
  // call had to swallow, but that just moved the truncation here instead of
  // fixing it: any cap silently drops whatever content comes after it. The
  // real fix is downstream — callers now split long text into page-aligned
  // batches for AI processing (see splitIntoBatches below) — so every page
  // gets extracted here and nothing is dropped before it even reaches the AI.
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((s) => s.str).join(' '));
  }
  return pages;
}

export async function extractPdfText(arrayBuffer) {
  const pages = await extractPdfPages(arrayBuffer);
  return pages.join('\n\n').trim();
}

/**
 * Splits long extracted text into batches small enough for a single AI call to
 * process without hitting its output-token ceiling, cutting only at page
 * boundaries (extractPdfText joins pages with "\n\n") so a page is never split
 * across two batches. Use this whenever raw PDF text is being sent to an LLM
 * for exhaustive extraction (study notes, PYQs, paper structure, etc.) instead
 * of truncating with a flat `.slice(0, N)`, which silently drops everything
 * past N — a page count that "may vary" upload-to-upload should never mean
 * some uploads quietly lose their later pages.
 */
export function splitIntoBatches(text, maxLen = 30000) {
  const pages = text.split(/\n\n+/);
  const batches = [];
  let current = '';
  for (const page of pages) {
    const candidate = current ? `${current}\n\n${page}` : page;
    if (candidate.length > maxLen && current) {
      batches.push(current);
      current = page;
    } else {
      current = candidate;
    }
  }
  if (current) batches.push(current);
  return batches;
}

/* ── Stage 2: GPT classification + structured analysis ───── */

const ANALYSIS_PROMPT = `You are a content classifier for an Indian NEET/JEE preparation platform.

First decide if this PDF is EDUCATIONAL and relevant. It qualifies if it is:
- A question paper, model paper, previous year paper, or sample paper
- A syllabus or curriculum document
- Study notes, revision material, or NCERT/SCERT content
- An answer key or solution booklet

It does NOT qualify if it is administrative, legal, financial, or HR content.

Return ONLY valid JSON:
- isEducational: boolean
- skipReason: string | null
- subject: "Physics"|"Chemistry"|"Biology"|"Mathematics"|"Mixed"|"Unknown"
- year: integer | null
- board: "NEET"|"JEE Main"|"JEE Advanced"|"CBSE"|"Kerala Board"|"Other"|null
- classLevel: integer 6-12 | null (school grade, ONLY for board content — null for NEET/JEE/competitive)
- paperType: "Question Paper"|"Answer Key"|"Syllabus"|"Notes"|"Other"
- topics: string[] (max 10)
- questions: string[] (up to 5 verbatim questions)
- summary: one sentence`;

/* ── Filename-based inference for image-only PDFs ────────── */
function inferFromFilename(filename) {
  const n = (filename || '').toLowerCase().replace(/[-_.]/g, ' ');

  const isEdu =
    /neet|jee|cbse|ncert|scert|question|paper|syllabus|notes|past.year|previous|pyq|mock|sample|answer.key|model/.test(n);
  if (!isEdu) return null;

  const yearMatch = n.match(/20(1[5-9]|2[0-9])/);
  const year = yearMatch ? parseInt('20' + yearMatch[1]) : null;

  const board =
    /neet/.test(n)         ? 'NEET' :
    /jee.advanced/.test(n) ? 'JEE Advanced' :
    /jee/.test(n)          ? 'JEE Main' :
    /cbse/.test(n)         ? 'CBSE'     : null;

  const classMatch = n.match(/class\s*(\d{1,2})/);
  const classLevel = (board === 'CBSE' && classMatch) ? parseInt(classMatch[1], 10) : null;

  const subject =
    /chemistry/.test(n)         ? 'Chemistry'   :
    /physics/.test(n)           ? 'Physics'     :
    /biology|botany|zoology/.test(n) ? 'Biology' :
    /math/.test(n)              ? 'Mathematics' :
    (board === 'NEET' || board === 'JEE Main' || board === 'JEE Advanced') ? 'Mixed' : 'Unknown';

  const paperType =
    /answer.key|solution/.test(n) ? 'Answer Key' :
    /syllabus/.test(n)            ? 'Syllabus'   :
    /notes/.test(n)               ? 'Notes'      : 'Question Paper';

  return {
    isEducational: true,
    skipReason:    null,
    subject,
    year,
    board,
    classLevel,
    paperType,
    topics:    [],
    questions: [],
    summary:   `${board || subject} ${paperType}${year ? ' ' + year : ''} — image-based PDF, indexed by filename.`,
  };
}

export async function analyzeText(text, filename) {
  const fallback = {
    isEducational: false, skipReason: 'Could not extract readable text',
    subject: 'Unknown', year: null, board: null, classLevel: null, paperType: 'Other',
    topics: [], questions: [], summary: 'Text extraction returned empty content.',
  };

  /* Image-only PDF — no readable text layer */
  if (!text || text.length < 80) {
    const fromName = inferFromFilename(filename);
    if (fromName) {
      console.log(`[analyze] Image PDF, inferred from filename: ${fromName.board || fromName.subject} ${fromName.paperType}`);
      return fromName;
    }
    return fallback;
  }

  /* Text available — let GPT classify */
  try {
    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      900,
      temperature:     0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user',   content: `Filename: ${filename}\n\nContent:\n${text.slice(0, 4_000)}` },
      ],
    }, { feature: 'pdf-analyzer' });
    return { ...fallback, ...JSON.parse(resp.choices[0].message.content) };
  } catch {
    /* GPT failed — fall back to filename inference */
    const fromName = inferFromFilename(filename);
    return fromName || { ...fallback, skipReason: 'GPT error', summary: 'Analysis failed.' };
  }
}

/* ── Manual file → pipeline (for drag-upload fallback) ───── */

export async function processLocalFile(file) {
  const buffer   = await file.arrayBuffer();
  const text     = await extractPdfText(buffer);
  const analysis = await analyzeText(text, file.name);
  return { buffer, text, analysis, filename: file.name };
}
