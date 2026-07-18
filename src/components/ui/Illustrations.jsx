/* SVG illustrations and doodle elements used across the platform */

/* ── Science doodles for auth + backgrounds ─────────────── */

export function AtomDoodle({ size = 60, opacity = 0.15, color = 'white' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" opacity={opacity}>
      <ellipse cx="30" cy="30" rx="28" ry="10" stroke={color} strokeWidth="1.5" />
      <ellipse cx="30" cy="30" rx="28" ry="10" stroke={color} strokeWidth="1.5" transform="rotate(60 30 30)" />
      <ellipse cx="30" cy="30" rx="28" ry="10" stroke={color} strokeWidth="1.5" transform="rotate(120 30 30)" />
      <circle cx="30" cy="30" r="4" fill={color} />
      <circle cx="58" cy="30" r="2.5" fill={color} />
    </svg>
  );
}

export function DNADoodle({ height = 80, opacity = 0.12, color = 'white' }) {
  return (
    <svg width="30" height={height} viewBox={`0 0 30 ${height}`} fill="none" opacity={opacity}>
      {Array.from({ length: Math.floor(height / 12) }).map((_, i) => {
        const y  = i * 12 + 6;
        const x1 = 5  + Math.sin(i * 1.2) * 10;
        const x2 = 25 - Math.sin(i * 1.2) * 10;
        return (
          <g key={i}>
            <circle cx={x1} cy={y} r="2.5" fill={color} />
            <circle cx={x2} cy={y} r="2.5" fill={color} />
            <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1" />
          </g>
        );
      })}
    </svg>
  );
}

export function FormulaText({ children, opacity = 0.12, color = 'white', size = 16 }) {
  return (
    <span
      className="font-mono select-none pointer-events-none"
      style={{ color, opacity, fontSize: size, fontWeight: 600 }}
    >
      {children}
    </span>
  );
}

export function StarDoodle({ size = 20, opacity = 0.2, color = 'white' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} opacity={opacity}>
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

export function WaveDoodle({ width = 120, opacity = 0.1, color = 'white' }) {
  return (
    <svg width={width} height="24" viewBox={`0 0 ${width} 24`} fill="none" opacity={opacity}>
      <path
        d={`M0 12 ${Array.from({ length: Math.floor(width / 20) }, (_, i) =>
          `Q${i * 20 + 10} ${i % 2 === 0 ? 2 : 22} ${(i + 1) * 20} 12`
        ).join(' ')}`}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TestTubeDoodle({ size = 40, opacity = 0.15, color = 'white' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" opacity={opacity}>
      <path d="M14 4 L14 26 Q14 34 20 34 Q26 34 26 26 L26 4" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="4" x2="28" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="20" cy="30" rx="4" ry="2" fill={color} opacity={0.4} />
      <circle cx="17" cy="22" r="1.5" fill={color} opacity={0.5} />
      <circle cx="23" cy="25" r="1" fill={color} opacity={0.5} />
    </svg>
  );
}

/* ── Empty state illustrations ──────────────────────────── */

export function NoTestsIllustration() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Desk */}
      <rect x="10" y="75" width="100" height="8" rx="4" fill="#E2E8F0" />

      {/* Book stack */}
      <rect x="20" y="55" width="30" height="20" rx="3" fill="#818CF8" />
      <rect x="22" y="50" width="26" height="5" rx="2" fill="#6366F1" />
      <rect x="20" y="63" width="30" height="4" rx="1" fill="#A5B4FC" opacity="0.6" />
      <rect x="20" y="59" width="30" height="4" rx="1" fill="#A5B4FC" opacity="0.4" />

      {/* Answer sheet */}
      <rect x="55" y="38" width="45" height="37" rx="4" fill="white" stroke="#E2E8F0" strokeWidth="1.5" />
      <line x1="62" y1="50" x2="92" y2="50" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="62" y1="57" x2="88" y2="57" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="62" y1="64" x2="85" y2="64" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />

      {/* Pencil */}
      <rect x="90" y="30" width="6" height="28" rx="3" fill="#FCD34D" transform="rotate(-20 90 30)" />
      <path d="M85 52 L83 58 L89 56Z" fill="#F87171" transform="rotate(-20 85 52)" />

      {/* Stars */}
      <circle cx="45" cy="25" r="3" fill="#FCD34D" />
      <circle cx="105" cy="20" r="2" fill="#A5B4FC" />
      <circle cx="15" cy="40" r="2.5" fill="#6EE7B7" />

      {/* Trophy outline */}
      <path d="M52 18 Q52 30 60 30 Q68 30 68 18 Z" stroke="#F59E0B" strokeWidth="1.5" fill="none" />
      <line x1="60" y1="30" x2="60" y2="35" stroke="#F59E0B" strokeWidth="1.5" />
      <line x1="55" y1="35" x2="65" y2="35" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function StudyingIllustration() {
  return (
    <svg width="100" height="80" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Laptop screen */}
      <rect x="15" y="15" width="60" height="40" rx="4" fill="#1E1B4B" />
      <rect x="18" y="18" width="54" height="34" rx="2" fill="#312E81" />

      {/* Screen content (graph) */}
      <polyline points="22,44 30,36 38,40 46,28 54,32 62,24 68,30" stroke="#818CF8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="62" cy="24" r="2.5" fill="#6EE7B7" />

      {/* Laptop base */}
      <path d="M10 55 L90 55 L85 60 L15 60Z" fill="#E2E8F0" />

      {/* Person */}
      <circle cx="50" cy="8" r="7" fill="#FDE68A" />
      <path d="M43 55 L43 30 Q50 26 57 30 L57 55" fill="#6366F1" />
      <line x1="43" y1="38" x2="35" y2="48" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" />
      <line x1="57" y1="38" x2="65" y2="48" stroke="#6366F1" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ── Brand panel science background ─────────────────────── */
export function ScienceBg() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* Atoms */}
      <div className="absolute top-8 right-12">   <AtomDoodle size={80}  opacity={0.10} /></div>
      <div className="absolute bottom-24 left-6"> <AtomDoodle size={50}  opacity={0.08} /></div>
      <div className="absolute top-1/2 left-1/3"> <AtomDoodle size={40}  opacity={0.07} /></div>

      {/* DNA strands */}
      <div className="absolute top-20 left-8">    <DNADoodle height={100} opacity={0.10} /></div>
      <div className="absolute bottom-10 right-8"><DNADoodle height={70}  opacity={0.08} /></div>

      {/* Formulas */}
      <div className="absolute top-32 right-6">   <FormulaText size={14}>F = ma</FormulaText></div>
      <div className="absolute top-44 right-8">   <FormulaText size={12}>E = hν</FormulaText></div>
      <div className="absolute bottom-36 left-10"><FormulaText size={13}>PV = nRT</FormulaText></div>
      <div className="absolute top-[55%] right-4"><FormulaText size={12}>∑F = 0</FormulaText></div>

      {/* Stars */}
      <div className="absolute top-16 left-1/2">   <StarDoodle size={16} opacity={0.20} /></div>
      <div className="absolute bottom-20 left-1/3"><StarDoodle size={12} opacity={0.15} /></div>
      <div className="absolute top-3/4 right-1/4"> <StarDoodle size={14} opacity={0.18} /></div>

      {/* Test tubes */}
      <div className="absolute bottom-16 right-14"><TestTubeDoodle size={36} opacity={0.12} /></div>

      {/* Wave */}
      <div className="absolute top-[70%] left-0"><WaveDoodle width={160} opacity={0.08} /></div>
    </div>
  );
}
