/**
 * Diagram generation for questions that describe a figure.
 *
 * Physics ray diagrams, Chemistry bonding structures and Maths geometry
 * questions are unanswerable without the figure. The AI returns a
 * `diagram_description` for these, and until now that description was shown
 * as literal text ("[Figure: A diagram of a parallelogram ...]"), which is
 * not a usable exam paper.
 *
 * WHY SVG RATHER THAN DALL-E: raster image models are unreliable for
 * technical diagrams — they garble text labels and get geometry subtly
 * wrong, which is worse than no figure when a student is learning from it.
 * An LLM emitting SVG gives exact geometry, legible labels, and stays sharp
 * when printed. It is also dramatically cheaper and faster than an image
 * model, which matters because a NEET paper wants a figure on 10-15% of
 * questions. `generateImage()` in aiProxy.js is still there for genuinely
 * pictorial needs.
 *
 * WHY A DATA-URI <img> RATHER THAN INLINE SVG: model-generated markup
 * rendered via dangerouslySetInnerHTML would be an XSS vector. An <img>
 * never executes script or loads external refs, so the same markup is inert.
 * It also means every existing render site keeps working unchanged — they
 * already handle `image_url`.
 */

import { chatComplete } from './aiProxy';
import { structureFromDescription } from './chemStructure';

const SYSTEM = 'You are a technical illustrator producing figures for Indian competitive exam papers (NEET/JEE/CBSE). You output a single self-contained SVG element and nothing else — no markdown, no prose, no code fences.';

/**
 * Per-subject symbol conventions.
 *
 * Without these the model invents its own notation — the first version drew a
 * "circuit diagram" as a grid of plain rectangles with no battery or resistor
 * symbols at all, and a nephron as an abstract blob. Stating the standard
 * symbols explicitly is what moved circuits and optics from unusable to
 * usable; it is the single highest-value part of this prompt.
 */
const CONVENTIONS = {
  Physics: `PHYSICS SYMBOL CONVENTIONS (use these exactly):
- Cell: one long thin line (+) and one short thick line (-) across the wire. A battery is 2+ such pairs.
- Resistor: a 40x14 rectangle on the wire, or a 6-segment zigzag. Label R1/R2 beside it, never inside.
- Ammeter: circle r=12 containing "A". Voltmeter: circle r=12 containing "V".
- Wires: orthogonal lines meeting at right angles; junction dots r=2.5 where 3+ wires meet.
- Series = same wire path. Parallel = separate branches between the SAME two junction dots, drawn >=40px apart.
- Lens: biconvex outline. Mirror: an arc with hatching on the back.
- Optics always shows a horizontal principal axis with F and 2F marked as dots on both sides.`,
  Chemistry: `CHEMISTRY DRAWING CONVENTIONS (use these exactly):
- Atoms are LETTERS (C, H, O, N, S, Zn, Cu) at bond endpoints — never circles.
- Single bond = one line; double = TWO parallel lines 4px apart; triple = three. Draw every double bond the description implies.
- Bond angles must be sensible: ~120 deg for sp2/trigonal, ~109 for sp3, 180 for linear.
- Benzene = regular hexagon with three alternating internal double-bond lines.
- Lone pairs = two filled dots r=1.5 just outside the atom letter.
- Electrochemical cell: two open-topped U beakers, an electrode bar in each, an inverted-U salt bridge between the solution levels, wires up to a voltmeter circle. Solutions labelled below, electrodes above.`,
  Biology: `BIOLOGY DRAWING CONVENTIONS:
- Recognisable outlines drawn with smooth bezier curves, never abstract blobs.
- Nephron: circular Bowman's capsule (r=22) enclosing a tight coiled glomerulus, a coiled proximal tubule, a long hairpin loop of Henle, a coiled distal tubule, then a straight collecting duct leaving downward.
- Every named part gets a leader line out to a margin label.`,
  Mathematics: `MATHEMATICS CONVENTIONS:
- Axes with arrowheads, origin marked O, ticks with numeric labels.
- Vertices labelled with capitals placed just outside the shape.
- Right angles marked with a small square; equal sides marked with tick marks.
- Function graphs: plot at least 7 actual (x, y) points from the equation and
  join them, rather than sketching a curve from memory. Then CHECK the drawn
  curve against the equation before finishing — in SVG the y-axis points DOWN,
  so y = x^2 (a curve opening upward) must have its vertex at the BOTTOM of
  the drawn shape with the arms rising toward smaller y pixel values. Getting
  this inverted is the single most common error here, and a graph that
  contradicts its own equation is worse than no figure at all.`,
};

