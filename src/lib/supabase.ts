import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types';

/**
 * Server-side Supabase client using the SERVICE ROLE key.
 *
 * This bypasses Row Level Security, so it must ONLY ever run inside the Worker
 * and must never be shipped to the browser. Use it for trusted writes — e.g.
 * marking an order paid after a verified Stripe webhook.
 *
 * The browser talks to Supabase directly with the *anon* key + RLS for reads
 * and realtime subscriptions; that path does not go through this client.
 *
 * Creating the client per request is cheap and the right pattern on Workers.
 */
export function getSupabaseAdmin(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
