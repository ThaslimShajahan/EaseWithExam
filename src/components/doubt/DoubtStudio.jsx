import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, X, Plus, Images,
  Calculator, BookOpen, Globe, Sparkles, Atom, FlaskConical, Brain, Sigma,
} from 'lucide-react';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useAuth } from '../../context/AuthContext';
import ImageViewer from './ImageViewer';
import ChatInterface from './ChatInterface';
import { VedaAvatarLg, VedaChip } from '../ui/VedaAvatar';
import { buildExamType } from '../../lib/categories';

function getSubjectChips(userProfile) {
  // target_exam alone is the raw onboarding enum ('CLASS_10', 'JEE_MAIN', …) —
  // resolve through buildExamType() so board students actually match isBoard.
  const exam    = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const isBoard = /^(CBSE|ICSE|Class \d+|State Board|Kerala State)/.test(exam);
  const isJEE   = exam === 'JEE Main' || exam === 'JEE Advanced';
  const isBoth  = userProfile?.target_exam === 'BOTH';

  // Icons match SUBJECT_ICONS in PracticeGeneratorPage.jsx (the app's other
  // subject-chip picker) so the same subject reads the same way everywhere,
  // instead of this being the one spot still using raw emoji.
  if (isBoard) {
    return [
      { icon: Calculator, label: 'Math & Science',  desc: 'Physics, Chemistry, Maths numericals' },
      { icon: BookOpen,   label: 'English',          desc: 'Essays, comprehension, grammar' },
      { icon: Globe,      label: 'Social Studies',   desc: 'History, Geography, Civics, Economics' },
      { icon: Sparkles,   label: 'All subjects',     desc: 'Any subject from your board curriculum' },
    ];
  }
  if (isJEE) {
    return [
      { icon: Atom,         label: 'Physics',     desc: 'Numericals, formula errors, unit mistakes' },
      { icon: FlaskConical, label: 'Chemistry',   desc: 'Mechanisms, balancing, IUPAC naming' },
      { icon: Sigma,        label: 'Mathematics', desc: 'Calculus, algebra, coordinate geometry' },
    ];
  }
  if (isBoth) {
    return [
      { icon: Atom,         label: 'Physics',     desc: 'Numericals, formula errors, unit mistakes' },
      { icon: FlaskConical, label: 'Chemistry',   desc: 'Mechanisms, balancing, IUPAC naming' },
      { icon: Brain,        label: 'Biology',     desc: 'Diagrams, definitions, concept gaps' },
      { icon: Sigma,        label: 'Mathematics', desc: 'Calculus, algebra, coordinate geometry' },
    ];
  }
  return [
    { icon: Atom,         label: 'Physics',   desc: 'Numericals, formula errors, unit mistakes' },
    { icon: FlaskConical, label: 'Chemistry', desc: 'Mechanisms, balancing, IUPAC naming' },
    { icon: Brain,        label: 'Biology',   desc: 'Diagrams, definitions, concept gaps' },
  ];
}

