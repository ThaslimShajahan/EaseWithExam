import { motion } from 'framer-motion';

/**
 * Underline tab row for single-select navigation within an admin page (e.g. the
 * exam-type switcher inside Syllabus Manager / Content Map). Shares the same
 * visual language as the outer AdminHub tab bar so every level of tab
 * navigation in the admin portal looks consistent.
 *
 * @param {{key: string, label: string}[]} items
 * @param {string} active
 * @param {(key: string) => void} onChange
 * @param {string} [layoutId] - unique per tab row when more than one renders on screen at once
 */
export default function TabRow({ items, active, onChange, layoutId = 'admin-tab-row-underline' }) {
  return (
    <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
      {items.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={[
              'relative px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors shrink-0',
              isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200',
            ].join(' ')}
          >
            {label}
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary-500 rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
