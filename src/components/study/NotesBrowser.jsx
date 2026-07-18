import { useEffect, useState } from 'react';
import { BookOpen, Search, Loader2, FileText, Tag } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

const SUBJECT_COLORS = {
  Biology:     'bg-violet-100 text-violet-700',
  Physics:     'bg-blue-100 text-blue-700',
  Chemistry:   'bg-emerald-100 text-emerald-700',
  Mathematics: 'bg-orange-100 text-orange-700',
};

function NoteCard({ note }) {
  const [expanded, setExpanded] = useState(false);
  const subjCls = SUBJECT_COLORS[note.subject] || 'bg-slate-100 text-slate-600';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
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
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {note.subject && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${subjCls}`}>
                  {note.subject}
                </span>
              )}
              {note.chapter && (
                <span className="text-[10px] text-slate-400">{note.chapter}</span>
              )}
              {note.exam_type && (
                <span className="text-[10px] text-slate-400">{note.exam_type.replace('_', ' ')}</span>
              )}
            </div>
          </div>
          <span className="text-xs text-slate-400 shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && note.content && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <div className="pt-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {note.content}
          </div>
          {note.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {note.tags.map((t) => (
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
  const { currentUser }   = useAuth();
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
            .select('id, title, subject, exam_type, chapter, content, tags, created_at')
            .eq('is_published', true)
            .is('centre_id', null)
            .order('created_at', { ascending: false });
          if (err) throw err;
          setNotes(data ?? []);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, scope]);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <BookOpen size={20} className="text-primary-600" /> {title}
        </h1>
        {showCount && <span className="text-xs text-slate-400">{notes.length} notes</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400 w-52"
          />
        </div>
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

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-8">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <BookOpen size={28} className="text-slate-300 mx-auto" />
          <p className="text-sm text-slate-400">
            {search || subjectFilter !== 'All' ? 'No notes match your filters.' : 'No published study notes yet.'}
          </p>
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
