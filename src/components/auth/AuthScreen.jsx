import { motion } from 'framer-motion';
import { AtomDoodle, StarDoodle, FormulaText } from '../ui/Illustrations';
import AuthCard from './AuthCard';

/* Quiet background doodles, same on mobile and desktop. Fixed so page
 * scrolling (mobile OTP keyboard, etc.) doesn't drag them along. */
function BackgroundDoodles() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-10 right-10 lg:right-24">        <AtomDoodle size={70} opacity={0.06} color="#6366F1" /></div>
      <div className="absolute top-24 left-8 lg:left-24">           <StarDoodle size={16} opacity={0.10} color="#6366F1" /></div>
      <div className="absolute bottom-16 right-12 lg:right-32">     <FormulaText size={13} color="#6366F1" opacity={0.07}>F = ma</FormulaText></div>
      <div className="absolute bottom-28 left-10 hidden lg:block">  <FormulaText size={13} color="#6366F1" opacity={0.07}>PV = nRT</FormulaText></div>
      <div className="absolute top-1/2 left-6 hidden lg:block">    <StarDoodle size={10} opacity={0.08} color="#6366F1" /></div>
    </div>
  );
}

export default function AuthScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-violet-50 flex items-center justify-center p-6 relative">
      <BackgroundDoodles />
      <motion.div
        className="w-full max-w-sm relative z-10 bg-white rounded-3xl shadow-xl shadow-primary-900/5 border border-slate-100 p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <AuthCard />
      </motion.div>
    </div>
  );
}
