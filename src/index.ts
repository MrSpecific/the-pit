import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './types';
import { checkout } from './routes/checkout';
import { webhook } from './routes/webhook';

const app = new Hono<AppEnv>();

// Any uncaught throw (e.g. a client constructed with a missing secret) returns
// JSON rather than Hono's default plain-text 500 — so the browser can parse it
// and show something useful. The real error is logged (see `wrangler tail`).
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

// --- API surface -----------------------------------------------------------
const api = new Hono<AppEnv>();

// CORS is only needed while the frontend runs on a different origin (the Vite
// dev server). In production the SPA is served from this same Worker.
api.use('*', cors());

api.get('/health', (c) => c.json({ ok: true }));
api.route('/checkout', checkout);
api.route('/webhooks/stripe', webhook);

app.route('/api', api);

// --- Static frontend --------------------------------------------------------
// Real asset files (JS/CSS/images) are served directly by Cloudflare without
// invoking this Worker. Only non-asset paths reach here, so this handles
// client-side routes: `not_found_handling: "single-page-application"` returns
// index.html for them.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
