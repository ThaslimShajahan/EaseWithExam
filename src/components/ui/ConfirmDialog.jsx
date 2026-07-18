/**
 * ConfirmDialog — unified destructive-action confirmation.
 *
 * Rules (per addendum Step 5):
 *  - Red ghost + filled button pair
 *  - Names the object AND count in the message
 *  - Never a bare trash icon with no confirm
 *
 * Props:
 *   open        — boolean
 *   onClose     — () => void
 *   onConfirm   — () => void  (async OK)
 *   title       — e.g. "Delete 14 questions?"
 *   description — e.g. "This removes them from all future tests. Can't be undone."
 *   confirmLabel — button label, default "Delete"
 *   loading     — boolean (shows spinner on confirm button)
 *   danger      — true (default) for red confirm; false for neutral
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title       = 'Are you sure?',
  description,
  confirmLabel = 'Delete',
  loading     = false,
  danger      = true,
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const confirmCls = danger
    ? 'bg-danger hover:bg-danger-dark text-white'
    : 'bg-primary-600 hover:bg-primary-700 text-white';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative bg-slate-900 border border-white/10 rounded-card shadow-2xl w-full max-w-sm p-6 space-y-4"
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
          >
            <div className="flex items-start gap-3">
              {danger && (
                <div className="h-9 w-9 rounded-control bg-red-900/30 border border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle size={16} className="text-red-400" />
                </div>
              )}
              <div className="space-y-1 min-w-0">
                <h3 className="font-semibold text-white text-base leading-snug">{title}</h3>
                {description && (
                  <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-control border border-white/10 text-slate-400 text-sm font-semibold hover:bg-white/5 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className={`px-4 py-2 rounded-control text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 ${confirmCls}`}
              >
                {loading && (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                )}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
