import { useEffect, useRef, useState } from 'react';
import { Search, User, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

/**
 * Searchable student picker — replaces "paste a Firebase UID you looked up
 * somewhere" text inputs across admin screens with a live name/email search
 * against the `users` table. One shared component so every admin screen that
 * needs to target a specific student behaves the same way.
 *
 * @param {{firebase_uid, display_name, email}|null} value - controlled selection
 * @param {(user: object|null) => void} onSelect
 * @param {string} [placeholder]
 */
export default function StudentPicker({ value, onSelect, placeholder = 'Search by name or email…' }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  useOnClickOutside(ref, () => setOpen(false));

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('firebase_uid, display_name, email, photo_url')
        .or(`email.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(8);
      setResults(data ?? []);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function pick(user) {
    setQuery('');
    setOpen(false);
    onSelect(user);
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 bg-slate-800 border border-white/10 rounded-xl px-3 py-2">
        {value.photo_url ? (
          <img src={value.photo_url} alt="" className="h-5 w-5 rounded-full shrink-0" />
        ) : (
          <User size={13} className="text-primary-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{value.display_name || value.email || value.firebase_uid}</p>
          {value.email && <p className="text-[10px] text-slate-500 truncate">{value.email}</p>}
        </div>
        <button onClick={() => onSelect(null)} className="shrink-0 p-1 rounded-lg hover:bg-white/10 text-slate-400">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full pl-8 pr-3 py-2 text-sm rounded-xl bg-slate-800 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full bg-slate-900 border border-white/10 rounded-xl shadow-xl max-h-56 overflow-y-auto">
          {loading ? (
            <p className="px-3 py-3 text-xs text-slate-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">No students found.</p>
          ) : (
            results.map((u) => (
              <button
                key={u.firebase_uid}
                onClick={() => pick(u)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left transition-colors"
              >
                <User size={12} className="text-slate-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-white truncate">{u.display_name || 'Unnamed'}</p>
                  <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
