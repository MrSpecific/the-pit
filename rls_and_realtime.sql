-- ============================================================================
-- The Pit — auth wiring, triggers, RLS policies, and Realtime setup.
--
-- Run this AFTER `prisma migrate deploy` has created the tables, via the
-- Supabase SQL Editor or:  psql "$DIRECT_URL" -f sql/rls_and_realtime.sql
-- ============================================================================

-- 1. Link profiles to Supabase auth, and auto-create a profile per new user. --

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Keep orders.updated_at fresh. (Prisma's @updatedAt only applies to Prisma --
--    Client writes; we write via supabase-js, so enforce it in the DB.)        --

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- 3. Row Level Security ------------------------------------------------------
--    The Worker uses the service role key, which BYPASSES RLS, so trusted
--    server writes still work. These policies govern the browser
--    (anon / authenticated) via the Supabase JS client and Realtime.

alter table public.products       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.profiles       enable row level security;
alter table public.webhook_events enable row level security;

-- Products: anyone may read active products. No client writes.
create policy "Active products are public"
  on public.products for select
  using (active = true);

-- Profiles: a user can see and update only their own profile.
create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Orders: a user can read only their own orders. Writes happen server-side.
create policy "Users read own orders"
  on public.orders for select
  using (auth.uid() = user_id);

-- Order items: readable only via an owned order.
create policy "Users read own order items"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

-- webhook_events: no policies => no client access at all (service role only).

-- 4. Realtime ----------------------------------------------------------------
--    Add tables to the `supabase_realtime` publication so the client can
--    subscribe to changes. The RLS policies above still control what each
--    user actually receives. `replica identity full` ensures UPDATE/DELETE
--    payloads include the old row values.

alter table public.orders replica identity full;
alter publication supabase_realtime add table public.orders;

-- TODO: add your second realtime table here, e.g.
-- alter table public.<your_table> replica identity full;
-- alter publication supabase_realtime add table public.<your_table>;
