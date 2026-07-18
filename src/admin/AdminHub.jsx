import { Suspense } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAdminFilter } from './hooks/useAdminFilter';

/**
 * Shared tab-bar shell for grouped admin sections (Content, Publish, Academic,
 * Students, Platform, Ops, People) — groups what used to be ~27 separate
 * top-level sidebar links into a handful of hubs, each with tabs inside.
 *
 * @param {string} title
 * @param {string} [subtitle]
 * @param {Array<{ id: string, icon: Component, label: string, element: ReactNode }>} tabs
 * @param {string} defaultTab
 */
export default function AdminHub({ title, subtitle, tabs, defaultTab }) {
  const [tab, setTab] = useAdminFilter('tab', defaultTab);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-slate-400 text-sm mt-1">{subtitle}</p>}
      </div>

      <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
        {tabs.map(({ id, icon: Icon, label }) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={[
                'relative flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors shrink-0',
                isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              <Icon size={15} className={isActive ? 'text-primary-400' : 'text-slate-500'} />
              {label}
              {isActive && (
                <motion.div
                  layoutId="admin-hub-underline"
                  className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary-500 rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary-500" size={24} /></div>}>
        {active.element}
      </Suspense>
    </div>
  );
}
