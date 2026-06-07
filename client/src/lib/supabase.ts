import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Browser Supabase client: publishable key + RLS. Safe to ship to the browser
// — RLS only ever exposes paid messages (see sql/rls_and_realtime.sql). All
// writes happen server-side through the Worker, never from here.
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Treat the .env.example placeholders as "not configured" so the app still
// renders (handy while styling) — the live feed just stays empty until real
// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are set.
const configured = Boolean(
  url && publishableKey && !url.includes('YOUR-PROJECT-REF'),
);

export const supabase: SupabaseClient | null = configured
  ? createClient(url, publishableKey)
  : null;

if (!configured) {
  console.warn(
    '[the-pit] Supabase is not configured — set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY in .env to enable the live feed.',
  );
}
