import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Is the CURRENTLY LOGGED-IN STUDENT SESSION's Firebase uid also a
 * superadmin? — 2026-08-14, built for the ₹1 verification plan's
 * visibility gate (PricingPage.jsx). Distinct from the separate admin-panel
 * passcode session (sessionStorage edu_admin_rec_*) — a student-facing page
 * has no access to that and shouldn't need it; admins.uid === users.firebase_uid
 * for both current superadmins, so checking the student session's own uid
 * against `admins` directly is correct and minimal (is_active_superadmin RPC).
 *
 * Defaults to false while loading and on any error — same "never show the
 * gated thing before the check genuinely confirms true" rule as
 * usePaymentsEnabled/paymentsClosed. A flicker-to-true would be the actual
 * bug this pattern exists to prevent, not a false negative.
 */
export function useIsSuperadmin(uid) {
  const [value, setValue] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!uid) { setValue(false); setLoading(false); return undefined; }

    setLoading(true);
    supabase.rpc('is_active_superadmin', { p_uid: uid })
      .then(({ data, error }) => {
        if (cancelled) return;
        setValue(!error && data === true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [uid]);

  return { isSuperadmin: value, loading };
}
