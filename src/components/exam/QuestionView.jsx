import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ZoomIn, X, Camera, Upload, BookOpen } from 'lucide-react';
import MathText from '../ui/MathText';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

const SECTION_LABELS = {
  A: 'Section A — Objective (MCQ)',
  B: 'Section B — Very Short Answer',
  C: 'Section C — Short Answer',
  D: 'Section D — Long Answer',
  E: 'Section E — Extended Answer',
};

/* ── Image zoom overlay ────────────────────────────────────── */
function ZoomOverlay({ url, onClose }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20"
        onClick={onClose}>
        <X size={20} className="text-white" />
      </button>
      <img src={url} alt="Question figure" className="max-w-full max-h-full object-contain rounded-lg" />
    </motion.div>
  );
}

/* ── Question image with tap-to-zoom ───────────────────────── */
function QuestionImage({ url }) {
  const [zoomed, setZoomed] = useState(false);
  if (!url) return null;
  return (
    <>
      <div
        className="relative rounded-xl overflow-hidden border border-slate-200 cursor-zoom-in bg-white"
        onClick={() => setZoomed(true)}
      >
        <img src={url} alt="Question figure" className="w-full max-h-64 object-contain" />
        <div className="absolute bottom-1.5 right-1.5 bg-black/40 rounded-lg p-1">
          <ZoomIn size={12} className="text-white" />
        </div>
      </div>
      <AnimatePresence>
        {zoomed && <ZoomOverlay url={url} onClose={() => setZoomed(false)} />}
      </AnimatePresence>
    </>
  );
}

/* ── Text description of AI-generated diagram ──────────────── */
function DiagramBox({ description }) {
  if (!description) return null;
  return (
    <div className="border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 p-4 space-y-1">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Figure</p>
      <p className="text-sm text-slate-600 leading-relaxed italic">{description}</p>
    </div>
  );
}