const buildPrompt = (description, subject) => `Draw this figure for an Indian exam question paper as an SVG.

Subject: ${subject || 'General'}
Figure: ${description}

${CONVENTIONS[subject] ?? ''}

CANVAS
- Output ONE <svg> element only. No markdown fences, no explanation.
- Include viewBox="0 0 520 380", width="520" height="380".
- Draw the figure itself inside x 60-460, y 60-320. The 60px band around the
  edge is reserved for labels, so nothing runs off the canvas.
- EVERY <text> must sit fully inside x 8-512, y 16-372. A label that runs off
  the edge is clipped and unreadable — shorten it or move it inward instead.
  Keep labels under 18 characters.

LAYOUT — the most common failure is text sitting on top of the drawing.
- No <text> may overlap any line, shape, arrow or other <text>. Place every
  label in clear space OUTSIDE the shape it names.
- Leave at least 14px of blank space between a label and any geometry.
- If a part is interior and has no clear space beside it, draw a thin leader
  line (stroke-width 0.75) from the label out to the part rather than putting
  the label on top of it.
- Set text-anchor deliberately: "end" for labels left of the figure, "start"
  for labels to the right, "middle" for labels above or below.
- Before finishing, re-check each <text> x/y against the shapes you drew and
  move any that collide.

STYLE
- Black strokes on a white background. Exam papers print in greyscale, so use
  line weight, dashes and hatching to distinguish things — never colour alone.
- Labels 12-14px sans-serif, exactly as the description names them. If it
  names points A, B, C or parts 1, 2, 3, they must all appear.
- Geometry must be accurate: a parallelogram must have genuinely parallel
  sides, a right angle must be 90 degrees, a convex lens must be biconvex.

SAFETY
- Self-contained only: no <script>, no <foreignObject>, no external href/url()
  references, no embedded raster images, no CSS @import.`;

// Model-supplied markup is sandboxed by being rendered in an <img>, but strip
// the obvious script vectors anyway — defence in depth, and it keeps anything
// that would silently fail to render out of the stored payload.
function sanitizeSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '');
}

function toDataUri(svg) {
  // encodeURIComponent + unescape handles the non-ASCII (arrows, degree signs,
  // subscripts) that btoa alone throws on.
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/**
 * Render one figure description to a data-URI SVG image.
 * @returns {Promise<string|null>} data URI, or null if generation failed —
 *   callers fall back to showing the description text.
 */
export async function generateDiagramSvg(description, subject, { signal } = {}) {
  if (!description) return null;
  try {
    const res = await chatComplete({
      model: 'gpt-4o',
      max_tokens: 1600,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user',   content: buildPrompt(description, subject) },
      ],
    }, { signal, feature: 'diagram-gen' });

    const raw = res?.choices?.[0]?.message?.content ?? '';
    // Models still wrap in ```svg fences often enough to be worth handling.
    const match = raw.match(/<svg[\s\S]*<\/svg>/i);
    if (!match) return null;

    const svg = sanitizeSvg(match[0]);
    // A plausible SVG has real drawing content, not just an empty root.
    if (!/<(path|line|circle|rect|polygon|polyline|ellipse|text|g)\b/i.test(svg)) return null;
    return toDataUri(svg);
  } catch {
    return null;
  }
}

/**
 * Fill in figures for a batch of questions, in place.
 *
 * Only touches questions that describe a figure but have no image attached —
 * an admin-uploaded scan or a real PYQ figure always wins. Runs in small
 * concurrent batches so a 30-question paper doesn't serialise into minutes,
 * and never rejects: a failed figure leaves `diagram_description` in place so
 * the render sites degrade to the description rather than showing nothing.
 *
 * @returns {Promise<number>} how many figures were successfully generated
 */
export async function attachDiagrams(questions, { signal, concurrency = 3 } = {}) {
  const targets = (questions ?? []).filter((q) => q?.diagram_description && !q.image_url);
  if (!targets.length) return 0;

  let generated = 0;
  for (let i = 0; i < targets.length; i += concurrency) {
    if (signal?.aborted) break;
    const slice = targets.slice(i, i + concurrency);
    await Promise.all(slice.map(async (q) => {
      // Chemistry molecular structures go through a real cheminformatics
      // layout engine, not the model's own SVG — see chemStructure.js for
      // why. Returns null for apparatus/energy-profile figures, which are
      // not molecules and belong on the generic SVG path below.
      let uri = null;
      if (q.subject === 'Chemistry') {
        uri = await structureFromDescription(q.diagram_description, { signal });
      }
      if (!uri) uri = await generateDiagramSvg(q.diagram_description, q.subject, { signal });
      if (uri) { q.image_url = uri; generated += 1; }
    }));
  }
  return generated;
}
