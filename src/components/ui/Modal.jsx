import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, size = 'md', className = '' }) {
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' };

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className={`relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full ${sizes[size]} ${className}`}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0,  opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          >
            {/* Handle (mobile) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-slate-300" />
            </div>

            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">{title}</h2>
                <button
                  onClick={onClose}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
