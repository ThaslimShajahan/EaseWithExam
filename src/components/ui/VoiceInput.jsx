import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default function VoiceInput({ onTranscript, disabled = false, className = '' }) {
  const [listening, setListening]   = useState(false);
  const [supported, setSupported]   = useState(true);
  const recogRef = useRef(null);

  useEffect(() => {
    if (!SpeechRecognition) { setSupported(false); return; }
  }, []);

  const start = () => {
    if (!SpeechRecognition || disabled) return;
    const recog = new SpeechRecognition();
    recog.lang          = 'en-IN';
    recog.interimResults= false;
    recog.maxAlternatives = 1;

    recog.onstart   = () => setListening(true);
    recog.onend     = () => setListening(false);
    recog.onerror   = () => setListening(false);

    recog.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (transcript) onTranscript(transcript);
    };

    recog.start();
    recogRef.current = recog;
  };

  const stop = () => {
    recogRef.current?.stop();
    setListening(false);
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onMouseDown={start}
      onMouseUp={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      disabled={disabled}
      title={listening ? 'Listening… release to send' : 'Hold to speak'}
      className={`flex items-center justify-center rounded-xl transition-all ${
        listening
          ? 'bg-red-500 text-white scale-110 shadow-lg shadow-red-200'
          : 'bg-slate-100 text-slate-500 hover:bg-primary-50 hover:text-primary-600'
      } ${className}`}
    >
      {listening
        ? <MicOff size={16} />
        : <Mic size={16} />
      }
    </button>
  );
}
