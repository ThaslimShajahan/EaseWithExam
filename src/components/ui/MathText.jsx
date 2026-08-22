import katex from 'katex';
import 'katex/dist/katex.min.css';

// Pre-process bare LaTeX that the AI emits without $ delimiters.
// Strategy: everything wrapped in $...$ goes into a protected chunks array so
// later steps never re-process the same content.
function normalizeLatex(text) {
  if (!text || typeof text !== 'string') return text;

  // Recover LaTeX commands corrupted by JSON escape processing.
  // When AI embeds \frac in a JSON string, \f is the JSON form-feed escape (0x0C),
  // so JSON.parse strips the backslash and leaves: form-feed + "rac{...}".
  // Same issue affects \b (backspace 0x08): \beta → 0x08 + "eta", etc.
  let t = text
    .replace(/\x0c([a-zA-Z]{2,})/g, '\\f$1')  // \f escape → restore \frac, \forall, …
    .replace(/\x08([a-zA-Z]{2,})/g, '\\b$1'); // \b escape → restore \beta, \bar, \binom, …

  if (!t.includes('\\')) return t;

  const chunks = [];
  // Returns a placeholder token and records the chunk so it isn't re-scanned.
  const protect = (s) => { chunks.push(s); return `\x00${chunks.length - 1}\x00`; };

  // Step 1: protect already-delimited math  ($...$  $$...$$  \(...\))
  t = t.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)/g, protect);

  // Step 2: wrap  N^\command  as one unit  e.g. "180^\circ" → "$180^\circ$"
  t = t.replace(/(\d+(?:\.\d+)?)\s*\^\s*(\\[a-zA-Z]+)/g,
    (_, n, cmd) => protect(`$${n}^${cmd}$`));

  // Step 3: wrap remaining bare LaTeX command sequences
  // Handles: \pi  \sqrt{3}  \frac{3}{4}  \frac{\sqrt{2}}{3}  \vec{v}  etc.
  t = t.replace(/\\[a-zA-Z]{2,}(?:\{(?:[^{}]|\{[^{}]*\})*\})*/g,
    (m) => protect(`$${m}$`));

  // Step 4: restore protected chunks
  t = t.replace(/\x00(\d+)\x00/g, (_, i) => chunks[+i]);

  return t;
}

// Splits a string into plain-text and inline-math segments.
function parseSegments(text) {
  const segments = [];
  const src = normalizeLatex(String(text));
  // Require $...$ content to look like math — a LaTeX indicator (\cmd, ^, _, {, }),
  // a digit directly touching a letter (3x, x2 — algebraic shorthand), an "="
  // sign (F = ma, v = u + at — pure-letter physics/algebra equations with no
  // digits at all, still not real currency in any plausible prose), or a
  // square bracket (interval/set notation, e.g. $[-1, 1]$ — brackets never
  // appear in a plausible currency phrase, so this adds no false-positive
  // risk) — so plain currency like "$500 and $600" is never mistaken for
  // math delimiters.
  const re  = /\\\([\s\S]+?\\\)|\$(?=[^$\n]*(?:\\[a-zA-Z]|[_^{}=[\]]|\d[a-zA-Z]|[a-zA-Z]\d))[^$\n]+?\$/g;
  let last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: src.slice(last, m.index) });
    const raw   = m[0];
    const latex = raw.startsWith('\\(') ? raw.slice(2, -2) : raw.slice(1, -1);
    segments.push({ type: 'math', latex });
    last = m.index + raw.length;
  }
  if (last < src.length) segments.push({ type: 'text', value: src.slice(last) });
  return segments;
}

export default function MathText({ text = '', className = '' }) {
  if (!text) return null;
  const segments = parseSegments(String(text));

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.value}</span>;
        try {
          const html = katex.renderToString(seg.latex, {
            throwOnError: false,
            strict:       false,
            trust:        false,
          });
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
          return <span key={i} className="text-red-400 text-xs">{seg.latex}</span>;
        }
      })}
    </span>
  );
}
