import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Search, Loader2, FileText, Tag, Sparkles, ChevronRight, Layers, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { isRelevantToStudent } from '../../lib/categories';
import HubPageHeader from '../ui/HubPageHeader';
import MathText from '../ui/MathText';

const SUBJECT_COLORS = {
  Biology:     'bg-violet-100 text-violet-700',
  Physics:     'bg-blue-100 text-blue-700',
  Chemistry:   'bg-emerald-100 text-emerald-700',
  Mathematics: 'bg-orange-100 text-orange-700',
};

// Note content is AI-generated with lightweight markdown (**bold** section
// headings) — it was being dumped as a raw string, so students saw literal
// asterisks instead of formatted headings. Paragraphs split on blank lines;
// **bold** spans are parsed within each line. Same handling as
// SummarizerPage's renderer — segments go through MathText so any LaTeX in
// the AI-generated notes (physics/chem/maths content) renders as equations
// instead of literal $...$ text.
function renderNoteContent(content) {
  const paragraphs = content.split(/\n\s*\n/);
  return paragraphs.map((para, pi) => (
    <p key={pi} className="mb-3 last:mb-0">
      {para.split('\n').map((line, li, lines) => (
        <span key={li}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
            seg.startsWith('**') && seg.endsWith('**')
              ? <strong key={si} className="font-semibold text-slate-900"><MathText text={seg.slice(2, -2)} /></strong>
              : <MathText key={si} text={seg} />
          )}
          {li < lines.length - 1 && <br />}
        </span>
      ))}
    </p>
  ));
}

