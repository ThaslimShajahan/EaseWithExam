import { motion } from 'framer-motion';

/**
 * Sticky underline tab bar shared by the student hub pages (Study, Progress).
 * Was duplicated verbatim in both — extracted here, and upgraded with a
 * smoothly sliding active-underline instead of a static border jump.
 */
export default function HubTabBar({ tabs, active, onChange, layoutId = 'hub-tab-underline' }) {
  return (
    <div className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-200 flex items-center gap-0.5 px-2 overflow-x-auto scrollbar-hide">
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={[
              'relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
              isActive ? 'text-primary-600' : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            <Icon size={14} />
            {label}
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary-600 rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
