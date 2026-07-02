-- Phase 91 — MARK-04 — orders table for Lemon Squeezy webhook persistence.
-- Per CONTEXT.md D-11. Apply via M-prerequisite M4 (npx supabase db push OR Supabase Web UI SQL Editor).

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  lemon_squeezy_event_id text not null unique,
  lemon_squeezy_order_id text not null,
  lemon_squeezy_customer_id text not null,
  lemon_squeezy_variant_id text not null,
  buyer_email text not null,
  subscription_tier text not null check (subscription_tier in ('starter', 'pro', 'cloud_sync')),
  license_key text not null unique,
  total_usd_cents integer not null,
  tax_usd_cents integer not null default 0,
  event_type text not null check (event_type in ('order_created', 'subscription_created')),
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);

create index orders_buyer_email_idx on public.orders (buyer_email);

-- RLS: webhook uses service-role key so RLS does not block inserts;
-- Phase 92 will add a SELECT policy `auth.uid() = user_id` once user-orders linkage exists.
alter table public.orders enable row level security;
