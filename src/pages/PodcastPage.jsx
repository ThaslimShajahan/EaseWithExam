import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, Loader2, AlertCircle, Download, Sparkles } from 'lucide-react';
import { chatComplete, generateSpeech } from '../lib/aiProxy';
import { checkQuota, incrementQuota } from '../lib/quota';
import { useAuth } from '../context/AuthContext';
import PaywallModal from '../components/ui/PaywallModal';
import HubPageHeader from '../components/ui/HubPageHeader';

const QUOTA_FIELD = 'podcasts_used';
// tts-1 hard-limits input to 4096 characters — keep well under that.
const SCRIPT_CHAR_CAP = 3500;

async function buildNarrationScript(notes) {
  const resp = await chatComplete({
    model: 'gpt-4o',
    max_tokens: 900,
    temperature: 0.6,
    messages: [
      { role: 'system', content: 'You turn study notes into a short, natural-sounding spoken audio lesson script for a student to listen to. Conversational, clear, encouraging — like a good tutor explaining out loud, not reading bullet points.' },
      {
        role: 'user',
        content: `Turn this study material into a spoken narration script, about 2-3 minutes when read aloud (roughly 300-450 words). Explain it the way a tutor would talk through it, in order, with natural transitions. Do not use markdown, bullet points, or headings — write it as plain spoken sentences only, since this will be converted directly to audio.

STUDY MATERIAL:
${notes.slice(0, 8000)}`,
      },
    ],
  }, { feature: 'podcast-script' });
  return (resp.choices?.[0]?.message?.content ?? '').trim();
}

export default function PodcastPage() {
  const navigate = useNavigate();
  const { currentUser, isPremium } = useAuth();

  const [notes,      setNotes]      = useState('');
  const [script,     setScript]     = useState('');
  const [audioUrl,   setAudioUrl]   = useState('');
  const [stage,      setStage]      = useState('idle'); // idle | scripting | speaking | done
  const [error,      setError]      = useState('');
  const [showPaywall, setShowPaywall] = useState(false);
  const audioUrlRef = useRef('');

  // Clean up the object URL on unmount / when a new one replaces it.
  useEffect(() => { audioUrlRef.current = audioUrl; }, [audioUrl]);
  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  async function handleGenerate() {
    if (!notes.trim()) return;
    setError(''); setScript(''); setAudioUrl('');

    const uid = currentUser?.uid;
    if (uid) {
      const quota = await checkQuota(uid, QUOTA_FIELD, isPremium);
      if (!quota.allowed) { setShowPaywall(true); return; }
    }

    try {
      setStage('scripting');
      const narration = await buildNarrationScript(notes);
      if (!narration) throw new Error('Could not generate a script from this material — try adding more detail.');
      setScript(narration);

      setStage('speaking');
      const blob = await generateSpeech(narration.slice(0, SCRIPT_CHAR_CAP), { voice: 'alloy', feature: 'podcast-tts' });
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setStage('done');
      if (uid) incrementQuota(uid, QUOTA_FIELD).catch(() => {});
    } catch (e) {
      setError(e.message || 'Podcast generation failed. Please try again.');
      setStage('idle');
    }
  }

  const busy = stage === 'scripting' || stage === 'speaking';

  return (
    <div className="max-w-2xl mx-auto p-4 lg:p-0 space-y-5">
      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="Podcast Generator"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          onSuccess={() => setShowPaywall(false)}
        />
      )}

      <HubPageHeader
        icon={Headphones}
        title="Podcast Generator"
        subtitle="Turn your notes into a short audio lesson you can listen to on the go."
      />

      <div className="card space-y-4">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paste the notes or chapter summary you want turned into an audio lesson…"
          rows={8}
          disabled={busy}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none disabled:opacity-60"
        />

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-600">
            <AlertCircle size={13} className="shrink-0" /> {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!notes.trim() || busy}
          className="w-full py-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
        >
          {stage === 'scripting' && <><Loader2 size={15} className="animate-spin" /> Writing script…</>}
          {stage === 'speaking'  && <><Loader2 size={15} className="animate-spin" /> Recording audio…</>}
          {(stage === 'idle' || stage === 'done') && <><Sparkles size={15} /> Generate Podcast</>}
        </button>
      </div>

      {audioUrl && (
        <div className="card space-y-4">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Your Audio Lesson</h2>
          <audio controls src={audioUrl} className="w-full" />
          <a
            href={audioUrl}
            download="ewe-podcast.mp3"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700 transition-colors"
          >
            <Download size={14} /> Download MP3
          </a>
          {script && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-semibold text-slate-600">Show script</summary>
              <p className="mt-2 leading-relaxed whitespace-pre-wrap">{script}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
