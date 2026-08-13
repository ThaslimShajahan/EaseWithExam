import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { classTierFor } from '../lib/streamSelection';

/**
 * Fetches stream_configs + board_language_config for a board+class, once
 * both are known. Read-open per stream_configs_read/board_language_config_read
 * (20260813040000) — no auth required, matches every other student-facing
 * category read in this app.
 *
 * Returns loading:true until settled, INCLUDING the "no stream step applies"
 * case (Class 8-10, or a board with no seeded rows yet) — the caller uses
 * `loading` to hold the onboarding flow on the Board step until the step
 * list is known to be final, so a slow fetch can never let a student advance
 * past where the Stream step should have been inserted.
 */
export function useStreamConfig(boardKey, classLevel) {
  const [streamConfigs, setStreamConfigs] = useState([]);
  const [languageConfig, setLanguageConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tier = classTierFor(classLevel);
    if (!boardKey || !tier) {
      setStreamConfigs([]);
      setLanguageConfig(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: streams }, { data: lang }] = await Promise.all([
        supabase.from('stream_configs').select('*').eq('board_key', boardKey).eq('class_tier', tier).eq('is_active', true).order('sort_order'),
        supabase.from('board_language_config').select('*').eq('board_key', boardKey).eq('class_tier', tier).maybeSingle(),
      ]);
      if (cancelled) return;
      setStreamConfigs(streams ?? []);
      setLanguageConfig(lang ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [boardKey, classLevel]);

  return { streamConfigs, languageConfig, loading };
}
