import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ArrowLeft, Check, Atom, Landmark, BookOpen as HumanitiesIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import { sendTransactionalEmail } from '../lib/email';
import { applyPendingReferral } from '../lib/referral';
import { EXAM_OPTIONS, BOARD_OPTIONS, CLASS_OPTIONS } from '../lib/onboardingOptions';
import { resolveOnboardingIcon } from '../lib/onboardingIconRegistry';
import { resolveBoard } from '../lib/categories';
import { useStreamConfig } from '../hooks/useStreamConfig';
import { useFeatureFlag, FLAGS } from '../lib/featureFlags';
import {
  hasStreamsFor, needsLanguageChoice, isAutoSelectAll, availableOptionalSubjects,
  matchedCombinationName, flattenSubjects, buildAcademicTrack,
} from '../lib/streamSelection';
import Button from '../components/ui/Button';

// Literal Tailwind classes per color — written out in full so Tailwind's
// content scanner can see them (dynamically building `bg-${color}-50` string
// at runtime would never get picked up at build time).
const COLOR_MAP = {
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    ring: 'ring-rose-200'    },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    ring: 'ring-blue-200'    },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600',  ring: 'ring-violet-200'  },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-200'   },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     ring: 'ring-sky-200'     },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-200' },
  teal:    { bg: 'bg-teal-50',    text: 'text-teal-600',    ring: 'ring-teal-200'    },
  green:   { bg: 'bg-green-50',   text: 'text-green-600',   ring: 'ring-green-200'   },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-200'  },
  slate:   { bg: 'bg-slate-100',  text: 'text-slate-600',   ring: 'ring-slate-200'   },
  purple:  { bg: 'bg-purple-50',  text: 'text-purple-600',  ring: 'ring-purple-200'  },
};

// stream_key is CHECK-constrained to exactly these three values (20260813040000) —
// unlike every subject/board/combination in this flow, which comes from data,
// picking a glyph for one of a fixed, schema-enforced set of 3 concepts is a
// presentational choice, the same kind COLOR_MAP already makes. A 4th stream
// category would need a CHECK-constraint migration anyway, so an icon-map
// update at the same time is proportionate, not a violation of "don't
// hardcode curriculum facts" — no subject, pool or combination lives here.
const STREAM_ICON = { science: Atom, commerce: Landmark, humanities: HumanitiesIcon };
const STREAM_COLOR = { science: 'blue', commerce: 'emerald', humanities: 'violet' };

// Class gates which competitive exams are offered (allowed_class_levels on the
// option row), so a Class 8 student is never shown NEET/JEE. An empty
// allowed_class_levels means "offer for every class".
function examOptionsForClass(classLevel) {
  if (!classLevel) return [];
  return EXAM_OPTIONS.filter((o) => {
    const allowed = o.allowed_class_levels ?? [];
    return allowed.length === 0 || allowed.includes(String(classLevel));
  });
}

// The competitive step is only worth showing when there's a real choice, and
// the stream steps only exist when stream_configs actually has rows for this
// board+tier — a board with none (ICSE, State Board today) simply gets no
// stream steps, no code change needed when that data arrives. `streamsApply`
// and `currentStreamConfig` are DATA lookups, never a board-name comparison.
function getSteps({ classLevel, streamsApply, languageConfig, currentStreamConfig }) {
  const examOpts = examOptionsForClass(classLevel);
  const steps = [
    { id: 'class', type: 'options', title: 'Which class are you in?',  field: 'classLevel', options: CLASS_OPTIONS },
    { id: 'board', type: 'options', title: 'Which board or syllabus?', field: 'syllabus',   options: BOARD_OPTIONS },
  ];
  if (streamsApply) {
    steps.push({ id: 'stream', type: 'stream', title: 'Choose your stream' });
    // Kerala's shape: a dedicated screen for the second-language pick.
    // CBSE's shape: no choice to make, so no screen — its one mandatory
    // language is folded into the streamSubjects step's locked chips instead.
    if (needsLanguageChoice(languageConfig)) {
      steps.push({ id: 'language', type: 'language', title: 'Choose your second language' });
    }
    steps.push({ id: 'streamSubjects', type: 'streamSubjects', title: 'Choose your subjects' });
    if (currentStreamConfig?.optional_slots?.length > 0) {
      steps.push({ id: 'optionalSixth', type: 'optionalSixth', title: 'Optional 6th subject' });
    }
    steps.push({ id: 'confirm', type: 'confirm', title: 'Confirm your subjects' });
  }
  if (examOpts.length > 1) {
    steps.push({ id: 'exam', type: 'options', title: 'Also preparing for a competitive exam?', field: 'targetExam', options: examOpts });
  }
  return steps;
}

