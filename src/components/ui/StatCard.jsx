/**
 * StatCard — unified metric display tile.
 *
 * Used on Dashboard and admin Overview. ONE design,
 * not one-off `<div className="card space-y-2">` per page.
 *
 * Props:
 *   icon      — Lucide icon component
 *   iconColor — Tailwind text color class, e.g. 'text-primary-600'
 *   iconBg    — Tailwind bg class, e.g. 'bg-primary-50'
 *   value     — primary metric (string or number)
 *   label     — short metric name
 *   sub       — secondary descriptor (trend, date, etc.)
 *   onClick   — optional click handler (makes card interactive)
 *   badge     — optional { text, className } chip shown top-right
 *   dark      — true for admin (dark surface) variant
 */
export default function StatCard({
  icon: Icon,
  iconColor = 'text-primary-600',
  iconBg    = 'bg-primary-50',
  value,
  label,
  sub,
  onClick,
  badge,
  dark = false,
  className = '',
}) {
  const surface = dark
    ? 'bg-slate-800 border border-white/5 text-white'
    : 'bg-white border border-slate-100 shadow-card text-slate-900';

  const labelCls  = dark ? 'text-slate-400' : 'text-slate-500';
  const subCls    = dark ? 'text-slate-500' : 'text-slate-400';
  const valueCls  = dark ? 'text-white'     : 'text-slate-900';

  return (
    <div
      className={`rounded-card p-5 space-y-3 ${surface} ${onClick ? 'cursor-pointer card-interactive' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="flex items-start justify-between">
        <div className={`h-9 w-9 rounded-control flex items-center justify-center ${dark ? iconBg.replace('-50', '-900/30') : iconBg}`}>
          <Icon size={16} className={iconColor} />
        </div>
        {badge && (
          <span className={`badge text-micro ${badge.className}`}>{badge.text}</span>
        )}
      </div>

      <div>
        <p className={`text-xl font-bold leading-none ${valueCls}`}>{value}</p>
      </div>

      <div>
        <p className={`text-caption font-medium ${labelCls}`}>{label}</p>
        {sub && <p className={`text-micro mt-0.5 ${subCls}`}>{sub}</p>}
      </div>
    </div>
  );
}
