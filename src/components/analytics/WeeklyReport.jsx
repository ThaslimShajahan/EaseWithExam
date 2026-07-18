import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, X, TrendingUp, Flame, Zap, Target, CheckCircle2, BookOpen } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const IST = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

/* ── Compute week start (Monday IST) ─────────────────────── */
function getWeekStart(offsetWeeks = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = now.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff - offsetWeeks * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

/* ── Load report data ────────────────────────────────────── */
async function loadWeeklyData(uid, weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const [sessions, challenges, gam] = await Promise.all([
    supabase.from('test_sessions')
      .select('score, total_marks, created_at, subjects_json')
      .eq('firebase_uid', uid)
      .gte('created_at', weekStart.toISOString())
      .lt('created_at', weekEnd.toISOString()),
    supabase.from('daily_challenge_attempts')
      .select('is_correct, attempted_at')
      .eq('user_id', uid)
      .gte('attempted_at', weekStart.toISOString())
      .lt('attempted_at', weekEnd.toISOString()),
    supabase.from('user_gamification').select('xp, streak_days').eq('user_id', uid).maybeSingle(),
  ]);

  const s   = sessions.data ?? [];
  const cha = challenges.data ?? [];
  const g   = gam.data;

  const testCount   = s.length;
  const avgScore    = testCount ? Math.round(s.reduce((a, r) => a + (r.score / (r.total_marks || 1) * 100), 0) / testCount) : 0;
  const chalCorrect = cha.filter(c => c.is_correct).length;
  const chalTotal   = cha.length;

  return {
    weekStart:    weekStart.toISOString().slice(0, 10),
    testCount,
    avgScore,
    chalCorrect,
    chalTotal,
    xp:           g?.xp ?? 0,
    streak:       g?.streak_days ?? 0,
    sessions:     s,
  };
}

/* ── Canvas draw ─────────────────────────────────────────── */
function drawReport(canvas, { data, name, examType, weekStr }) {
  const W = 800, H = 560;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // BG
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f8fafc');
  bg.addColorStop(1, '#eff6ff');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Header band
  const hg = ctx.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, '#0f172a'); hg.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, 110);

  // EWE label
  ctx.fillStyle = '#41A2B6';
  ctx.font = 'bold 13px system-ui';
  ctx.fillText('EaseWithExam', 36, 38);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui';
  ctx.fillText('Weekly Progress Report', 36, 68);

  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = '13px system-ui';
  ctx.fillText(`${name || 'Student'} · ${examType || 'NEET'} · ${weekStr}`, 36, 95);

  // Stat cards
  const stats = [
    { label: 'Tests Done',   value: String(data.testCount),   color: '#41A2B6', icon: '📝' },
    { label: 'Avg Score',    value: `${data.avgScore}%`,      color: '#10b981', icon: '🎯' },
    { label: 'Challenge',    value: data.chalTotal ? `${data.chalCorrect}/${data.chalTotal}` : '—', color: '#f59e0b', icon: '⚡' },
    { label: 'Day Streak',   value: `${data.streak}d`,        color: '#6c63ff', icon: '🔥' },
  ];

  const cw = 168, ch = 90, gap = 16, startX = 36, startY = 136;
  stats.forEach((s, i) => {
    const x = startX + i * (cw + gap);
    // Card bg
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(x, startY, cw, ch, 12); ctx.fill();
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, startY, cw, ch, 12); ctx.stroke();

    ctx.font = '22px system-ui';
    ctx.fillText(s.icon, x + 14, startY + 34);

    ctx.fillStyle = s.color;
    ctx.font = 'bold 26px system-ui';
    ctx.fillText(s.value, x + 14, startY + 66);

    ctx.fillStyle = '#64748b';
    ctx.font = '12px system-ui';
    ctx.fillText(s.label, x + 14, startY + 82);
  });

  // Test history bar chart
  if (data.sessions?.length) {
    const chartX = 36, chartY = 268, chartW = W - 72, chartH = 180;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(chartX, chartY, chartW, chartH, 12); ctx.fill();
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(chartX, chartY, chartW, chartH, 12); ctx.stroke();

    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px system-ui';
    ctx.fillText('Mock Test Scores This Week', chartX + 16, chartY + 22);

    const bars = data.sessions.slice(-8);
    const maxScore = 100;
    const barW  = Math.min(40, (chartW - 80) / bars.length - 8);
    const barAreaH = chartH - 56;

    bars.forEach((ses, i) => {
      const pct  = ses.total_marks ? (ses.score / ses.total_marks * 100) : 0;
      const bh   = Math.max(4, (pct / maxScore) * barAreaH);
      const bx   = chartX + 24 + i * ((chartW - 80) / bars.length);
      const by   = chartY + 42 + barAreaH - bh;

      const col  = pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = col + '22';
      ctx.beginPath(); ctx.roundRect(bx, chartY + 42, barW, barAreaH, 4); ctx.fill();

      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(bx, by, barW, bh, 4); ctx.fill();

      ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(pct)}%`, bx + barW / 2, by - 4);
      ctx.fillText(IST(ses.created_at).split(' ')[0], bx + barW / 2, chartY + 42 + barAreaH + 14);
    });
    ctx.textAlign = 'left';
  } else {
    // No tests — motivational message
    const chartY = 268;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(36, chartY, W - 72, 180, 12); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('No mock tests this week — take one to see your trend!', W / 2, chartY + 90);
    ctx.textAlign = 'left';
  }

  // Footer
  ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui';
  ctx.fillText('Generated by EaseWithExam · easewithexam.com', 36, H - 16);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('en-IN'), W - 36, H - 16);
  ctx.textAlign = 'left';
}

/* ── Modal component ─────────────────────────────────────── */
export default function WeeklyReport({ onClose }) {
  const { currentUser, userProfile } = useAuth();
  const uid      = currentUser?.uid;
  const canvasRef= useRef(null);
  const [data,   setData]    = useState(null);
  const [weekOff,setWeekOff] = useState(0);  // 0 = current week
  const [loading,setLoading] = useState(true);

  const weekStart = getWeekStart(weekOff);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const weekStr   = `${IST(weekStart)} – ${IST(weekEnd)}`;

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    loadWeeklyData(uid, getWeekStart(weekOff)).then((d) => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [uid, weekOff]);

  useEffect(() => {
    if (!data || !canvasRef.current || loading) return;
    drawReport(canvasRef.current, {
      data,
      name:     userProfile?.display_name || currentUser?.displayName,
      examType: userProfile?.target_exam,
      weekStr,
    });
  }, [data, loading]); // eslint-disable-line

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.href     = canvasRef.current.toDataURL('image/png');
    link.download = `ewe-weekly-report-${weekStart.toISOString().slice(0, 10)}.png`;
    link.click();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-900 text-base">Weekly Progress Report</h2>
            <p className="text-xs text-slate-500">{weekStr}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOff(o => o + 1)} className="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50">← Prev</button>
            <button onClick={() => setWeekOff(0)} disabled={weekOff === 0} className="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">This week</button>
            <button onClick={() => setWeekOff(o => Math.max(0, o - 1))} disabled={weekOff === 0} className="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">Next →</button>
            <button onClick={onClose} className="ml-2 h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
              <X size={14} className="text-slate-500" />
            </button>
          </div>
        </div>

        {/* Canvas preview */}
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" />
          </div>
        ) : (
          <canvas ref={canvasRef} className="w-full block" style={{ aspectRatio: '800/560' }} />
        )}

        {/* Quick stats row */}
        {data && !loading && (
          <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50">
            {[
              { icon: BookOpen, label: 'Tests',    val: data.testCount,                     color: 'text-teal-600'   },
              { icon: Target,   label: 'Avg Score',val: `${data.avgScore}%`,                 color: 'text-emerald-600'},
              { icon: Zap,      label: 'Challenge', val: `${data.chalCorrect}/${data.chalTotal || 0}`, color: 'text-amber-600' },
              { icon: Flame,    label: 'Streak',   val: `${data.streak}d`,                  color: 'text-violet-600' },
            ].map(({ icon: Icon, label, val, color }) => (
              <div key={label} className="flex flex-col items-center py-3 gap-0.5">
                <Icon size={14} className={color} />
                <p className={`text-lg font-extrabold ${color}`}>{val}</p>
                <p className="text-[10px] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Download */}
        <div className="p-4 flex justify-end gap-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors">
            Close
          </button>
          <button onClick={handleDownload} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 disabled:opacity-50 transition-colors">
            <Download size={14} /> Download PNG
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
