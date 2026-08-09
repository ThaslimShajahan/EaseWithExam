import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, Download, Share2, Star } from 'lucide-react';
import Button from './Button';

/* ── Milestone definitions ─────────────────────────────── */

const MILESTONES = [
  { id: 'first_test',    label: 'First Mock Test',   min_tests: 1,  min_avg: 0,  icon: '🎯', color: '#6366f1' },
  { id: 'tests_5',       label: '5 Tests Completed', min_tests: 5,  min_avg: 0,  icon: '📚', color: '#8b5cf6' },
  { id: 'fifty_pct',     label: 'Above 50% Average', min_tests: 2,  min_avg: 50, icon: '⚡', color: '#f59e0b' },
  { id: 'tests_10',      label: '10 Tests Completed',min_tests: 10, min_avg: 0,  icon: '🚀', color: '#10b981' },
  { id: 'seventy_pct',   label: 'Above 70% Average', min_tests: 3,  min_avg: 70, icon: '🏆', color: '#ef4444' },
  { id: 'tests_25',      label: '25 Tests Completed',min_tests: 25, min_avg: 0,  icon: '⭐', color: '#f97316' },
];

export function getEarnedMilestones(sessions) {
  if (!sessions?.length) return [];
  const count  = sessions.length;
  const avgPct = sessions.reduce((a, s) => a + (s.total_marks > 0 ? (s.score / s.total_marks) * 100 : 0), 0) / count;

  return MILESTONES.filter((m) => count >= m.min_tests && avgPct >= m.min_avg);
}

/* ── Certificate HTML generator ─────────────────────────── */

