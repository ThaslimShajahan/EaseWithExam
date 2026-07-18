const STATUS_LABELS = [
  { key: 'not-visited', label: 'Not Visited',      color: 'bg-slate-100 text-slate-500'    },
  { key: 'unanswered',  label: 'Not Answered',      color: 'bg-red-100   text-red-600'      },
  { key: 'answered',    label: 'Answered',           color: 'bg-emerald-500 text-white'      },
  { key: 'review',      label: 'Marked for Review', color: 'bg-violet-500  text-white'      },
  { key: 'review-done', label: 'Answered + Marked', color: 'bg-violet-700  text-white'      },
];

function getStatus(questionId, answers, marked, visited, idx) {
  const answered = answers[questionId] !== undefined;
  const review   = marked.has(questionId);
  if (answered && review)  return 'review-done';
  if (review)              return 'review';
  if (answered)            return 'answered';
  if (visited.has(idx))   return 'unanswered';
  return 'not-visited';
}

/**
 * @param {Array}   questions   — real test questions from MockTestEngine
 * @param {Object}  answers     — { [questionId]: selectedOption }
 * @param {Set}     marked      — Set of questionIds marked for review
 * @param {Set}     visited     — Set of indices visited
 * @param {number}  currentIdx  — currently displayed question index
 * @param {Function} onJump     — (index) => void
 */
export default function QuestionPalette({ questions = [], answers, marked, visited, currentIdx, onJump }) {
  const subjects = [...new Set(questions.map((q) => q.subject))];

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {STATUS_LABELS.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`h-4 w-4 rounded ${color.split(' ')[0]}`} />
            <span className="text-[10px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Per-subject grids */}
      {subjects.map((subject) => {
        const qItems = questions
          .map((q, i) => ({ q, i }))
          .filter(({ q }) => q.subject === subject);

        return (
          <div key={subject}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {subject} <span className="text-slate-400 font-normal">({qItems.length})</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {qItems.map(({ q, i }) => {
                const status = getStatus(q.id, answers, marked, visited, i);
                return (
                  <button
                    key={q.id}
                    onClick={() => onJump(i)}
                    className={`q-cell ${status} ${i === currentIdx ? 'current' : ''}`}
                    title={`Q${i + 1}: ${q.topic || q.subject}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