function NoteCard({ note }) {
  const [expanded, setExpanded] = useState(false);
  const subjCls = SUBJECT_COLORS[note.subject] || 'bg-slate-100 text-slate-600';

  return (
    <div className={`card-interactive bg-white rounded-2xl border overflow-hidden ${expanded ? 'border-primary-200' : 'border-slate-100'}`}>
      <div
        className="p-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 text-sm leading-snug">{note.title}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {(note.page_start || note.page_end) && (
                <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  pg {note.page_start ?? '?'}{note.page_end && note.page_end !== note.page_start ? `–${note.page_end}` : ''}
                </span>
              )}
              {note.subject && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${subjCls}`}>
                  {note.subject}
                </span>
              )}
              {note.chapter && (
                <span className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-full">{note.chapter}</span>
              )}
              {note.exam_type && (
                <span className="text-[10px] text-slate-400">{note.exam_type.replace('_', ' ')}</span>
              )}
            </div>
          </div>
          <ChevronRight size={16} className={`text-slate-300 shrink-0 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && note.content && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <div className="pt-3 text-sm text-slate-700 leading-relaxed">
            {renderNoteContent(note.content)}
          </div>
          {note.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {/* Some notes' AI-extracted tags contain literal duplicates — dedupe
                * before using the tag text as the React key. */}
              {[...new Set(note.tags)].map((t) => (
                <span key={t} className="flex items-center gap-1 text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  <Tag size={8} /> {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Groups notes by their `unit` field (e.g. "Unit 1: Wit and Wisdom") in
 * source-book order, mirroring the real Table of Contents. Notes without
 * a unit sit in an "Other Notes" bucket at the end.
 */
function UnitGroup({ unit, notes }) {
  const [open, setOpen] = useState(true);
  const isUngrouped = unit === '__ungrouped__';
  const pages = notes.filter(n => n.page_start != null).flatMap(n => [n.page_start, n.page_end ?? n.page_start]);
  const range = pages.length ? `pg ${Math.min(...pages)}–${Math.max(...pages)}` : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={15} className={isUngrouped ? 'text-slate-400' : 'text-primary-500'} />
          <p className="font-bold text-slate-900 text-sm truncate">{isUngrouped ? 'Other Notes' : unit}</p>
          <span className="text-[10px] text-slate-400 shrink-0">({notes.length})</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {range && <span className="text-[10px] font-mono text-slate-400">{range}</span>}
          <ChevronDown size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2">
          {notes.map(note => <NoteCard key={note.id} note={note} />)}
        </div>
      )}
    </div>
  );
}

/**
 * Shared reader for admin-published study_notes (Admin > Study Notes).
 *
 * scope="coaching" (Coaching Portal, staff-only) — get_coaching_centre_notes(p_uid)
 *   requires the caller to be registered coaching-centre staff; errors with
 *   "Not a coaching admin" for anyone else, including regular students.
 * scope="global" (individual student Study Hub) — reads study_notes directly,
 *   filtered to published + centre_id IS NULL ("Global (all students)" in the
 *   admin form), since students aren't coaching staff and can't call the RPC above.
 */
export default function NotesBrowser({ title = 'Study Notes', showCount = true, scope = 'global' }) {
  const navigate = useNavigate();
  const { currentUser, userProfile } = useAuth();
  const [notes,   setNotes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [subjectFilter, setSubject] = useState('All');

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        if (scope === 'coaching') {
          const { data, error: err } = await supabase.rpc('get_coaching_centre_notes', {
            p_uid: currentUser.uid,
          });
          if (err) throw err;
          setNotes(Array.isArray(data) ? data : []);
        } else {
          const { data, error: err } = await supabase
            .from('study_notes')
            .select('id, title, subject, exam_type, chapter, content, tags, created_at, unit, page_start, page_end, sort_order')
            .eq('is_published', true)
            .is('centre_id', null)
            .order('created_at', { ascending: false });
          if (err) throw err;
          // Published notes span every board/class an admin has approved —
          // scope down to the ones matching THIS student's own board+class
          // (or target exam), same rule Exam Center uses for papers, so a
          // Class 8 student never sees Class 12 chapter notes and vice versa.
          setNotes((data ?? []).filter((n) => isRelevantToStudent(n.exam_type, userProfile)));
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, scope, userProfile?.syllabus, userProfile?.class_level, userProfile?.target_exam]);

  const subjects = ['All', ...new Set(notes.map(n => n.subject).filter(Boolean))];

  const filtered = notes.filter((n) => {
    const q = search.toLowerCase();
    const matchSearch = !search ||
      n.title.toLowerCase().includes(q) ||
      (n.chapter || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q);
    const matchSubject = subjectFilter === 'All' || n.subject === subjectFilter;
    return matchSearch && matchSubject;
  });

  return (
    <div className="space-y-5">
      <HubPageHeader
        icon={BookOpen}
        title={title}
        subtitle={`Curated notes uploaded by your ${scope === 'coaching' ? 'centre' : 'teachers/admin'}${showCount ? ` · ${notes.length} note${notes.length !== 1 ? 's' : ''}` : ''}`}
        showBack={scope !== 'coaching'}
      />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 space-y-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>
        {subjects.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((s) => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className={[
                  'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
                  subjectFilter === s
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300',
                ].join(' ')}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-8">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center">
              <BookOpen size={28} className="text-primary-400" />
            </div>
          </div>
          <div>
            <p className="font-bold text-slate-900">
              {search || subjectFilter !== 'All' ? 'No notes match your filters' : 'No published study notes yet'}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {search || subjectFilter !== 'All'
                ? 'Try a different search or subject.'
                : scope === 'coaching'
                  ? 'Publish notes from Coaching Portal → Notes to see them here.'
                  : "Your teachers haven't uploaded notes for this yet — try instant AI-generated notes instead."}
            </p>
          </div>
          {scope !== 'coaching' && !search && subjectFilter === 'All' && (
            <button
              onClick={() => navigate('/exams?tab=practice')}
              className="mx-auto flex items-center justify-center gap-1.5 text-sm text-primary-600 font-semibold hover:text-primary-700"
            >
              <Sparkles size={14} /> Or generate AI concept notes instead
            </button>
          )}
        </div>
      ) : filtered.some((n) => n.unit) ? (
        <div className="space-y-3">
          {[...new Map(
            filtered
              .reduce((groups, n) => {
                const key = n.unit?.trim() || '__ungrouped__';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(n);
                return groups;
              }, new Map())
          )]
            .sort(([a], [b]) => {
              if (a === '__ungrouped__') return 1;
              if (b === '__ungrouped__') return -1;
              return a.localeCompare(b, undefined, { numeric: true });
            })
            .map(([unit, list]) => (
              <UnitGroup
                key={unit}
                unit={unit}
                notes={[...list].sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || (x.page_start ?? 0) - (y.page_start ?? 0))}
              />
            ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  );
}
