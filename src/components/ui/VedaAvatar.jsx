/* Veda — EaseWithExam's AI tutor persona.
   Available in two sizes: 'sm' (chat bubble, 32px) and 'lg' (intro card, 72px). */

function VedaFace({ size = 32 }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vedaBg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="vedaSkin" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FDE68A" />
          <stop offset="1" stopColor="#FCD34D" />
        </linearGradient>
      </defs>

      {/* Background circle */}
      <circle cx="40" cy="40" r="40" fill="url(#vedaBg)" />

      {/* Graduation cap */}
      <rect x="22" y="22" width="36" height="5" rx="2.5" fill="#1E1B4B" />
      <path d="M40 22 L56 27 L40 32 L24 27Z" fill="#312E81" />
      <line x1="56" y1="27" x2="60" y2="36" stroke="#312E81" strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="37" r="2" fill="#FCD34D" />

      {/* Face */}
      <circle cx="40" cy="46" r="17" fill="url(#vedaSkin)" />

      {/* Eyes */}
      <ellipse cx="34" cy="43" rx="2.5" ry="3" fill="#1E1B4B" />
      <ellipse cx="46" cy="43" rx="2.5" ry="3" fill="#1E1B4B" />

      {/* Eye shine */}
      <circle cx="35" cy="42" r="1" fill="white" />
      <circle cx="47" cy="42" r="1" fill="white" />

      {/* Smile */}
      <path d="M33 50 Q40 56 47 50" stroke="#92400E" strokeWidth="1.8" strokeLinecap="round" fill="none" />

      {/* Cheeks */}
      <circle cx="30" cy="49" r="3.5" fill="#FCA5A5" fillOpacity="0.5" />
      <circle cx="50" cy="49" r="3.5" fill="#FCA5A5" fillOpacity="0.5" />

      {/* Book in corner (lg only) */}
      {size > 40 && (
        <>
          <rect x="10" y="54" width="12" height="16" rx="1.5" fill="#4338CA" />
          <rect x="10" y="54" width="2" height="16" rx="1" fill="#6366F1" />
          <line x1="13" y1="59" x2="21" y2="59" stroke="white" strokeWidth="1" strokeOpacity="0.5" />
          <line x1="13" y1="62" x2="20" y2="62" stroke="white" strokeWidth="1" strokeOpacity="0.5" />
        </>
      )}
    </svg>
  );
}

export function VedaAvatarSm() {
  return <VedaFace size={32} />;
}

export function VedaAvatarLg() {
  return <VedaFace size={72} />;
}

/* Inline chip shown in headers: "Veda · AI Tutor" */
export function VedaChip() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-7 w-7 rounded-full overflow-hidden shrink-0">
        <VedaFace size={28} />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900 leading-none">EWE</p>
        <p className="text-[10px] text-slate-400 leading-none mt-0.5">Your study companion</p>
      </div>
    </div>
  );
}

export default VedaFace;
