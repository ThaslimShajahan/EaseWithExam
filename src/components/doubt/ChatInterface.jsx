import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, AlertCircle, User, Mic, MicOff } from 'lucide-react';
import katex from 'katex';
import { VedaAvatarSm } from '../ui/VedaAvatar';
import { searchKnowledgeBase, createDoubtChat, saveDoubtMessage } from '../../lib/supabase';
import { chatCompleteStream } from '../../lib/aiProxy';
import MathText from '../ui/MathText';
import { awardXP } from '../../lib/gamification';
import { createNotification } from '../../lib/notifications';
import { useAuth } from '../../context/AuthContext';
import { checkQuota, incrementQuota } from '../../lib/quota';
import PaywallModal from '../ui/PaywallModal';
import { buildExamType } from '../../lib/categories';

function buildSystemPrompt(userProfile) {
  // target_exam alone is the raw onboarding enum (e.g. 'CLASS_10', 'JEE_MAIN') —
  // never a string like "CBSE Class 10", so the isBoard regex must run against
  // the resolved buildExamType() combo, not the raw field, or it never matches.
  const exam    = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const isBoard = /^(CBSE|ICSE|State Board|Kerala State|Class \d+)/.test(exam);
  const isBoth  = userProfile?.target_exam === 'BOTH';

  const scopeLine = isBoard
    ? `You strictly follow the ${exam} syllabus as prescribed by the official board curriculum.`
    : isBoth
    ? 'You strictly follow NCERT Class 11–12 syllabus covering both NEET and JEE Main topics.'
    : `You strictly follow NCERT and SCERT Kerala Class 11–12 syllabus for ${exam}.`;

  const subjectLine = isBoard
    ? 'You help with all subjects: Mathematics, Science (Physics, Chemistry, Biology), Social Studies, English, and others as needed.'
    : exam === 'JEE Main' || exam === 'JEE Advanced'
    ? 'Your core subjects are Physics, Chemistry, and Mathematics.'
    : 'Your core subjects are Physics, Chemistry, and Biology.';

  return `Your name is EWE. You are an expert tutor for Indian students. ${scopeLine}

${subjectLine}

Your teaching style is Socratic — guide students to discover their own mistakes through pointed questions rather than stating the answer directly.

ANSWER SHEET ANALYSIS — when a student uploads handwritten work, you MUST:
1. Read and state the PROBLEM being solved (infer it from their work if not written)
2. Transcribe EVERY step the student wrote, numbered exactly (Step 1, Step 2, …)
3. Evaluate each step individually: ✓ Correct | ✗ Error | ⚠ Partially correct — with a brief reason for errors
4. Pinpoint the EXACT first step where the logic diverged and explain the underlying concept that was misapplied
5. Ask ONE focused Socratic question to guide them toward correcting that step
6. DO NOT reveal the final answer — guide them to discover it

Use this EXACT format for analysis:
**Problem:** [problem statement using LaTeX]

**Step-by-step Review:**

**Step 1:** $[student's expression]$ — ✓ Correct
**Step 2 (Page 2):** $[student's expression]$ — ✗ Error: [what concept was misapplied and why]
**Step 3 (Page 2):** $[student's expression]$ — ⚠ Follows from Step 2 error

(Include page reference like "(Page 2)" only when the document has multiple pages — omit it for single-page uploads)

**Where it went wrong:** Step [N] — [clear conceptual explanation, not just "wrong sign"]

**Guiding Question:** [one pointed question that makes the student re-examine their Step N reasoning]

EQUATION FORMATTING — MANDATORY:
- Inline math → $...$ ONLY. Never use \\(...\\) for inline.
- Display/standalone equations → $$...$$ ONLY. Never use \\[...\\] for display.
- Physics: $F = ma$, $E = \\frac{hc}{\\lambda}$, $v^2 = u^2 + 2as$, $\\Delta G = \\Delta H - T\\Delta S$
- Chemistry formulas: $\\text{H}_2\\text{SO}_4$, $\\text{CH}_3\\text{COOH}$, $\\text{Fe}^{3+}$
- Reactions: $\\text{A} + \\text{B} \\rightarrow \\text{C}$ or $\\rightleftharpoons$ for equilibrium
- Math: $\\frac{d}{dx}(\\sin x) = \\cos x$, $\\int_0^{\\pi} \\sin x\\,dx = 2$, $\\lim_{x \\to 0}\\frac{\\sin x}{x} = 1$
- NEVER write equations as plain text like "H2SO4" or "d/dx sinx" — always use $...$

FORMATTING:
- Use **bold** for key terms and step labels
- Use numbered lists for multi-step processes
- Keep follow-up responses focused; full derivations only when explicitly asked

Rules:
- Never use methods outside the student's prescribed syllabus scope.
- Be warm and encouraging. Students are under exam pressure.
- Always introduce yourself as EWE, not as an AI.`;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(file);
  });
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5">
      <div className="h-8 w-8 rounded-full overflow-hidden shrink-0">
        <VedaAvatarSm />
      </div>
      <div className="bg-slate-100 rounded-2xl rounded-bl-none px-4 py-3">
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-slate-400"
              style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}
            />
          ))}
          <span className="text-[10px] text-slate-400 ml-1.5">EWE is thinking…</span>
        </div>
      </div>
    </div>
  );
}

