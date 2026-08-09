import DoubtStudio from '../components/doubt/DoubtStudio';

export default function DoubtStudioPage() {
  return (
    <div className="p-4 lg:p-0 h-full flex flex-col">
      <div className="mb-4 shrink-0">
        <h2 className="text-xl font-bold text-slate-900">AI Doubt Studio</h2>
        <p className="text-sm text-slate-500 mt-0.5">Upload your answer sheet — the AI evaluates every step.</p>
      </div>
      {/* min-h-0 lets this flex child actually shrink below its content's
          natural height instead of forcing the page to overflow — the
          default flex-item min-height is auto, which silently defeats
          flex-1 here otherwise. */}
      <div className="flex-1 min-h-0">
        <DoubtStudio />
      </div>
    </div>
  );
}
