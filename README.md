# The Pit

A small payment-accepting app on Cloudflare Workers, with Supabase for data +
realtime and Stripe for payments. TypeScript throughout.

This is the **backend scaffold**. The Vite frontend gets added later and builds
into `dist/client`, served by the same Worker.

## Architecture

```
                         ┌────────────────────────────┐
   browser  ─────────────▶  Cloudflare Worker (Hono)   │
   (SPA)    static assets │  - serves the SPA           │
            + /api calls  │  - POST /api/checkout       │──▶ Stripe API
                          │  - POST /api/webhooks/stripe│◀── Stripe webhooks
                          └──────────────┬──────────────┘
                                         │ service-role key (bypasses RLS)
                                         ▼
                          ┌────────────────────────────┐
   browser  ─────────────▶  Supabase (Postgres)        │
   realtime + reads       │  - RLS-guarded reads        │
   (anon key, direct)     │  - Realtime on `orders`     │
                          └────────────────────────────┘
```

Two things worth holding onto:

- **Realtime never touches the Worker.** The browser subscribes to Supabase
  directly (anon key + RLS). The Worker only handles payments and trusted writes.
- **The webhook is the source of truth for payment state.** The client is never
  trusted to say an order was paid; only the verified Stripe webhook flips an
  order to `paid`.

## Stack

| Concern        | Choice                                                |
| -------------- | ----------------------------------------------------- |
| Compute        | Cloudflare Workers + Hono                             |
| Static hosting | Workers static assets (`dist/client`)                |
| Database       | Supabase (Postgres)                                  |
| DB queries     | `@supabase/supabase-js` (PostgREST)                  |
| Schema         | Prisma (migrations only — no runtime client)         |
| Realtime       | Supabase Realtime (client subscribes directly)       |
| Payments       | Stripe (hosted Checkout + webhooks)                  |

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

Grab from the dashboard:
- Project URL → put in `wrangler.jsonc` under `vars.SUPABASE_URL`
- `service_role` key → goes in `.dev.vars` (local) and `wrangler secret` (prod)
- Database connection strings (Settings → Database → ORM tab) → `.env`

### 3. Configure env files

```bash
cp .env.example .env            # Prisma connection strings
cp .dev.vars.example .dev.vars  # local Worker secrets
```

Fill both in.

### 4. Migrate the schema

```bash
npm run db:migrate              # prisma migrate dev --skip-generate
```

Then apply RLS, triggers, and realtime (Supabase SQL Editor, or psql):

```bash
psql "$DIRECT_URL" -f sql/rls_and_realtime.sql
```

### 5. Set production secrets

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

### 6. Wire up Stripe

- Add an endpoint in the Stripe dashboard pointing at
  `https://<your-worker>/api/webhooks/stripe`, subscribed to at least
  `checkout.session.completed` and `checkout.session.expired`.
- For local testing, forward events with the Stripe CLI:

```bash
stripe listen --forward-to localhost:8787/api/webhooks/stripe
```

The CLI prints a `whsec_...` signing secret — use that as your local
`STRIPE_WEBHOOK_SECRET`.

### 7. Run it

```bash
npm run dev                     # wrangler dev on http://localhost:8787
```

Sanity check: `GET /api/health` → `{ "ok": true }`.

## Project layout

```
the-pit/
├── wrangler.jsonc              Worker config, bindings, static assets
├── prisma/schema.prisma        Schema (source of truth for migrations)
├── sql/rls_and_realtime.sql    RLS policies, auth trigger, realtime publication
├── src/
│   ├── index.ts                Hono app: API routes + SPA asset fallback
│   ├── types.ts                Env bindings + Hono env type
│   ├── lib/
│   │   ├── supabase.ts         Service-role client (server-only, bypasses RLS)
│   │   └── stripe.ts           Stripe client + WebCrypto webhook provider
│   └── routes/
│       ├── checkout.ts         POST /api/checkout
│       └── webhook.ts          POST /api/webhooks/stripe
└── dist/client/                Vite build output (placeholder for now)
```

## Notes

- **Prisma is schema-only.** `@prisma/client` is intentionally not installed;
  all runtime DB access is via `supabase-js`. Migrations run with
  `--skip-generate`.
- **Stripe on Workers:** signatures are verified with `constructEventAsync` and
  a SubtleCrypto provider because the runtime has no Node `crypto`; the webhook
  reads the raw request body.
- **Realtime:** `orders` is published for realtime. Add your second table in
  `sql/rls_and_realtime.sql` (marked with a TODO).
- The product/order schema is a sensible starting point — reshape the models in
  `prisma/schema.prisma` to fit what The Pit actually sells.

## Next

Frontend: a Vite SPA that subscribes to Supabase Realtime for live order status
and calls `/api/checkout` to start payment.
