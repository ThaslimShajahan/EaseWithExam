import { forwardRef } from 'react';
import { motion } from 'framer-motion';

const variants = {
  primary:   'bg-primary-600 hover:bg-primary-700 text-white shadow-float',
  secondary: 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700',
  ghost:     'bg-transparent hover:bg-slate-100 text-slate-600',
  danger:    'bg-red-500 hover:bg-red-600 text-white',
  success:   'bg-emerald-500 hover:bg-emerald-600 text-white',
};

const sizes = {
  sm: 'h-8  px-3  text-xs  gap-1.5',
  md: 'h-10 px-4  text-sm  gap-2',
  lg: 'h-12 px-6  text-base gap-2.5',
  xl: 'h-14 px-8  text-lg  gap-3',
};

const Button = forwardRef(function Button(
  {
    variant  = 'primary',
    size     = 'md',
    loading  = false,
    disabled = false,
    full     = false,
    icon,
    iconRight,
    children,
    className = '',
    ...props
  },
  ref,
) {
  const base =
    'inline-flex items-center justify-center rounded-xl font-semibold ' +
    'transition-all duration-150 select-none no-tap-highlight ' +
    'disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-1';

  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? {} : { scale: 0.97 }}
      className={[base, variants[variant], sizes[size], full ? 'w-full' : '', className].join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children && <span>{children}</span>}
      {iconRight && !loading && <span className="shrink-0">{iconRight}</span>}
    </motion.button>
  );
});

export default Button;
