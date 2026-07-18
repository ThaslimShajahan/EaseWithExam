import DoubtStudio from '../components/doubt/DoubtStudio';

export default function DoubtStudioPage() {
  return (
    <div className="p-4 lg:p-0">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900">AI Doubt Studio</h2>
        <p className="text-sm text-slate-500 mt-0.5">Upload your answer sheet — the AI evaluates every step.</p>
      </div>
      <DoubtStudio />
    </div>
  );
}