function DropZone({ onFiles, hasImages }) {
  const inputRef        = useRef(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = (fileList) => {
    const imgs = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) onFiles(imgs);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true);  }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e)  => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={[
        'border-2 border-dashed rounded-2xl transition-all duration-200 cursor-pointer',
        'flex flex-col items-center justify-center gap-3 p-8 text-center',
        drag
          ? 'border-primary-400 bg-primary-50'
          : 'border-slate-300 bg-slate-50 hover:border-primary-300 hover:bg-primary-50/40',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className={`h-14 w-14 rounded-2xl flex items-center justify-center transition-colors ${drag ? 'bg-primary-100' : 'bg-slate-200'}`}>
        {hasImages ? <Plus size={24} className={drag ? 'text-primary-600' : 'text-slate-500'} /> : <Upload size={24} className={drag ? 'text-primary-600' : 'text-slate-500'} />}
      </div>
      <div>
        <p className="font-semibold text-slate-700">
          {hasImages ? 'Add more pages' : 'Drop your answer sheets here'}
        </p>
        <p className="text-sm text-slate-400 mt-0.5">
          {hasImages ? 'or tap to select · multiple pages supported' : 'or tap to select · camera supported · multiple pages'}
        </p>
      </div>
      {!hasImages && (
        <div className="flex gap-2">
          {['PNG', 'JPG', 'HEIC'].map((t) => (
            <span key={t} className="badge bg-white border border-slate-200 text-slate-400">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* Thumbnail strip for multiple images */
function ImageStrip({ imageUrls, onRemove, onPreview }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {imageUrls.map((url, i) => (
        <div key={i} className="relative group">
          <img
            src={url}
            alt={`Page ${i + 1}`}
            onClick={() => onPreview(i)}
            className="h-20 w-16 object-cover rounded-xl border-2 border-white cursor-pointer hover:border-primary-400 transition-colors"
          />
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(i); }}
            className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-red-500 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={10} />
          </button>
          <span className="absolute bottom-1 left-0 right-0 text-center text-[9px] font-bold text-white bg-black/50 rounded-b-xl py-0.5">
            {i + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

/* Veda intro card shown before any image is uploaded */
function VedaIntro({ userProfile }) {
  const chips = getSubjectChips(userProfile);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-primary-50 rounded-2xl border border-primary-100">
        <div className="shrink-0">
          <VedaAvatarLg />
        </div>
        <div>
          <p className="font-semibold text-primary-900">Meet EWE</p>
          <p className="text-sm text-primary-700 mt-0.5 leading-relaxed">
            Upload your answer sheets — EWE will evaluate every step and find exactly where things went wrong. Multiple pages supported.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">EWE evaluates</p>
        {chips.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50">
            <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
              <Icon size={15} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">{label}</p>
              <p className="text-xs text-slate-400">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Uncapped uploads risked huge base64 payloads to the GPT-4o vision API
// (unhelpful generic failures on oversized/too-many requests) — cap both
// how many pages and how large each one can be before it's even previewed.
const MAX_IMAGES        = 6;
const MAX_FILE_SIZE_MB  = 10;

export default function DoubtStudio() {
  const isDesktop = useIsDesktop();
  const { userProfile } = useAuth();
  const [imageFiles,    setImageFiles]    = useState([]);
  const [imageUrls,     setImageUrls]     = useState([]);
  const [previewIdx,    setPreviewIdx]    = useState(null);
  const [uploadWarning, setUploadWarning] = useState('');
  // Mobile "add more page" button — a persistent, DOM-mounted input (matching
  // every other upload trigger in the app), not one created on the fly with
  // document.createElement() and .click()'d without ever attaching it to the
  // DOM. A detached input is unreliable at surfacing the full camera+gallery
  // picker sheet on several mobile browsers — the same class of bug as the
  // `capture`-attribute fix elsewhere, just a different mechanism.
  const addMoreInputRef = useRef(null);

  // imageUrls captured by ref so the unmount cleanup below always sees the
  // latest object URLs rather than the stale empty array from first render.
  const imageUrlsRef = useRef(imageUrls);
  useEffect(() => { imageUrlsRef.current = imageUrls; }, [imageUrls]);
  useEffect(() => () => { imageUrlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const addFiles = (files) => {
    const remaining = MAX_IMAGES - imageFiles.length;
    if (remaining <= 0) {
      setUploadWarning(`You've reached the ${MAX_IMAGES}-page limit per doubt — remove a page to add another.`);
      return;
    }
    const oversized = files.filter((f) => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
    const accepted   = files.filter((f) => f.size <= MAX_FILE_SIZE_MB * 1024 * 1024).slice(0, remaining);

    if (oversized.length) {
      setUploadWarning(`${oversized.length} image${oversized.length > 1 ? 's were' : ' was'} skipped — over the ${MAX_FILE_SIZE_MB}MB limit per page.`);
    } else if (files.length > remaining) {
      setUploadWarning(`Only ${remaining} more page${remaining === 1 ? '' : 's'} could be added (max ${MAX_IMAGES} per doubt).`);
    } else {
      setUploadWarning('');
    }

    if (!accepted.length) return;
    const newUrls = accepted.map((f) => URL.createObjectURL(f));
    setImageFiles((prev) => [...prev, ...accepted]);
    setImageUrls((prev)  => [...prev, ...newUrls]);
  };

  const removeImage = (idx) => {
    URL.revokeObjectURL(imageUrls[idx]);
    setImageFiles((prev) => prev.filter((_, i) => i !== idx));
    setImageUrls((prev)  => prev.filter((_, i) => i !== idx));
    if (previewIdx === idx) setPreviewIdx(null);
    setUploadWarning('');
  };

  const clearAll = () => {
    imageUrls.forEach((u) => URL.revokeObjectURL(u));
    setImageFiles([]);
    setImageUrls([]);
    setPreviewIdx(null);
    setUploadWarning('');
  };

  const hasImages = imageFiles.length > 0;

  /* ── Desktop: side-by-side ──────────────────────────── */
  if (isDesktop) {
    return (
      <div className="flex gap-0 h-[calc(100vh-128px)] bg-white rounded-2xl shadow-card border border-slate-100 overflow-hidden">

        {/* Left — document viewer */}
        <div className="w-[45%] border-r border-slate-100 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-700 text-sm">Answer Sheets</p>
              {hasImages && (
                <span className="text-[10px] bg-primary-100 text-primary-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Images size={10} /> {imageFiles.length} page{imageFiles.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {hasImages && (
              <button onClick={clearAll} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400" title="Remove all">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {uploadWarning && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-3 py-2">
                {uploadWarning}
              </div>
            )}
            <AnimatePresence mode="wait">
              {hasImages ? (
                <motion.div key="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  {/* Thumbnail strip */}
                  <ImageStrip
                    imageUrls={imageUrls}
                    onRemove={removeImage}
                    onPreview={setPreviewIdx}
                  />
                  {/* Main preview */}
                  <ImageViewer src={imageUrls[previewIdx ?? 0]} />
                  {/* Add more */}
                  <DropZone onFiles={addFiles} hasImages />
                </motion.div>
              ) : (
                <motion.div key="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  <DropZone onFiles={addFiles} hasImages={false} />
                  <VedaIntro userProfile={userProfile} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right — Veda chat */}
        <div className="flex-1 flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <VedaChip />
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatInterface imageFiles={imageFiles} />
          </div>
        </div>
      </div>
    );
  }

  /* ── Mobile: stacked ─────────────────────────────────── */
  // Was a hardcoded `h-[calc(100vh-120px)]` — a magic number that assumed
  // exactly TopHeader (59px) + BottomNav (65px) sat above/below this and
  // nothing else, which broke the moment DoubtStudioPage added its own
  // title block above this component (confirmed live: the page needed 122px
  // more scroll than the viewport height, on a screen that should fit
  // without any outer-page scroll at all). `h-full` inherits real, correct
  // space from the parent's own flex-1/min-h-0 chain instead of guessing it.
  return (
    <div className="flex flex-col h-full">
      <AnimatePresence>
        {hasImages ? (
          <motion.div
            className="shrink-0 border-b border-slate-100 bg-white"
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="p-3 space-y-2">
              {uploadWarning && (
                <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-3 py-2">
                  {uploadWarning}
                </div>
              )}
              {/* Thumbnail strip */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {imageUrls.map((url, i) => (
                  <div key={i} className="relative shrink-0 group">
                    <img
                      src={url}
                      alt={`Page ${i + 1}`}
                      onClick={() => setPreviewIdx(previewIdx === i ? null : i)}
                      className={`h-16 w-12 object-cover rounded-lg cursor-pointer border-2 transition-colors ${previewIdx === i ? 'border-primary-500' : 'border-white'}`}
                    />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full flex items-center justify-center text-white"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
                {/* Add more button */}
                <input
                  ref={addMoreInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                />
                <button
                  onClick={() => addMoreInputRef.current?.click()}
                  className="h-16 w-12 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center shrink-0 text-slate-400 hover:border-primary-400 transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
              {/* Preview of selected */}
              {previewIdx !== null && (
                <div className="relative h-40 rounded-xl overflow-hidden bg-black">
                  <img src={imageUrls[previewIdx]} alt="Preview" className="h-full w-full object-contain" />
                  <button onClick={() => setPreviewIdx(null)} className="absolute top-2 right-2 h-6 w-6 bg-black/60 rounded-full flex items-center justify-center text-white">
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div className="shrink-0 p-4 bg-white border-b border-slate-100 space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <DropZone onFiles={addFiles} hasImages={false} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 bg-white overflow-hidden">
        <ChatInterface imageFiles={imageFiles} />
      </div>
    </div>
  );
}