/* ── Match the Following table ─────────────────────────────── */
function MatchColumns({ columnI, columnII }) {
  if (!columnI?.length || !columnII?.length) return null;
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
      <div className="grid grid-cols-2 divide-x divide-slate-200">
        <div className="p-3 space-y-2 bg-blue-50">
          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2">Column I</p>
          {columnI.map((item, i) => (
            <p key={i} className="text-slate-700 leading-snug"><MathText text={item} /></p>
          ))}
        </div>
        <div className="p-3 space-y-2 bg-emerald-50">
          <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">Column II</p>
          {columnII.map((item, i) => (
            <p key={i} className="text-slate-700 leading-snug"><MathText text={item} /></p>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Numerical answer input ────────────────────────────────── */
function NumericalInput({ value, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 font-medium">Enter your answer (integer or decimal):</p>
      <input
        type="number" step="any"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || '')}
        placeholder="Type your numerical answer…"
        className="w-full px-4 py-4 rounded-xl border-2 border-slate-200 focus:border-primary-500 outline-none text-xl font-bold text-slate-900 bg-white text-center transition-colors"
      />
    </div>
  );
}

/* ── Short Answer textarea ─────────────────────────────────── */
function ShortAnswerInput({ value, onChange, marks = 2 }) {
  const text = typeof value === 'object' ? (value?.text ?? '') : (value ?? '');
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 font-medium">
        Write your answer below{marks <= 2 ? ' (2–3 sentences)' : ' (4–6 sentences)'}:
      </p>
      <textarea
        value={text}
        onChange={(e) => onChange({ text: e.target.value, imageDataUrl: value?.imageDataUrl ?? null })}
        placeholder="Type your answer here…"
        rows={marks <= 2 ? 4 : 6}
        className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-primary-500 outline-none text-sm text-slate-900 bg-white resize-none transition-colors leading-relaxed"
      />
      <p className="text-[10px] text-slate-400 text-right">{text.length} chars</p>
    </div>
  );
}

/* ── Long Answer image upload + text ──────────────────────── */
function LongAnswerUpload({ value, onChange, marks = 5 }) {
  const fileRef   = useRef(null);
  const [zoomed, setZoomed] = useState(false);

  const text           = value?.text ?? '';
  const imageDataUrl   = value?.imageDataUrl ?? null;

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange({ text, imageDataUrl: e.target.result });
    reader.readAsDataURL(file);
  };

  const removeImage = () => onChange({ text, imageDataUrl: null });

  return (
    <div className="space-y-3">
      {/* Image upload zone */}
      {imageDataUrl ? (
        <div className="relative">
          <img
            src={imageDataUrl}
            alt="Your handwritten answer"
            className="w-full rounded-xl border-2 border-emerald-200 object-contain max-h-80 bg-white cursor-zoom-in"
            onClick={() => setZoomed(true)}
          />
          <button
            onClick={removeImage}
            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 shadow"
          >
            <X size={12} />
          </button>
          <div className="mt-1 text-[10px] text-emerald-600 font-medium text-center">
            ✓ Handwritten answer uploaded · tap image to zoom
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-slate-300 hover:border-primary-400 rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors bg-slate-50 hover:bg-primary-50"
        >
          <div className="h-12 w-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">
            <Camera size={22} className="text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">Upload handwritten answer</p>
            <p className="text-xs text-slate-400 mt-0.5">Photo from camera or gallery · JPG / PNG</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-1 text-xs text-primary-600 bg-primary-50 border border-primary-100 px-3 py-1 rounded-full">
              <Upload size={11} /> Browse / Camera
            </span>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {/* Optional typed text */}
      <div className="space-y-1.5">
        <p className="text-xs text-slate-500 font-medium">
          Or type your answer{imageDataUrl ? ' (optional — image is primary)' : ` (${marks} marks):`}
        </p>
        <textarea
          value={text}
          onChange={(e) => onChange({ text: e.target.value, imageDataUrl })}
          placeholder="Type answer if not uploading an image…"
          rows={imageDataUrl ? 2 : 5}
          className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-primary-500 outline-none text-sm text-slate-900 bg-white resize-none transition-colors"
        />
      </div>

      <AnimatePresence>
        {zoomed && imageDataUrl && <ZoomOverlay url={imageDataUrl} onClose={() => setZoomed(false)} />}
      </AnimatePresence>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────── */
export default function QuestionView({ question, questionNumber, selectedOption, onSelect, direction = 1, canChange = false }) {
  if (!question) return null;

  const qType         = question.type || 'MCQ';
  const isNumerical   = qType === 'Numerical';
  const isMatch       = qType === 'Match the Following';
  const isShortAnswer = qType === 'Short Answer';
  const isLongAnswer  = qType === 'Long Answer';
  const isDescriptive = isShortAnswer || isLongAnswer;

  const marksVal      = question.marks?.correct ?? (typeof question.marks === 'number' ? question.marks : 4);
  // Integer marks = CBSE/board style → no negative marking
  const negMarks      = typeof question.marks === 'number' ? 0 : (question.marks?.incorrect ?? -1);
  const chapter       = question.chapter || question.topic || null;
  const section       = question.section || null;

  const sectionColor = {
    A: 'text-blue-700 bg-blue-50 border-blue-200',
    B: 'text-violet-700 bg-violet-50 border-violet-200',
    C: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    D: 'text-orange-700 bg-orange-50 border-orange-200',
    E: 'text-red-700 bg-red-50 border-red-200',
  }[section] ?? 'text-slate-600 bg-slate-50 border-slate-200';

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={question.id}
        custom={direction}
        variants={{
          enter:  (d) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
          center: { x: 0, opacity: 1 },
          exit:   (d) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
        }}
        initial="enter" animate="center" exit="exit"
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="space-y-4"
      >
        {/* ── Paper-style meta bar ─────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Question number */}
          <span className="text-sm font-extrabold text-slate-700 tabular-nums">Q{questionNumber}</span>

          {/* Section badge */}
          {section && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sectionColor}`}>
              Sec {section}
            </span>
          )}

          {/* Type badge */}
          {qType !== 'MCQ' && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-violet-200 text-violet-700 bg-violet-50">
              {qType}
            </span>
          )}

          {/* Chapter */}
          {chapter && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              <BookOpen size={9} /> {chapter}
            </span>
          )}

          {/* Marks in [brackets] — right-aligned */}
          <span className="ml-auto text-xs font-bold text-slate-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg tabular-nums">
            [{marksVal} {marksVal === 1 ? 'mark' : 'marks'}]
          </span>
        </div>

        {/* ── Question text ─────────────────────────────────── */}
        <div className="text-base text-slate-900 leading-relaxed font-medium">
          <MathText text={question.question} />
        </div>

        {/* ── Attached images ───────────────────────────────── */}
        <QuestionImage url={question.image_url} />
        {!question.image_url && <DiagramBox description={question.diagram_description} />}

        {/* ── Match the Following columns ───────────────────── */}
        {isMatch && (question.columnI || question.columnII) && (
          <MatchColumns columnI={question.columnI} columnII={question.columnII} />
        )}

        {/* ── Answer area ───────────────────────────────────── */}
        {isNumerical && (
          <NumericalInput value={selectedOption} onChange={onSelect} />
        )}

        {isShortAnswer && (
          <ShortAnswerInput
            value={selectedOption}
            onChange={onSelect}
            marks={marksVal}
          />
        )}

        {isLongAnswer && (
          <LongAnswerUpload
            value={selectedOption}
            onChange={onSelect}
            marks={marksVal}
          />
        )}

        {!isNumerical && !isDescriptive && (
          <div className="space-y-2">
            {(() => {
              const hasSelection = selectedOption !== null && selectedOption !== undefined;
              // NTA exams: lock all after first selection. CBSE (canChange): always clickable.
              const isLocked = hasSelection && !canChange;
              return (question.options || []).map((opt, i) => {
                const isSelected = selectedOption === i;
                return (
                  <motion.button
                    key={i}
                    whileTap={isLocked ? {} : { scale: 0.99 }}
                    onClick={() => onSelect(i)}
                    disabled={isLocked && !isSelected}
                    className={[
                      'w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl border-2',
                      'transition-all duration-150 min-h-[48px]',
                      isSelected
                        ? 'border-primary-500 bg-primary-50 text-primary-800'
                        : isLocked
                          ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700',
                    ].join(' ')}
                  >
                    <span className={[
                      'h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                      isSelected ? 'bg-primary-600 text-white' : isLocked ? 'bg-slate-100 text-slate-300' : 'bg-slate-100 text-slate-500',
                    ].join(' ')}>
                      {OPTION_LETTERS[i]}
                    </span>
                    <span className="flex-1 text-sm leading-snug">
                      <MathText text={opt} />
                    </span>
                    {isSelected && <CheckCircle2 size={16} className="text-primary-600 shrink-0" />}
                  </motion.button>
                );
              });
            })()}
            {/* CBSE: show tap-to-deselect hint when an option is selected */}
            {canChange && selectedOption !== null && selectedOption !== undefined && (
              <p className="text-[10px] text-slate-400 text-center">Tap selected option again to deselect</p>
            )}
          </div>
        )}

        {/* ── Marking info footer ───────────────────────────── */}
        <div className="flex gap-3 text-xs text-slate-400 pt-1">
          <span>✅ +{marksVal} correct</span>
          {negMarks !== 0 && !isDescriptive && (
            <span>❌ {negMarks} wrong</span>
          )}
          {isDescriptive && (
            <span className="text-amber-600">✏️ Descriptive — AI-evaluated on submission</span>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
