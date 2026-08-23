import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Shared page header for Study Hub's sub-pages (Notes, Error Notebook, Study
 * Plan, Summarizer, Podcast). Each of these was hand-rolling a near-identical
 * header with small drifts — a hardcoded /dashboard target here, a plain h2
 * with no icon there, no back button on another — so switching tabs felt
 * subtly inconsistent even though each page looked fine in isolation. One
 * component now backs all of them.
 */
export default function HubPageHeader({ icon: Icon, title, subtitle, iconColor = 'text-primary-600', iconBg = 'bg-primary-50', right, showBack = true }) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-3">
      {showBack && (
        <button
          onClick={() => navigate(-1)}
          className="p-3.5 -m-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
      )}
      <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon size={18} className={iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold text-slate-900 truncate">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
