import { useState } from 'react';
import { FileBarChart } from 'lucide-react';
import PerformanceAnalytics from '../components/analytics/PerformanceAnalytics';
import WeeklyReport from '../components/analytics/WeeklyReport';

export default function AnalyticsPage() {
  const [showReport, setShowReport] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between mb-4 px-4 lg:px-0 pt-4 lg:pt-0">
        <h2 className="text-xl font-bold text-slate-900">Analytics</h2>
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-1.5 px-3 py-3.5 rounded-xl bg-primary-50 border border-primary-200 text-primary-700 text-xs font-semibold hover:bg-primary-100 transition-colors"
        >
          <FileBarChart size={13} /> Weekly Report
        </button>
      </div>
      <PerformanceAnalytics />
      {showReport && <WeeklyReport onClose={() => setShowReport(false)} />}
    </>
  );
}
