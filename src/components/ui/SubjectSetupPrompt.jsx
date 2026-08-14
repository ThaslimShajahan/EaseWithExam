import { Link } from 'react-router-dom';
import { BookOpenCheck, ArrowRight } from 'lucide-react';

/**
 * Shown when a student SHOULD have a subject selection and does not.
 *
 * Deliberately replaces the subject picker rather than sitting above an unscoped
 * catalogue. Showing every subject the board offers would look intentional —
 * a Class 12 Science student would have no way to tell that Accountancy is there
 * because their profile is incomplete rather than because it is theirs. Owner
 * decision, and consistent with the rest of this codebase: never silently guess.
 *
 * Only reachable for Classes 11-12. Classes 8-10 have no stream selection to
 * make, so their board list is genuinely their subject list and this never
 * renders for them — see lib/studentSubjects.js.
 */
export default function SubjectSetupPrompt({ toolName = 'this tool' }) {
  return (
    <div className="max-w-md mx-auto text-center px-5 py-10">
      <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-4">
        <BookOpenCheck size={26} className="text-primary-600" />
      </div>

      <h2 className="text-lg font-bold text-slate-900 mb-2">Complete your subject setup</h2>

      <p className="text-sm text-slate-600 leading-relaxed mb-1">
        {toolName} works from the subjects you actually study, so it needs your stream and subject
        choices first.
      </p>
      <p className="text-xs text-slate-500 leading-relaxed mb-6">
        We could show you every subject your board offers, but most of them wouldn&apos;t be yours —
        so you&apos;d be guessing which ones to use.
      </p>

      <Link
        to="/profile"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors"
      >
        Choose my subjects
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