/* Renders Veda's text with LaTeX + lightweight markdown (bold, lists) */
function VedaContent({ text, streaming }) {
  if (!text && !streaming) return null;
  const raw = text || '';

  // Step 1: carve out display-math blocks before line-splitting.
  // GPT uses both $$...$$ and \[...\] for display math — handle both.
  const displayRe = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
  const parts = [];
  let lastIdx = 0;
  let dm;
  while ((dm = displayRe.exec(raw)) !== null) {
    if (dm.index > lastIdx) parts.push({ type: 'prose', content: raw.slice(lastIdx, dm.index) });
    const content = (dm[1] ?? dm[2] ?? '').trim();
    parts.push({ type: 'display', content });
    lastIdx = dm.index + dm[0].length;
  }
  if (lastIdx < raw.length) parts.push({ type: 'prose', content: raw.slice(lastIdx) });

  const renderInline = (line) => {
    const segments = line.split(/(\*\*[^*]+\*\*)/g);
    return segments.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-slate-900"><MathText text={part.slice(2, -2)} /></strong>;
      }
      return <MathText key={i} text={part} />;
    });
  };

  const renderProse = (content, baseKey) => {
    const lines = content.split('\n');
    const els = [];
    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (!trimmed) { els.push(<div key={`${baseKey}-${i}`} className="h-2" />); i++; continue; }

      // ### Heading (GPT uses these for section titles)
      const h3Match = trimmed.match(/^###\s+(.+)$/);
      if (h3Match) {
        els.push(<p key={`${baseKey}-${i}`} className="font-bold text-slate-800 text-sm mt-3 mb-1">{renderInline(h3Match[1])}</p>);
        i++; continue;
      }
      const h2Match = trimmed.match(/^##\s+(.+)$/);
      if (h2Match) {
        els.push(<p key={`${baseKey}-${i}`} className="font-bold text-slate-800 mt-3 mb-1">{renderInline(h2Match[1])}</p>);
        i++; continue;
      }

      const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (numMatch) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i].trim();
          const m = l.match(/^(\d+)\.\s+(.+)$/);
          if (!m) break;
          items.push(<li key={`${baseKey}-${i}`} className="flex gap-2"><span className="font-bold text-primary-600 shrink-0">{m[1]}.</span><span>{renderInline(m[2])}</span></li>);
          i++;
        }
        els.push(<ol key={`${baseKey}-ol-${i}`} className="space-y-1 my-1">{items}</ol>);
        continue;
      }

      const bulletMatch = trimmed.match(/^[-•]\s+(.+)$/);
      if (bulletMatch) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i].trim();
          const m = l.match(/^[-•]\s+(.+)$/);
          if (!m) break;
          items.push(<li key={`${baseKey}-${i}`} className="flex gap-2"><span className="text-primary-500 shrink-0 mt-0.5">•</span><span>{renderInline(m[1])}</span></li>);
          i++;
        }
        els.push(<ul key={`${baseKey}-ul-${i}`} className="space-y-1 my-1">{items}</ul>);
        continue;
      }

      els.push(<p key={`${baseKey}-${i}`} className="leading-relaxed">{renderInline(trimmed)}</p>);
      i++;
    }
    return els;
  };

  const elements = [];
  parts.forEach((part, pi) => {
    if (part.type === 'display') {
      try {
        const html = katex.renderToString(part.content, {
          displayMode:  true,
          throwOnError: false,
          strict:       false,
          trust:        false,
        });
        elements.push(
          <div key={`dm-${pi}`} className="my-3 overflow-x-auto text-center py-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch {
        elements.push(
          <code key={`dm-${pi}`} className="text-xs text-slate-500 block my-1 overflow-x-auto">{part.content}</code>
        );
      }
    } else {
      elements.push(...renderProse(part.content, `p${pi}`));
    }
  });

  return (
    <div className="text-sm space-y-1">
      {elements}
      {streaming && <span className="inline-block h-3.5 w-0.5 bg-slate-400 animate-pulse align-middle ml-0.5" />}
    </div>
  );
}

