/**
 * Chemical structure rendering via SMILES.
 *
 * WHY THIS EXISTS SEPARATELY FROM diagrams.js: asking an LLM to author SVG for
 * a molecule does not work. Across two rounds of prompt tuning it kept
 * producing benzene rings with no alternating double bonds, bonds at
 * impossible angles, and atom labels colliding with the drawing. That is not a
 * prompt problem — drawing a molecule correctly requires knowing bond lengths,
 * ring geometry and layout rules that a language model is not computing.
 *
 * What a language model IS reliably good at is emitting SMILES, because SMILES
 * is text and it has seen enormous amounts of it. So: model produces the
 * SMILES string, and smiles-drawer (a real cheminformatics layout engine) does
 * the geometry. Output matches printed textbook structures — correct aromatic
 * rings, double bonds, substituent placement.
 *
 * Non-molecular chemistry figures (galvanic cells, apparatus, energy profiles)
 * are NOT molecules and still go through diagrams.js's SVG path.
 */

import { chatComplete } from './aiProxy';

const SMILES_SYSTEM = 'You convert descriptions of chemical species into SMILES. You reply with a SMILES string or the single word NONE. Never explain.';

/**
 * Ask for a SMILES string, if the description actually names one molecule.
 * Returns null for apparatus/process diagrams, which belong on the SVG path.
 */
export async function smilesFromDescription(description, { signal } = {}) {
  if (!description) return null;
  try {
    const res = await chatComplete({
      model: 'gpt-4o',
      max_tokens: 120,
      temperature: 0,
      messages: [
        { role: 'system', content: SMILES_SYSTEM },
        { role: 'user', content: `Figure description:
"${description}"

If this describes the structure of ONE chemical compound or molecule, reply with
its SMILES string only.

Reply NONE if it describes anything else — apparatus, a galvanic/electrochemical
cell, a titration setup, an energy profile, a graph, a reaction scheme with
multiple species, or a process rather than a single structure.

Examples:
"Structural formula of phenol, a benzene ring with an OH group" -> Oc1ccccc1
"Lewis structure of carbon dioxide" -> O=C=O
"Galvanic cell with zinc and copper electrodes" -> NONE
"Energy profile of an exothermic reaction" -> NONE` },
      ],
    }, { signal });

    const raw = (res?.choices?.[0]?.message?.content ?? '').trim().split(/\s+/)[0];
    if (!raw || /^none$/i.test(raw)) return null;
    // SMILES charset — rejects prose that slipped through.
    if (!/^[A-Za-z0-9@+\-[\]()\\/=#$%.*]+$/.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Render a SMILES string to an SVG data URI.
 *
 * Browser-only: smiles-drawer needs a DOM to lay out into. Loaded dynamically
 * so the ~100KB library is only fetched when a chemistry figure is actually
 * generated, rather than on every page load.
 */
export async function renderSmiles(smiles, { width = 480, height = 340 } = {}) {
  if (!smiles || typeof document === 'undefined') return null;
  try {
    const mod = await import('smiles-drawer');
    const SD = mod.default ?? mod;

    // Off-document element: laid out, serialised, then discarded. Never
    // attached, so it can't affect page layout or be seen mid-render.
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(height));
    svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const drawer = new SD.SvgDrawer({
      width, height,
      bondThickness: 1.2,
      fontSizeLarge: 13,
      fontSizeSmall: 9,
      terminalCarbons: true,
    });

    const parsed = await new Promise((resolve) => {
      SD.parse(smiles, (tree) => resolve(tree), () => resolve(null));
    });
    if (!parsed) return null;

    // 'light' theme — exam papers print on white.
    drawer.draw(parsed, svgEl, 'light', false);

    const markup = new XMLSerializer().serializeToString(svgEl);
    if (!/<(path|line|circle|polygon|text)\b/i.test(markup)) return null;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
  } catch {
    return null;
  }
}

/**
 * Full path: figure description -> SMILES -> rendered structure.
 * Returns null when the description isn't a single molecule, so the caller
 * can fall back to generic SVG generation.
 */
export async function structureFromDescription(description, { signal } = {}) {
  const smiles = await smilesFromDescription(description, { signal });
  if (!smiles) return null;
  return renderSmiles(smiles);
}