function buildCertHTML({ studentName, milestoneLabel, milestoneIcon, date, examLabel }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; font-family: 'Georgia', serif; background: #fff; }
    .cert { width: 900px; height: 640px; margin: auto; border: 12px solid #6366f1;
            box-shadow: inset 0 0 0 4px #c7d2fe; position: relative; overflow: hidden;
            background: linear-gradient(135deg, #fafafa 0%, #f0f4ff 100%); }
    .top-band { height: 10px; background: linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa); }
    .body { padding: 48px 72px; text-align: center; }
    .brand { font-size: 13px; letter-spacing: 4px; text-transform: uppercase;
             color: #6366f1; font-family: Arial, sans-serif; font-weight: 700; margin-bottom: 16px; }
    .cert-title { font-size: 38px; font-weight: bold; color: #1e1b4b; margin-bottom: 8px; }
    .sub { font-size: 15px; color: #64748b; margin-bottom: 28px; font-family: Arial, sans-serif; }
    .student { font-size: 42px; color: #312e81; font-style: italic; margin: 12px 0; }
    .milestone-icon { font-size: 52px; margin: 8px 0; }
    .milestone { font-size: 22px; font-weight: bold; color: #4f46e5; margin: 8px 0; }
    .exam-line { font-size: 14px; color: #94a3b8; font-family: Arial, sans-serif; margin-top: 4px; }
    .footer { position: absolute; bottom: 32px; left: 0; right: 0; display: flex;
              justify-content: space-around; padding: 0 72px; font-family: Arial, sans-serif; }
    .footer-col { text-align: center; }
    .footer-val { font-size: 13px; font-weight: bold; color: #1e1b4b; border-top: 2px solid #6366f1;
                  padding-top: 8px; min-width: 120px; }
    .footer-lbl { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
                 font-size: 80px; color: rgba(99,102,241,0.04); font-weight: 900;
                 font-family: Arial, sans-serif; pointer-events: none; white-space: nowrap; }
  </style>
</head>
<body>
  <div class="cert">
    <div class="top-band"></div>
    <div class="watermark">EaseWithExam</div>
    <div class="body">
      <div class="brand">EaseWithExam</div>
      <div class="cert-title">Certificate of Achievement</div>
      <div class="sub">This is to certify that</div>
      <div class="student">${studentName}</div>
      <div class="sub">has successfully achieved the milestone</div>
      <div class="milestone-icon">${milestoneIcon}</div>
      <div class="milestone">${milestoneLabel}</div>
      <div class="exam-line">on the EaseWithExam platform · ${examLabel}</div>
    </div>
    <div class="footer">
      <div class="footer-col">
        <div class="footer-val">${date}</div>
        <div class="footer-lbl">Date of Achievement</div>
      </div>
      <div class="footer-col">
        <div class="footer-val">EaseWithExam</div>
        <div class="footer-lbl">AI-Powered Exam Prep</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ── Download helper ─────────────────────────────────────── */

function downloadCertificate(html, filename) {
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Main component ──────────────────────────────────────── */

export default function ProgressCertificate({ sessions, studentName, examLabel }) {
  const milestones = getEarnedMilestones(sessions);
  const [selected, setSelected] = useState(milestones[milestones.length - 1] ?? null);

  if (!milestones.length) {
    return (
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Award size={16} className="text-slate-400" />
          <h3 className="font-semibold text-slate-900">Progress Certificates</h3>
        </div>
        <div className="text-center py-8">
          <div className="h-14 w-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-3">
            <Award size={24} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-600">No certificates yet</p>
          <p className="text-xs text-slate-400 mt-1">Complete your first mock test to earn one — {MILESTONES.length} to unlock in total</p>
        </div>
      </motion.div>
    );
  }

  const handleDownload = () => {
    if (!selected) return;
    const html = buildCertHTML({
      studentName: studentName || 'Student',
      milestoneLabel: selected.label,
      milestoneIcon: selected.icon,
      date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
      examLabel: examLabel || 'Exam Prep',
    });
    downloadCertificate(html, `EaseWithExam-${selected.id}-certificate.html`);
  };

  const handleShare = () => {
    if (!selected) return;
    const text = `🏆 I just earned the "${selected.label}" certificate on EaseWithExam! ${selected.icon}\n\nPreparing for ${examLabel} with AI-powered study. Join me → easewithexam.com`;
    if (navigator.share) {
      navigator.share({ title: 'EaseWithExam Certificate', text });
    } else {
      navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
    }
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Award size={16} className="text-amber-500" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 leading-tight">Certificates Earned</h3>
            <p className="text-[11px] text-slate-400">{milestones.length} of {MILESTONES.length} unlocked</p>
          </div>
        </div>
        <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full shrink-0">
          {milestones.length} earned
        </span>
      </div>

      {/* Milestone chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {milestones.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelected(m)}
            className={[
              'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border-2 transition-all',
              selected?.id === m.id
                ? 'border-primary-400 bg-primary-50 text-primary-700 shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
            ].join(' ')}
          >
            <span>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>

      {/* Preview card */}
      {selected && (
        <div
          className="relative rounded-2xl p-6 text-center overflow-hidden mb-4"
          style={{ background: `linear-gradient(135deg, ${selected.color}18 0%, ${selected.color}08 100%)`,
                   border: `2px solid ${selected.color}30` }}
        >
          {/* Faint oversized icon watermark, echoing the actual downloadable
              certificate's own watermark treatment — gives this preview
              some of the same "this is a real certificate" weight instead
              of reading as a plain info box. */}
          <p aria-hidden className="absolute -top-3 -right-2 text-7xl opacity-[0.08] rotate-12 pointer-events-none select-none">
            {selected.icon}
          </p>

          <div
            className="h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm"
            style={{ background: `${selected.color}1f`, border: `2px solid ${selected.color}40` }}
          >
            <p className="text-3xl leading-none">{selected.icon}</p>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: selected.color }}>Certificate Earned</p>
          <p className="font-bold text-slate-900 text-lg mt-1">{selected.label}</p>
          <p className="text-xs text-slate-500 mt-1">EaseWithExam · {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
          <div className="flex items-center justify-center gap-1 mt-3">
            {[...Array(5)].map((_, i) => (
              <Star key={i} size={11} className="fill-amber-400 text-amber-400" />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="primary" size="sm" full icon={<Download size={14} />} onClick={handleDownload}>
          Download
        </Button>
        <Button variant="secondary" size="sm" icon={<Share2 size={14} />} onClick={handleShare}>
          Share
        </Button>
      </div>
    </motion.div>
  );
}