function OptionCard({ icon: IconOverride, option, selected, disabled, onSelect, description }) {
  const c = COLOR_MAP[option?.color] ?? COLOR_MAP.slate;
  const Icon = IconOverride ?? resolveOnboardingIcon(option?.icon_name);
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.98 }}
      disabled={disabled}
      onClick={() => onSelect(option.key)}
      className={[
        'relative w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-200',
        disabled ? 'opacity-40 cursor-not-allowed border-slate-200 bg-white' :
        selected
          ? `border-primary-500 bg-primary-50/60 shadow-md ring-4 ring-primary-100`
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm',
      ].join(' ')}
    >
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${c.bg}`}>
        <Icon size={20} className={c.text} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900">{option.title}</p>
        {(description ?? option.description) && <p className="text-xs text-slate-500 mt-0.5">{description ?? option.description}</p>}
      </div>
      <div className={[
        'h-6 w-6 rounded-full flex items-center justify-center shrink-0 border-2 transition-all',
        selected ? 'bg-primary-600 border-primary-600' : 'border-slate-200',
      ].join(' ')}>
        <AnimatePresence>
          {selected && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
              <Check size={14} className="text-white" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.button>
  );
}

function LockedChip({ label }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600">
      <Check size={12} strokeWidth={3} className="text-slate-400" />
      {label}
    </span>
  );
}

export default function OnboardingPage() {
  const { completeOnboarding, currentUser } = useAuth();
  const navigate = useNavigate();
  const [step,    setStep]    = useState(0);
  const [loading, setLoading] = useState(false);
  // targetExam defaults to the board-only sentinel, so a student whose class
  // has no competitive options (and therefore never sees that step) still
  // completes onboarding with a valid, explicit value rather than ''.
  const [profile, setProfile] = useState({
    targetExam: 'NONE', syllabus: '', classLevel: '',
    stream: '', languageChoice: '', chosenSlotSubjects: [], optional6th: null,
  });

  // Onboarding stores UPPER_SNAKE board keys ('KERALA_STATE'); stream_configs
  // is keyed on the display form ('Kerala State'), same convention as
  // exam_categories.board_key. Comparing profile.syllabus directly against
  // stream_configs would silently never match for Kerala — CBSE only
  // "worked" by coincidence because its onboarding key and board_key happen
  // to be the identical string. resolveBoard() is the SAME normalisation
  // categories.js already had to add once for this exact bug class
  // (BOARD_KEY_ALIASES) — reused here rather than re-solving it.
  const resolvedBoard = resolveBoard(profile.syllabus);
  const { streamConfigs, languageConfig, loading: streamDataLoading } = useStreamConfig(resolvedBoard, profile.classLevel);
  const { value: streamFlagOn, loading: streamFlagLoading } = useFeatureFlag(FLAGS.STREAM_SELECTION);
  // Gated on BOTH the flag and real data existing for this board+tier — a
  // board with the flag on but no stream_configs rows yet (ICSE, State
  // Board today) still gets no stream step, and the flag being off hides the
  // step everywhere even though the underlying data is already live.
  const streamsApply = streamFlagOn && hasStreamsFor(streamConfigs, resolvedBoard, profile.classLevel);
  const currentStreamConfig = streamConfigs.find((s) => s.stream_key === profile.stream) ?? null;

  const steps   = getSteps({ classLevel: profile.classLevel, streamsApply, languageConfig, currentStreamConfig });
  const current = steps[step];
  const isLast  = step === steps.length - 1;

  // Per-step-type "can we proceed" — the simple option steps use a single
  // profile field; the stream steps have compound state with their own rules.
  const canProceed = (() => {
    if (!current) return false;
    switch (current.type) {
      case 'options':       return !!profile[current.field];
      case 'stream':        return !!profile.stream;
      case 'language':      return !!profile.languageChoice;
      case 'streamSubjects': {
        const slot = currentStreamConfig?.choice_slots?.[0];
        return slot ? profile.chosenSlotSubjects.length === slot.count : false;
      }
      case 'optionalSixth': return true; // always skippable
      case 'confirm':       return true; // review-only
      default:               return false;
    }
  })();

  const handleSelect = (id) => setProfile((p) => ({ ...p, [current.field]: id }));

  // Changing class re-gates the competitive-exam step, so any target that's
  // no longer offered for the new class has to be dropped. Changing class OR
  // board also invalidates any stream progress already made — a student who
  // picked Science under CBSE and then goes back and changes board must not
  // carry Science-shaped chosen_slot_subjects into a board whose Science pool
  // is entirely different.
  const resetStreamProgress = (p) => ({ ...p, stream: '', languageChoice: '', chosenSlotSubjects: [], optional6th: null });

  const handleClassSelect = (id) => {
    setProfile((p) => {
      const stillAllowed = examOptionsForClass(id).some((o) => o.key === p.targetExam);
      return resetStreamProgress({ ...p, classLevel: id, targetExam: stillAllowed ? p.targetExam : 'NONE' });
    });
  };
  const handleBoardSelect = (id) => setProfile((p) => resetStreamProgress({ ...p, syllabus: id }));

  const handleStreamSelect = (streamKey) => setProfile((p) => ({ ...p, stream: streamKey, chosenSlotSubjects: [], optional6th: null }));
  const handleLanguageSelect = (lang) => setProfile((p) => ({ ...p, languageChoice: lang }));

  const handleSlotSubjectToggle = (subject) => {
    const slot = currentStreamConfig?.choice_slots?.[0];
    if (!slot) return;
    setProfile((p) => {
      const already = p.chosenSlotSubjects.includes(subject);
      if (already) return { ...p, chosenSlotSubjects: p.chosenSlotSubjects.filter((s) => s !== subject) };
      if (p.chosenSlotSubjects.length >= slot.count) return p; // full — must deselect first
      return { ...p, chosenSlotSubjects: [...p.chosenSlotSubjects, subject] };
    });
  };
  const handleOptionalSixthSelect = (subject) => setProfile((p) => ({ ...p, optional6th: p.optional6th === subject ? null : subject }));

  const handleNext = async () => {
    if (!canProceed) return;
    if (isLast) {
      setLoading(true);
      try {
        const completionFields = {
          targetExam: profile.targetExam || 'NONE',
          syllabus:   profile.syllabus,
          classLevel: profile.classLevel,
        };
        // Only students who actually went through the stream flow get
        // subjects/academicTrack written — everyone else (Classes 8-10, or a
        // board with no stream_configs yet) leaves both untouched, and every
        // existing downstream reader keeps working off the board-level list
        // exactly as before (20260813050000's column comments).
        if (streamsApply && profile.stream) {
          completionFields.subjects = flattenSubjects({
            boardLanguageConfig: languageConfig, languageChoice: profile.languageChoice || null,
            streamConfig: currentStreamConfig, chosenSlotSubjects: profile.chosenSlotSubjects, optional6th: profile.optional6th,
          });
          completionFields.academicTrack = buildAcademicTrack({
            boardKey: resolvedBoard, streamKey: profile.stream, languageChoice: profile.languageChoice || null,
            chosenSlotSubjects: profile.chosenSlotSubjects, optional6th: profile.optional6th,
          });
        }
        await completeOnboarding(completionFields);
        if (currentUser) {
          // Redeem a code carried in from a referral link. Deliberately not
          // awaited and never fatal — a stale or already-used code must not
          // stand between a student and their dashboard.
          applyPendingReferral(currentUser.uid).catch(() => {});
          createNotification(
            currentUser.uid,
            'welcome',
            'Welcome to EaseWithExam! 🎉',
            'Your study journey starts now. Try the daily challenge or take a mock test.',
            '/dashboard',
          ).catch(() => {});
          const examTitle = EXAM_OPTIONS.find((o) => o.key === profile.targetExam)?.title ?? profile.targetExam;
          sendTransactionalEmail(currentUser.uid, 'welcome', {
            displayName: currentUser.displayName,
            targetExam:  examTitle,
          });
        }
        navigate('/dashboard');
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleSkipOptional = () => { setProfile((p) => ({ ...p, optional6th: null })); setStep((s) => s + 1); };
  const handleBack = () => { if (step > 0) setStep((s) => s - 1); };

  // Holds the flow on the Board step (via the disabled/loading Next button)
  // until the stream-data fetch resolves, so `steps` is already final by the
  // time the student advances — otherwise a slow fetch could let them skip
  // past where the Stream step should have been inserted.
  const nextBlockedByStreamFetch = current?.id === 'board' && !!profile.syllabus && (streamDataLoading || streamFlagLoading);

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden flex items-center justify-center p-4 py-10">
      {/* Ambient background glow — subtle, premium depth without a loud gradient */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary-200/30 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md lg:max-w-2xl">

        {/* Brand chip */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center font-bold text-white text-sm shadow-float">E</div>
          <span className="font-bold text-slate-800 text-lg">EaseWithExam</span>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? 'bg-primary-600 w-8' : i < step ? 'bg-primary-300 w-2' : 'bg-slate-200 w-2'
              }`}
            />
          ))}
        </div>

        <div className="bg-white/70 backdrop-blur-xl border border-white shadow-xl rounded-3xl p-5 sm:p-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0  }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25 }}
            >
              <div className="mb-5 text-center lg:text-left">
                <p className="text-xs text-primary-600 font-semibold uppercase tracking-wider">
                  Step {step + 1} of {steps.length}
                </p>
                <h1 className="text-2xl font-bold text-slate-900 mt-1">{current?.title}</h1>
              </div>

              <div className="max-h-[55vh] lg:max-h-[50vh] overflow-y-auto pr-1 scrollbar-hide">
                {current?.type === 'options' && (
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {current.options.map((opt) => (
                      <OptionCard
                        key={opt.key}
                        option={opt}
                        selected={profile[current.field] === opt.key}
                        onSelect={current.field === 'classLevel' ? handleClassSelect : current.field === 'syllabus' ? handleBoardSelect : handleSelect}
                      />
                    ))}
                  </div>
                )}

                {current?.type === 'stream' && (
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {streamConfigs.map((s) => (
                      <OptionCard
                        key={s.stream_key}
                        icon={STREAM_ICON[s.stream_key]}
                        option={{ key: s.stream_key, title: s.label, color: STREAM_COLOR[s.stream_key] }}
                        description={s.description}
                        selected={profile.stream === s.stream_key}
                        onSelect={handleStreamSelect}
                      />
                    ))}
                  </div>
                )}

                {current?.type === 'language' && (
                  <div>
                    {languageConfig?.mandatory_languages?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {languageConfig.mandatory_languages.map((l) => <LockedChip key={l} label={l} />)}
                      </div>
                    )}
                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {(languageConfig?.choice_language_slot?.choose_from ?? []).map((lang) => (
                        <OptionCard
                          key={lang}
                          option={{ key: lang, title: lang }}
                          selected={profile.languageChoice === lang}
                          onSelect={handleLanguageSelect}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {current?.type === 'streamSubjects' && currentStreamConfig && (() => {
                  const slot = currentStreamConfig.choice_slots[0];
                  const autoAll = isAutoSelectAll(slot);
                  // CBSE has no dedicated Language step, so its one mandatory
                  // language is folded into this step's locked chips instead.
                  const lockedLanguages = !needsLanguageChoice(languageConfig) ? (languageConfig?.mandatory_languages ?? []) : [];
                  return (
                    <div>
                      {(lockedLanguages.length > 0 || currentStreamConfig.stream_mandatory.length > 0) && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {[...lockedLanguages, ...currentStreamConfig.stream_mandatory].map((s) => <LockedChip key={s} label={s} />)}
                        </div>
                      )}
                      {autoAll ? (
                        <div className="flex flex-wrap gap-2">
                          {slot.choose_from.map((s) => <LockedChip key={s} label={s} />)}
                          <p className="w-full text-xs text-slate-400 mt-1">All {slot.count} subjects in this stream are included automatically.</p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-slate-500 mb-3">{slot.label} ({profile.chosenSlotSubjects.length}/{slot.count} selected)</p>
                          <div className="grid sm:grid-cols-2 gap-2.5">
                            {slot.choose_from.map((subject) => {
                              const selected = profile.chosenSlotSubjects.includes(subject);
                              const disabled = !selected && profile.chosenSlotSubjects.length >= slot.count;
                              return (
                                <OptionCard
                                  key={subject}
                                  option={{ key: subject, title: subject }}
                                  selected={selected}
                                  disabled={disabled}
                                  onSelect={handleSlotSubjectToggle}
                                />
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

                {current?.type === 'optionalSixth' && currentStreamConfig && (
                  <div>
                    <p className="text-xs text-slate-500 mb-3">Optional — not counted toward your graded 5. Skip if you don't need it.</p>
                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {availableOptionalSubjects(currentStreamConfig, profile.chosenSlotSubjects).map((subject) => (
                        <OptionCard
                          key={subject}
                          option={{ key: subject, title: subject }}
                          selected={profile.optional6th === subject}
                          onSelect={handleOptionalSixthSelect}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {current?.type === 'confirm' && currentStreamConfig && (() => {
                  const resolved = flattenSubjects({
                    boardLanguageConfig: languageConfig, languageChoice: profile.languageChoice || null,
                    streamConfig: currentStreamConfig, chosenSlotSubjects: profile.chosenSlotSubjects, optional6th: profile.optional6th,
                  });
                  // Kerala Commerce/Humanities have no named_combinations by
                  // design (no fabricated DHSE block names) — this correctly
                  // returns null for them and the badge is simply omitted,
                  // never a placeholder like "Combination 1".
                  const badge = matchedCombinationName(currentStreamConfig, profile.chosenSlotSubjects);
                  return (
                    <div>
                      {badge && (
                        <span className="inline-block mb-3 px-3 py-1 rounded-full bg-primary-50 text-primary-700 text-xs font-bold">{badge}</span>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {resolved.map((s) => <LockedChip key={s} label={s} />)}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="flex gap-3 mt-7">
            {step > 0 && (
              <Button variant="secondary" size="lg" icon={<ArrowLeft size={16} />} onClick={handleBack}>
                Back
              </Button>
            )}
            {current?.type === 'optionalSixth' && (
              <Button variant="secondary" size="lg" onClick={handleSkipOptional}>
                Skip
              </Button>
            )}
            <Button
              variant="primary" size="lg" full
              disabled={!canProceed || nextBlockedByStreamFetch}
              loading={loading || nextBlockedByStreamFetch}
              iconRight={<ArrowRight size={16} />}
              onClick={handleNext}
            >
              {isLast ? 'Get Started' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
