import { createClient } from '@supabase/supabase-js';

// Browser Supabase client: anon key + RLS. Safe to ship to the browser — RLS
// only ever exposes paid messages (see sql/rls_and_realtime.sql). All writes
// happen server-side through the Worker, never from here.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example.',
  );
}

export const supabase = createClient(url, anonKey);
