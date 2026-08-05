import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Upload, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { chatComplete } from '../lib/aiProxy';
import { checkQuota, incrementQuota } from '../lib/quota';
import { useAuth } from '../context/AuthContext';
import MathText from '../components/ui/MathText';
import PaywallModal from '../components/ui/PaywallModal';
import HubPageHeader from '../components/ui/HubPageHeader';

// Reuses the ai_questions_used quota bucket rather than adding a dedicated
// field — this is the same "generate AI content from my input" category as
// Practice Generator, just a different shape of output.
const QUOTA_FIELD = 'ai_questions_used';

function renderMarkdownish(text) {
  // Same lightweight **bold**/paragraph handling as NotesBrowser's note
  // renderer — the summary prompt asks for markdown-style headings/bullets.
  return text.split(/\n\s*\n/).map((para, pi) => (
    <div key={pi} className="mb-3 last:mb-0">
      {para.split('\n').map((line, li) => {
        const trimmed = line.trim();
        const bullet = trimmed.match(/^[-•]\s+(.+)$/);
        const content = bullet ? bullet[1] : trimmed;
        const segments = content.split(/(\*\*[^*]+\*\*)/g);
        const rendered = segments.map((seg, si) =>
          seg.startsWith('**') && seg.endsWith('**')
            ? <strong key={si} className="font-semibold text-slate-900"><MathText text={seg.slice(2, -2)} /></strong>
            : <MathText key={si} text={seg} />
        );
        return bullet
          ? <div key={li} className="flex gap-2 py-0.5"><span className="text-primary-500 shrink-0">•</span><span>{rendered}</span></div>
          : <p key={li} className="py-0.5">{rendered}</p>;
      })}
    </div>
  ));
}

export default function SummarizerPage() {
  const navigate = useNavigate();
  const { currentUser, isPremium } = useAuth();

  const [mode,     setMode]     = useState('text'); // 'text' | 'pdf'
  const [input,    setInput]    = useState('');
  const [fileName, setFileName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [summary,  setSummary]  = useState('');
  const [showPaywall, setShowPaywall] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setError(''); setSummary(''); setFileName(file.name);
    setExtracting(true);
    try {
      // Lazy-loaded — pdf.js is a large chunk, no reason to ship it on every page.
      const { extractPdfText } = await import('../lib/pdfAnalyzer');
      const buf  = await file.arrayBuffer();
      const text = await extractPdfText(buf);
      if (!text || text.trim().length < 50) throw new Error('Could not read text from this PDF — is it a scanned/image-only file?');
      setInput(text);
    } catch (e) {
      setError(e.message || 'Failed to read PDF.');
    } finally {
      setExtracting(false);
    }
  }

  async function handleSummarize() {
    if (!input.trim()) return;
    setError(''); setSummary('');

    const uid = currentUser?.uid;
    if (uid) {
      const quota = await checkQuota(uid, QUOTA_FIELD, isPremium);
      if (!quota.allowed) { setShowPaywall(true); return; }
    }

    setLoading(true);
    try {
      const resp = await chatComplete({
        model: 'gpt-4o',
        max_tokens: 1200,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You summarize study material for exam-prep students. Be concise and accurate — never invent facts not present in the source text.' },
          {
            role: 'user',
            content: `Summarize the following study material. Use this exact structure:

**Overview** — one short paragraph (2-3 sentences) on what this covers.

**Key Points**
- 5 to 8 bullet points, each one self-contained fact or concept, ordered by importance.

**Worth Remembering**
- 2-3 bullets on the most exam-relevant or easy-to-forget details.

Use LaTeX ($...$) for any math or formulas. Keep it tight — no filler.

SOURCE MATERIAL:
${input.slice(0, 12000)}`,
          },
        ],
      });
      const text = resp.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('No summary was generated — try again.');
      setSummary(text);
      if (uid) incrementQuota(uid, QUOTA_FIELD).catch(() => {});
    } catch (e) {
      setError(e.message || 'Summarization failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 lg:p-0 space-y-5">
      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="AI Summarizer"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          onSuccess={() => setShowPaywall(false)}
        />
      )}

      <HubPageHeader
        icon={Sparkles}
        title="AI Summarizer"
        subtitle="Paste notes, an article, a lecture PDF, or a pasted YouTube transcript — get key points instantly."
      />

      <div className="card space-y-4">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {[['text', 'Paste Text', FileText], ['pdf', 'Upload PDF', Upload]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => { setMode(id); setError(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        {mode === 'text' ? (
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your notes, an article, or a YouTube video's transcript (tap 'Show transcript' under the video, then copy-paste it here)…"
            rows={8}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
          />
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-primary-400 hover:bg-primary-50/30 rounded-2xl p-8 text-center cursor-pointer transition-colors"
          >
            {extracting ? (
              <div className="flex items-center justify-center gap-2 text-slate-500 text-sm"><Loader2 size={16} className="animate-spin" /> Reading PDF…</div>
            ) : fileName ? (
              <p className="text-sm font-medium text-slate-700">{fileName} <span className="text-emerald-600">✓ loaded ({input.length.toLocaleString()} chars)</span></p>
            ) : (
              <>
                <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-500">Click to select a PDF (lecture notes, textbook chapter, etc.)</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-600">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        <button
          onClick={handleSummarize}
          disabled={!input.trim() || loading || extracting}
          className="w-full py-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <><Loader2 size={15} className="animate-spin" /> Summarizing…</> : <><Sparkles size={15} /> Summarize</>}
        </button>
      </div>

      {summary && (
        <div className="card">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Summary</h2>
          <div className="text-sm text-slate-700 leading-relaxed">
            {renderMarkdownish(summary)}
          </div>
        </div>
      )}
    </div>
  );
}
