import { Link } from 'react-router-dom';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';

/**
 * Shown instead of a subject picker when the server says this student has NO
 * allowed subjects for the tool's exam — no content loaded yet, every subject
 * hidden by an admin for this exam, or an exam we couldn't resolve from the
 * profile. Honest by design: before 2026-09-25 these gaps were filled with a
 * guessed list, which is how a JEE Advanced student got an English test.
 *
 * `loading` renders a quiet placeholder while the allowed list is fetched, so
 * a slow network never flashes "coming soon" at a student who has subjects.
 * `unresolved` is for a profile with no usable exam/class — send them to set it.
 */
export default function SubjectsComingSoon({ toolName = 'This tool', loading = false, unresolved = false }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Loading your subjects…
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center px-5 py-10">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <Sparkles size={26} className="text-amber-600" />
      </div>

      {unresolved ? (
        <>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Set up your exam and class</h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            {toolName} needs to know which exam or class you&apos;re preparing for, so every question
            matches your syllabus.
          </p>
          <Link
            to="/profile"
            className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors"
          >
            Update my profile
            <ArrowRight size={15} />
          </Link>
        </>
      ) : (
        <>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Coming soon for your exam</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We&apos;re still adding study material for your exam. {toolName} will open up here as soon
            as it&apos;s ready — we won&apos;t fill the gap with another exam&apos;s content.
          </p>
        </>
      )}
    </div>
  );
}