function Message({ msg }) {
  const isVeda    = msg.role === 'ai';
  const isScanned = isVeda && msg.isScanner;

  if (isScanned) {
    return (
      <motion.div
        className="flex items-center gap-2 text-xs text-slate-400 py-1"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      >
        <div className="flex-1 h-px bg-slate-200" />
        <span className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 font-medium">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="3" height="3" rx="0.5" fill="#94a3b8"/><rect x="6" y="1" width="3" height="3" rx="0.5" fill="#94a3b8"/><rect x="1" y="6" width="3" height="3" rx="0.5" fill="#94a3b8"/><rect x="6" y="6" width="3" height="3" rx="0.5" fill="#64748b"/></svg>
          {msg.content}
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`flex items-end gap-2.5 ${isVeda ? '' : 'flex-row-reverse'}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1,  y: 0  }}
      transition={{ duration: 0.2 }}
    >
      {isVeda ? (
        <div className="h-8 w-8 rounded-full overflow-hidden shrink-0">
          <VedaAvatarSm />
        </div>
      ) : (
        <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
          <User size={14} className="text-slate-500" />
        </div>
      )}

      <div className={[
        'max-w-[82%] px-4 py-3 rounded-2xl',
        isVeda
          ? 'bg-slate-100 text-slate-800 rounded-bl-none'
          : 'bg-primary-600 text-white rounded-br-none text-sm leading-relaxed whitespace-pre-wrap',
      ].join(' ')}>
        {isVeda
          ? <VedaContent text={msg.content} streaming={msg.streaming} />
          : <>{msg.content}{msg.streaming && <span className="inline-block ml-0.5 h-3.5 w-0.5 bg-white/70 animate-pulse align-middle" />}</>
        }
      </div>
    </motion.div>
  );
}

function ErrorBanner({ message, onDismiss }) {
  return (
    <motion.div
      className="mx-3 mb-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
    >
      <AlertCircle size={13} className="shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600 font-bold">✕</button>
    </motion.div>
  );
}

export default function ChatInterface({ imageFiles = [] }) {
  /* imageFiles is an array of File objects (possibly empty) */
  const hasImages = imageFiles.length > 0;
  const { currentUser, isPremium, userProfile } = useAuth();
  const xpAwardedRef    = useRef(false);
  const analysisVerRef  = useRef(0); // incremented on each image change to discard stale results

  const [messages,        setMessages]        = useState([
    {
      id: '0',
      role: 'ai',
      content: "Hi! I'm EWE, your personal study companion 👋\n\nUpload a photo of your answer sheet or type any doubt — I'll walk you through it step by step, strictly within NCERT and SCERT syllabus.",
    },
  ]);
  const [input,           setInput]           = useState('');
  const [loading,         setLoading]         = useState(false);
  const [apiError,        setApiError]        = useState('');
  const [showPaywall,     setShowPaywall]     = useState(false);
  const [listening,       setListening]       = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const historyRef   = useRef([]);
  const recognRef    = useRef(null);
  const chatIdRef    = useRef(null);
  const chatIdPromiseRef = useRef(null);

  // Lazily creates one doubt_chats row per session (admin visibility into
  // real chat activity) — never blocks the actual chat UX if it fails.
  const ensureChatId = () => {
    if (chatIdRef.current) return Promise.resolve(chatIdRef.current);
    if (!currentUser?.uid) return Promise.resolve(null);
    if (!chatIdPromiseRef.current) {
      chatIdPromiseRef.current = createDoubtChat(currentUser.uid, userProfile?.target_exam ?? null)
        .then((chat) => { chatIdRef.current = chat.id; return chat.id; })
        .catch(() => null);
    }
    return chatIdPromiseRef.current;
  };

  const persistMessage = (role, content) => {
    ensureChatId().then((chatId) => {
      if (chatId) saveDoubtMessage(chatId, role, content).catch(() => {});
    });
  };

  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setApiError('Voice input not supported in this browser. Try Chrome or Edge.');
      return;
    }

    if (listening) {
      recognRef.current?.stop();
      setListening(false);
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = 'en-IN';
    recog.continuous = false;
    recog.interimResults = false;

    recog.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      if (transcript) setInput((prev) => (prev ? prev + ' ' + transcript : transcript));
    };
    recog.onerror  = () => setListening(false);
    recog.onend    = () => setListening(false);

    recog.start();
    recognRef.current = recog;
    setListening(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /* Reset state whenever the image set changes — analysis must be triggered manually */
  useEffect(() => {
    ++analysisVerRef.current; // cancel any in-flight analysis from a previous image set
    historyRef.current = [];
    xpAwardedRef.current = false;
    setApiError('');
    setInput('');
    setLoading(false);
    setAnalysisStarted(false);

    if (!hasImages) {
      setMessages([{
        id: Date.now().toString(),
        role: 'ai',
        content: "Hi! I'm EWE, your personal study companion 👋\n\nUpload a photo of your answer sheet or type any doubt — I'll walk you through it step by step, strictly within NCERT and SCERT syllabus.",
      }]);
      return;
    }

    const pageLabel = imageFiles.length === 1 ? '1 page' : `${imageFiles.length} pages`;
    setMessages([{
      id: Date.now().toString(),
      role: 'ai',
      content: `${pageLabel} uploaded and ready.\n\nFinished uploading? Tap **Analyse ${pageLabel}** below to start the review.`,
    }]);
  }, [imageFiles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Called explicitly by the Analyse button */
  const runAnalysis = async () => {
    // This is the most expensive call in the app (GPT-4o vision over full-page
    // images) and had NO quota check at all — a free-tier student could run
    // unlimited answer-sheet analyses per day while a single typed follow-up
    // question correctly counted against their daily veda_messages_used cap.
    const uid = currentUser?.uid;
    if (uid) {
      const quota = await checkQuota(uid, 'veda_messages_used', isPremium);
      if (!quota.allowed) { setShowPaywall(true); return; }
    }

    const ver = ++analysisVerRef.current;
    setAnalysisStarted(true);
    setLoading(true);

    const scanId = Date.now().toString();
    const aiId   = (Date.now() + 1).toString();

    setMessages([
      {
        id: scanId,
        role: 'ai',
        isScanner: true,
        content: `Scanning ${imageFiles.length > 1 ? `${imageFiles.length} pages` : '1 page'}…`,
      },
      { id: aiId, role: 'ai', content: '', streaming: true },
    ]);

    /* Convert all images to base64 */
    let imageParts;
    try {
      imageParts = await Promise.all(
        imageFiles.map(async (file) => {
          const dataUrl = await fileToBase64(file);
          return { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } };
        })
      );
    } catch {
      if (analysisVerRef.current !== ver) return;
      setMessages([{ id: scanId, role: 'ai', content: "I couldn't read the image. Please try uploading again." }]);
      setLoading(false);
      setAnalysisStarted(false);
      return;
    }

    const pageCount = imageFiles.length;
    const userContent = [];
    imageParts.forEach((part, idx) => {
      userContent.push({ type: 'text', text: `--- Page ${idx + 1} of ${pageCount} ---` });
      userContent.push(part);
    });

    const pageNote = pageCount > 1
      ? `This solution is spread across ${pageCount} pages (labelled Page 1 to Page ${pageCount} above). Read ALL pages before listing steps. For every step, note which page it appears on — e.g. "**Step 3 (Page 2):**".`
      : '';

    const analysisInstruction = `Please analyse every page of my handwritten answer sheet now.
${pageNote}
Follow the Answer Sheet Analysis protocol from your instructions exactly:
- Read ALL pages as one continuous solution
- Transcribe EVERY step I have written (numbered, with LaTeX, and page reference if multiple pages)
- Evaluate each step: ✓ Correct | ✗ Error | ⚠ Partially correct
- Identify the first step where my logic diverged and explain the underlying concept error
- End with one focused guiding question`;

    userContent.push({ type: 'text', text: analysisInstruction });
    historyRef.current = [{ role: 'user', content: userContent }];

    try {
      const stream = await chatCompleteStream({
        model:       'gpt-4o',
        max_tokens:  2000,
        temperature: 0.3,
        stream:      true,
        messages: [
          { role: 'system', content: buildSystemPrompt(userProfile) },
          ...historyRef.current,
        ],
      });

      let full = '';
      for await (const chunk of stream) {
        if (analysisVerRef.current !== ver) return;
        full += chunk.choices[0]?.delta?.content ?? '';
        setMessages([
          { id: scanId, role: 'ai', isScanner: true, content: `Scanned ${imageFiles.length > 1 ? `${imageFiles.length} pages` : '1 page'}` },
          { id: aiId, role: 'ai', content: full, streaming: true },
        ]);
      }

      if (analysisVerRef.current !== ver) return;
      setMessages([
        { id: scanId, role: 'ai', isScanner: true, content: `Scanned ${imageFiles.length > 1 ? `${imageFiles.length} pages` : '1 page'}` },
        { id: aiId, role: 'ai', content: full, streaming: false },
      ]);
      historyRef.current.push({ role: 'assistant', content: full });
      if (uid) incrementQuota(uid, 'veda_messages_used').catch(() => {});
      persistMessage('user', `[Uploaded ${imageFiles.length > 1 ? `${imageFiles.length} pages` : '1 page'} for answer-sheet analysis]`);
      persistMessage('assistant', full);

      if (!xpAwardedRef.current && currentUser) {
        xpAwardedRef.current = true;
        awardXP(currentUser.uid, 'veda_session').catch(() => {});
        createNotification(
          currentUser.uid, 'veda_session',
          'EWE session +10 XP',
          'Your doubt was analysed. Keep asking — every solved doubt builds mastery.',
          '/doubt',
        ).catch(() => {});
      }
    } catch (err) {
      if (analysisVerRef.current !== ver) return;
      setMessages([{
        id: scanId,
        role: 'ai',
        content: "I had trouble analysing the image. Please try uploading it again or describe the problem in the chat.",
      }]);
      historyRef.current = [];
      setAnalysisStarted(false);
    } finally {
      if (analysisVerRef.current === ver) setLoading(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Quota check before sending
    const uid = currentUser?.uid;
    if (uid) {
      const quota = await checkQuota(uid, 'veda_messages_used', isPremium);
      if (!quota.allowed) {
        setShowPaywall(true);
        return;
      }
    }

    setInput('');
    setApiError('');
    const userMsg = { id: Date.now().toString(), role: 'user', content: text };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    persistMessage('user', text);

    // Award XP once per text-message session (images award XP in the analysis effect)
    if (!xpAwardedRef.current && currentUser && !hasImages) {
      xpAwardedRef.current = true;
      awardXP(currentUser.uid, 'veda_session').catch(() => {});
      createNotification(
        currentUser.uid, 'veda_session',
        'EWE session +10 XP',
        'Keep asking — every doubt you solve builds mastery.',
        '/doubt',
      ).catch(() => {});
    }

    // Images are already in historyRef from the auto-analysis; just append the text
    historyRef.current.push({ role: 'user', content: [{ type: 'text', text }] });

    const aiId = (Date.now() + 1).toString();
    setMessages((m) => [...m, { id: aiId, role: 'ai', content: '', streaming: true }]);

    /* RAG: inject relevant knowledge base chunks into system prompt */
    let systemPrompt = buildSystemPrompt(userProfile);
    try {
const chunks = await searchKnowledgeBase(text);
      if (chunks.length > 0) {
        const context = chunks.map((c) => `[${c.subject || 'Content'}]\n${c.content}`).join('\n\n---\n\n');
        systemPrompt = `${buildSystemPrompt(userProfile)}\n\n## Reference material from question papers:\n${context}`;
      }
    } catch {}

    try {
      const stream = await chatCompleteStream({
        model:       'gpt-4o',
        max_tokens:  1800,
        temperature: 0.5,
        stream:      true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyRef.current,
        ],
      });

      let full = '';
      for await (const chunk of stream) {
        full += chunk.choices[0]?.delta?.content ?? '';
        setMessages((m) =>
          m.map((msg) => msg.id === aiId ? { ...msg, content: full, streaming: true } : msg),
        );
      }

      setMessages((m) =>
        m.map((msg) => msg.id === aiId ? { ...msg, streaming: false } : msg),
      );
      historyRef.current.push({ role: 'assistant', content: full });
      // Increment quota after successful response
      if (uid) incrementQuota(uid, 'veda_messages_used').catch(() => {});
      persistMessage('assistant', full);
    } catch (err) {
      setMessages((m) => m.filter((msg) => msg.id !== aiId));
      setApiError(
        err?.status === 429 ? 'Too many requests — please wait a moment and try again.' :
        err?.status === 401 ? 'EWE is unreachable — check the API key in .env.' :
        err?.message || 'Connection error. Check your internet.',
      );
      historyRef.current.pop();
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // The textarea had rows={1} with no auto-grow — typing a paragraph just
  // overflowed a fixed-height box instead of expanding like a normal chat
  // input (WhatsApp-style: grows with content, caps out and scrolls
  // internally past max-h-28, Shift+Enter for a newline already worked via
  // handleKeyDown above).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  return (
    <div className="flex flex-col h-full">
      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="EWE AI messages"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          name={userProfile?.display_name || currentUser?.displayName}
        />
      )}
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide">
        <AnimatePresence initial={false}>
          {messages.map((msg) => <Message key={msg.id} msg={msg} />)}
        </AnimatePresence>
        {loading && messages[messages.length - 1]?.role !== 'ai' && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {apiError && <ErrorBanner message={apiError} onDismiss={() => setApiError('')} />}
      </AnimatePresence>

      {/* Analyse trigger — only shown after upload, before analysis starts */}
      <AnimatePresence>
        {hasImages && !analysisStarted && (
          <motion.div
            className="shrink-0 px-3 pb-2"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
          >
            <button
              onClick={runAnalysis}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 active:scale-[0.98]
                         text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all
                         disabled:opacity-50 shadow-sm"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0">
                <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="8.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="1.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="8.5" y="8.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
              Analyse {imageFiles.length === 1 ? '1 page' : `${imageFiles.length} pages`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div className="shrink-0 border-t border-slate-100 bg-white px-3 py-3">
        <div className="flex items-end gap-2 bg-slate-100 rounded-2xl px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasImages ? "Ask EWE about a specific step or page…" : "Ask EWE your doubt…"}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-slate-800
                       placeholder:text-slate-400 max-h-28 overflow-y-auto leading-relaxed"
            /* The browser's native focus ring was showing through the
             * outline-none utility class (Windows/Chrome sometimes renders
             * its own accessibility focus rect regardless of author CSS) —
             * inline style wins over any stylesheet source, so it actually
             * suppresses it. */
            style={{ outline: 'none', boxShadow: 'none' }}
          />
          {/* Voice input */}
          <button
            onClick={toggleVoice}
            title={listening ? 'Stop listening' : 'Voice input'}
            className={`h-8 w-8 shrink-0 rounded-xl flex items-center justify-center transition-all ${
              listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}
          >
            {listening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="h-8 w-8 shrink-0 rounded-xl bg-primary-600 flex items-center justify-center
                       text-white disabled:opacity-40 transition-all hover:bg-primary-700 active:scale-95"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-center text-slate-400 mt-1.5">
          EWE follows NCERT & SCERT syllabus · {historyRef.current.length} exchanges in session
        </p>
      </div>
    </div>
  );
}
