# The Pit

Pay whatever you want to drop a name and a message into the pit. Once the
payment clears, your message goes public and shows up live in everyone's feed.

Built on Cloudflare Workers, with Supabase for data + realtime and Stripe for
payments. TypeScript throughout.

This is the **backend**. The Vite frontend gets added later and builds into
`dist/client`, served by the same Worker.

There are no accounts — anyone can post, anonymously, by paying.

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
   (publishable key)      │  - Realtime on `messages`   │
                          └────────────────────────────┘
```

Two things worth holding onto:

- **Realtime never touches the Worker.** The browser subscribes to Supabase
  directly (publishable key + RLS). The Worker only handles payments and trusted writes.
- **The webhook is the source of truth for payment state.** The client is never
  trusted to say a payment happened; a message is created hidden (`paid = false`)
  and only the verified Stripe webhook flips it to `paid`, which is also the
  moment RLS lets it become public.

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
| Frontend       | React + Vite (TS), built into `dist/client`          |

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
cp .env.example .env            # Prisma DIRECT_URL + frontend VITE_* vars
cp .dev.vars.example .dev.vars  # local Worker secrets
```

Fill both in.

### 4. Create the schema

```bash
npm run db:push                 # prisma db push — sync schema, no migration files
# or, if you prefer tracked migrations:
npm run db:migrate              # prisma migrate dev
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

For full-stack local dev, run both (separate terminals):

```bash
npm run dev                     # Worker (API + built assets) on :8787
npm run dev:client              # Vite dev server (HMR) on :5173, proxies /api → :8787
```

Develop the UI against `http://localhost:5173`; `/api/*` calls are proxied to
the Worker. Sanity check the Worker directly: `GET localhost:8787/api/health`
→ `{ "ok": true }`.

For a production-like check, `npm run build` then `npm run dev` serves the
built SPA from the Worker itself. `npm run deploy` builds the client and ships
the Worker in one step.

## Project layout

```
the-pit/
├── wrangler.jsonc              Worker config, bindings, static assets
├── vite.config.ts              Vite config (client → dist/client, /api proxy)
├── prisma.config.ts            Prisma CLI config (schema path, migrations, DB url)
├── prisma/schema.prisma        Schema (source of truth for migrations)
├── sql/rls_and_realtime.sql    RLS policies + realtime publication
├── src/                        Worker (Hono API)
│   ├── index.ts                Hono app: API routes + SPA asset fallback
│   ├── types.ts                Env bindings + Hono env type
│   ├── lib/
│   │   ├── supabase.ts         Service-role client (server-only, bypasses RLS)
│   │   └── stripe.ts           Stripe client + WebCrypto webhook provider
│   └── routes/
│       ├── checkout.ts         POST /api/checkout — create message + pay
│       └── webhook.ts          POST /api/webhooks/stripe — publish on paid
├── client/                     Frontend (React + Vite, unstyled scaffold)
│   ├── index.html
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx            React entry
│       ├── App.tsx             Submit form + live feed
│       ├── lib/supabase.ts     Browser client (publishable key + RLS)
│       └── types.ts            Shared message shape
└── dist/client/                Vite build output (served by the Worker)
```

## Notes

- **Prisma is schema-only (v7).** `@prisma/client` is intentionally not
  installed and the schema has no `generator` block; all runtime DB access is
  via `supabase-js`. CLI config lives in `prisma.config.ts`, which loads `.env`
  via `dotenv` (Prisma 7 no longer auto-loads it) and points migrations at
  `DIRECT_URL`.
- **Stripe on Workers:** signatures are verified with `constructEventAsync` and
  a SubtleCrypto provider because the runtime has no Node `crypto`; the webhook
  reads the raw request body.
- **Realtime:** `messages` is published for realtime, but RLS still gates it —
  subscribers only ever receive a row once it flips to `paid = true`, i.e. the
  instant the webhook confirms payment.
- **Pay-what-you-want bounds:** the amount is validated server-side in
  `src/routes/checkout.ts` ($1.00–$10,000 by default); Stripe rejects charges
  under ~$0.50.

## Data model

A single public-facing table, `messages`:

| column              | notes                                              |
| ------------------- | -------------------------------------------------- |
| `name`, `message`   | what the poster submitted (≤ 80 / ≤ 500 chars)     |
| `amount_cents`      | what they actually paid (from Stripe `amount_total`) |
| `paid`, `paid_at`   | `paid` flips true on the webhook; RLS keys off it  |
| `created_at`        | when checkout started                              |
| `stripe_session_id` | for reconciliation                                 |

`webhook_events` is an idempotency ledger so redelivered Stripe events are no-ops.

## Next

Frontend: a Vite SPA with a "drop a message" form (name + message + amount →
`/api/checkout`) and a live feed that subscribes to Supabase Realtime on
`messages`.
