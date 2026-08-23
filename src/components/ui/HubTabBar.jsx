import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/**
 * Sticky tab bar shared by the student hub pages (Study, Progress). A soft
 * sliding pill behind the active tab (instead of a thin underline) so the
 * strip reads as one deliberate control rather than a row of plain text
 * links with a colored line under one of them.
 */
export default function HubTabBar({ tabs, active, onChange, layoutId = 'hub-tab-underline' }) {
  const scrollRef = useRef(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    function checkScroll() {
      const el = scrollRef.current;
      if (!el) return;
      setShowLeftFade(el.scrollLeft > 8);
      setShowRightFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    }
    checkScroll();
    const el = scrollRef.current;
    el?.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el?.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, []);

  return (
    <div className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-200 px-2 py-2">
      <div className="relative">
        <div ref={scrollRef} className="flex items-center gap-0.5 overflow-x-auto no-scrollbar pr-8 scroll-smooth">
          {tabs.map(({ key, label, icon: Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={[
                  'relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors rounded-xl shrink-0',
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

        {/* Left fade: only visible when scrolled away from start */}
        {showLeftFade && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white/85 to-transparent" />
        )}

        {/* Right fade: visible when content overflows to the right */}
        {showRightFade && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/85 to-transparent" />
        )}
      </div>
    </div>
  );
}
