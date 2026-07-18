import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Share2, Download, X } from 'lucide-react';

const GRADE_COLOR = (pct) =>
  pct >= 70 ? ['#10B981', '#059669'] : pct >= 50 ? ['#F59E0B', '#D97706'] : ['#EF4444', '#DC2626'];

/* Draws the share card onto the canvas and returns the canvas */
function drawCard(canvas, { name, score, totalMarks, pct, correct, examType, streak }) {
  const W = 800, H = 450;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Decorative circles
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#818cf8';
  ctx.beginPath(); ctx.arc(W - 80, 80, 160, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(60, H - 60, 120, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Score arc background
  const cx = 140, cy = 230, R = 96;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 18;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

  // Score arc fill
  const [c1, c2] = GRADE_COLOR(pct);
  const arcGrad  = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  arcGrad.addColorStop(0, c1); arcGrad.addColorStop(1, c2);
  ctx.strokeStyle = arcGrad;
  ctx.lineWidth   = 18;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100);
  ctx.stroke();

  // Percentage text in circle
  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${pct}%`, cx, cy + 6);
  ctx.font      = '14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('score', cx, cy + 28);

  // Right panel
  const rx = 290;
  ctx.textAlign = 'left';

  // EWE brand label
  ctx.font      = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#a5b4fc';
  ctx.fillText('EaseWithExam', rx, 70);

  // Student name
  ctx.font      = 'bold 32px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText((name || 'Student').slice(0, 24), rx, 115);

  // Exam label
  ctx.font      = '15px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(examType || 'Mock Test', rx, 145);

  // Score chips row
  const chips = [
    { label: 'Score',   value: `${score}/${totalMarks}`, color: c1 },
    { label: 'Correct', value: String(correct),          color: '#10B981' },
    { label: 'Streak',  value: `${streak ?? 0}d`,        color: '#F59E0B' },
  ];
  chips.forEach(({ label, value, color }, i) => {
    const bx = rx + i * 148, by = 175;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.roundRect(bx, by, 132, 64, 12);
    ctx.fill();

    ctx.font      = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(value, bx + 14, by + 36);

    ctx.font      = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(label, bx + 14, by + 54);
  });

  // Motivational line
  const msg = pct >= 80 ? 'Outstanding performance!' : pct >= 60 ? 'Great effort, keep going!' : 'Every attempt makes you stronger!';
  ctx.font      = 'italic 15px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(`"${msg}"`, rx, 310);

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(rx, 330); ctx.lineTo(W - 50, 330);
  ctx.stroke();

  // Footer
  ctx.font      = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText('easewithexam.com · Your NEET/JEE Prep Companion', rx, 360);

  return canvas;
}

export default function ProgressShareCard({ name, score, totalMarks, pct, correct, examType, streak, onClose }) {
  const canvasRef = useRef(null);
  const [shared,  setShared]  = useState(false);
  const [drawn,   setDrawn]   = useState(false);

  const ensureDrawn = () => {
    if (drawn || !canvasRef.current) return;
    drawCard(canvasRef.current, { name, score, totalMarks, pct, correct, examType, streak });
    setDrawn(true);
  };

  const handleDownload = () => {
    ensureDrawn();
    const url  = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.href     = url;
    link.download = `ewe-score-${pct}pct.png`;
    link.click();
  };

  const handleShare = async () => {
    ensureDrawn();
    try {
      canvasRef.current.toBlob(async (blob) => {
        const file = new File([blob], 'ewe-score.png', { type: 'image/png' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `My ${examType} Score — ${pct}%`, text: `I scored ${score}/${totalMarks} on EaseWithExam! 🎯` });
          setShared(true);
        } else {
          handleDownload();
        }
      });
    } catch { handleDownload(); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-900 rounded-2xl shadow-2xl overflow-hidden max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose} className="absolute top-3 right-3 z-10 h-7 w-7 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
          <X size={14} />
        </button>

        {/* Canvas preview */}
        <canvas
          ref={canvasRef}
          className="w-full"
          style={{ aspectRatio: '16/9', display: 'block' }}
          onMouseEnter={ensureDrawn}
        />

        {/* Draw immediately on mount */}
        <div ref={() => { if (canvasRef.current && !drawn) { drawCard(canvasRef.current, { name, score, totalMarks, pct, correct, examType, streak }); setDrawn(true); } }} />

        {/* Actions */}
        <div className="p-4 flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/20 text-white text-sm font-semibold hover:bg-white/10 transition-colors"
          >
            <Download size={15} /> Save PNG
          </button>
          <button
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors"
          >
            <Share2 size={15} /> {shared ? 'Shared!' : 'Share'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
