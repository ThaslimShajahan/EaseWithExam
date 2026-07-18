import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FlaskConical, GraduationCap, BarChart3, Brain } from 'lucide-react';
import { motion } from 'framer-motion';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home'     },
  { to: '/study',     icon: FlaskConical,    label: 'Study'    },
  { to: '/doubt',     icon: Brain,           label: 'EWE',     special: true },
  { to: '/exams',     icon: GraduationCap,   label: 'Exams'   },
  { to: '/progress',  icon: BarChart3,       label: 'Progress' },
];

export default function BottomNav() {
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/85 backdrop-blur-xl
                 border-t border-slate-200/80 flex items-stretch h-[65px]
                 shadow-[0_-8px_24px_rgba(15,23,42,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV.map(({ to, icon: Icon, label, special }) => (
        <NavLink
          key={to}
          to={to}
          className="relative flex-1 no-tap-highlight min-h-[44px] focus-visible:outline-none focus-visible:bg-primary-50"
        >
          {({ isActive }) =>
            special ? (
              <div className="flex-1 flex items-center justify-center h-full">
                <motion.div
                  whileTap={{ scale: 0.92 }}
                  className={[
                    'h-12 w-12 rounded-2xl flex flex-col items-center justify-center',
                    '-mt-5 shadow-float',
                    isActive ? 'bg-gradient-to-br from-primary-500 to-primary-700' : 'bg-gradient-to-br from-primary-600 to-primary-800',
                  ].join(' ')}
                >
                  <Icon size={20} className="text-white" strokeWidth={2} />
                </motion.div>
              </div>
            ) : (
              <motion.div
                whileTap={{ scale: 0.92 }}
                className="relative flex flex-col items-center justify-center h-full gap-0.5 pt-1"
              >
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-active"
                    className="absolute top-1.5 h-1 w-5 rounded-full bg-primary-600"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon
                  size={20}
                  className={isActive ? 'text-primary-600' : 'text-slate-400'}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                <span className={`text-[10px] font-semibold ${isActive ? 'text-primary-600' : 'text-slate-400'}`}>
                  {label}
                </span>
              </motion.div>
            )
          }
        </NavLink>
      ))}
    </nav>
  );
}
