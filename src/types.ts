/**
 * Bindings available on the Worker (`c.env`).
 *
 * `vars` and secrets are configured in wrangler.jsonc, .dev.vars, and via
 * `wrangler secret put`. After changing bindings, run `npm run cf-typegen` to
 * regenerate worker-configuration.d.ts.
 */
export interface Env {
  // Static assets (the built Vite frontend). Wired up when we add the front end.
  ASSETS: Fetcher;

  // Public config (not secret).
  SUPABASE_URL: string;

  // Secrets.
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

/** Shared Hono environment so route modules get a typed `c.env`. */
export type AppEnv = { Bindings: Env };
