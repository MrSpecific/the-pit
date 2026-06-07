-- ============================================================================
-- The Pit — RLS policies and Realtime setup.
--
-- Run this AFTER `prisma migrate deploy` has created the tables, via the
-- Supabase SQL Editor or:  psql "$DIRECT_URL" -f sql/rls_and_realtime.sql
--
-- The Worker writes with the service role key, which BYPASSES RLS, so trusted
-- server writes (creating a pending message, marking it paid) always work.
-- These policies govern the BROWSER (anon key via supabase-js + Realtime).
-- ============================================================================

-- 1. Row Level Security ------------------------------------------------------

alter table public.messages       enable row level security;
alter table public.webhook_events enable row level security;

-- Messages: anyone may read PAID, non-refunded messages. There is no public
-- insert/update; the only writer is the Worker (service role), so unpaid rows
-- stay invisible to the browser and to Realtime until the webhook marks them
-- paid — and refunded messages drop back out of view.
drop policy if exists "Paid messages are public" on public.messages;
create policy "Paid messages are public"
  on public.messages for select
  using (paid = true and refunded_at is null);

-- webhook_events: no policies => no browser access at all (service role only).

-- 2. Running total -----------------------------------------------------------
--    Total cents "fed to the pit". SECURITY INVOKER (the default) + the RLS
--    policy above mean this sums exactly the rows the caller can see — paid,
--    non-refunded — so the anon browser gets the correct public total safely.
create or replace function public.pit_total()
returns bigint
language sql
stable
as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.messages;
$$;

grant execute on function public.pit_total() to anon, authenticated;

-- 3. Realtime ----------------------------------------------------------------
--    Publish `messages` so the browser can subscribe to changes. The RLS
--    policy above still gates what each subscriber receives, so clients only
--    ever see a row once it flips to paid = true. `replica identity full`
--    ensures UPDATE payloads carry the full new row (needed for the policy
--    check and so the client gets name/message/amount on the paid update).

alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages;
