/**
 * EmptyState — unified empty / zero-data view.
 *
 * "An empty screen is an invitation to act."
 * Every EmptyState must have an action (or at least a clear label).
 *
 * Props:
 *   icon      — Lucide icon component (e.g. FileText)
 *   title     — one short sentence, plain language
 *   body      — optional: one sentence of direction
 *   action    — { label: string, onClick: fn } | null
 *   size      — 'sm' | 'md' (default 'md')
 *   className — extra wrapper classes
 */
export default function EmptyState({ icon: Icon, title, body, action, size = 'md', className = '' }) {
  const isSmall = size === 'sm';

  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 ${isSmall ? 'py-8 px-4' : 'py-16 px-6'} ${className}`}>
      {Icon && (
        <div className={`rounded-2xl bg-slate-100 flex items-center justify-center ${isSmall ? 'h-10 w-10' : 'h-14 w-14'}`}>
          <Icon size={isSmall ? 18 : 24} className="text-slate-400" />
        </div>
      )}

      <div className={`space-y-1 ${isSmall ? 'max-w-[200px]' : 'max-w-[260px]'}`}>
        <p className={`font-semibold text-slate-700 ${isSmall ? 'text-sm' : 'text-base'}`}>
          {title}
        </p>
        {body && (
          <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
        )}
      </div>

      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 px-4 py-3.5 rounded-control bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
