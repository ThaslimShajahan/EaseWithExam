import { motion } from 'framer-motion';

/**
 * Sticky tab bar shared by the student hub pages (Study, Progress). A soft
 * sliding pill behind the active tab (instead of a thin underline) so the
 * strip reads as one deliberate control rather than a row of plain text
 * links with a colored line under one of them.
 */
export default function HubTabBar({ tabs, active, onChange, layoutId = 'hub-tab-underline' }) {
  return (
    <div className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-200 px-2 py-2">
      <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
        {tabs.map(({ key, label, icon: Icon }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={[
                'relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors rounded-xl shrink-0',
                isActive ? 'text-primary-700' : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              {isActive && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-0 bg-primary-50 rounded-xl"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <Icon size={14} className="relative" />
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
