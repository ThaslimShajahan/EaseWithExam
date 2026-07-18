/**
 * Chip — unified filter/tag chip.
 *
 * Selected state is IDENTICAL everywhere: filled primary-600 background,
 * white text. Unselected: slate-100 bg, slate-600 text.
 * This replaces the mixed indigo/outline/emerald selected states
 * found across Practice, ExamCenter, admin filters.
 *
 * Props:
 *   label     — display text
 *   selected  — boolean
 *   onClick   — handler
 *   disabled  — boolean
 *   size      — 'sm' | 'md' (default 'sm')
 *   className — extra classes
 *   dark      — true for dark-surface (admin) context
 */
export default function Chip({
  label,
  selected  = false,
  onClick,
  disabled  = false,
  size      = 'sm',
  className = '',
  dark      = false,
}) {
  const base   = 'inline-flex items-center font-semibold rounded-control transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400';
  const sizeCls = size === 'sm' ? 'px-3 py-1 text-micro' : 'px-4 py-1.5 text-caption';

  const idleCls = dark
    ? 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800';

  const activeCls = 'bg-primary-600 text-white hover:bg-primary-700';
  const disabledCls = 'opacity-40 cursor-not-allowed pointer-events-none';

  return (
    <button
      type="button"
      onClick={!disabled ? onClick : undefined}
      className={[base, sizeCls, selected ? activeCls : idleCls, disabled ? disabledCls : 'cursor-pointer', className].join(' ')}
      aria-pressed={selected}
    >
      {label}
    </button>
  );
}

/**
 * ChipGroup — renders a row of chips with single-select behaviour.
 *
 * Props:
 *   options  — Array<{ value, label }> | Array<string>
 *   value    — currently selected value
 *   onChange — (value) => void
 *   all      — if provided, shows an "All" chip for null/'' value
 *   size, dark, className forwarded to each Chip
 */
export function ChipGroup({ options = [], value, onChange, all, size, dark, className = '' }) {
  const normalised = options.map((o) => typeof o === 'string' ? { value: o, label: o } : o);

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="group">
      {all !== undefined && (
        <Chip
          label={typeof all === 'string' ? all : 'All'}
          selected={value === '' || value == null}
          onClick={() => onChange('')}
          size={size}
          dark={dark}
        />
      )}
      {normalised.map(({ value: v, label }) => (
        <Chip
          key={v}
          label={label}
          selected={value === v}
          onClick={() => onChange(v)}
          size={size}
          dark={dark}
        />
      ))}
    </div>
  );
}
