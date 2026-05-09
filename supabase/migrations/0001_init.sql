-- 0001_init.sql — Addie initial schema
--
-- Tables: accounts, streams, mandates.
-- Subsequent migrations layer on:
--   0002_inventory.sql  (zonas + floors + max_duration por creator)
--   0003_ads.sql        (biblioteca de ads por brand — DESIGN.md §5)
--   0004_placements.sql (placements + audit fields — DESIGN.md §5)
--
-- Conventions:
--   - PKs are uuid v4 via gen_random_uuid (pgcrypto).
--   - Timestamps in UTC (timestamptz, default now()).
--   - JSONB for shape-evolving fields (mandates.payload).
--     The TypeScript shape lives in apps/web/src/lib/agents/types.ts
--     and is the source of truth — DB only validates required keys here.
--   - RLS is enabled but policies are scaffolded later alongside auth.

create extension if not exists "pgcrypto";

-- ─── accounts ────────────────────────────────────────────────────────
-- Wallet-bearing entity. One row per Privy smart wallet (ERC-4337) on Base.
-- Three types in MVP: brand (8x), creator (1x demo creator), platform (1x escrow owner).
create table accounts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('brand', 'creator', 'platform')),
  display_name text not null,
  -- Privy smart wallet address on Base. Set after seed-wallets.ts (A-05).
  -- Nullable for accounts created before wallet provisioning.
  wallet_address text,
  -- Open-ended kit:
  --   brand: { color, voice, logo_url, tracking_url, region }
  --   creator: { twitch_channel, language, demo_persona }
  --   platform: { network: 'base-mainnet', chain_id: 8453 }
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Address must be globally unique once assigned.
create unique index accounts_wallet_address_unique
  on accounts(wallet_address)
  where wallet_address is not null;

create index accounts_type_idx on accounts(type);

-- ─── streams ─────────────────────────────────────────────────────────
-- A creator's live session. Bookended by nginx-rtmp on_publish /
-- on_publish_done webhooks (B-03 / B-12). At most one 'live' row
-- per creator at a time (enforced by partial unique index below).
create table streams (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references accounts(id) on delete restrict,
  twitch_channel text,
  status text not null check (status in ('live', 'ended')) default 'live',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index streams_one_live_per_creator_idx
  on streams(creator_id)
  where status = 'live';

create index streams_status_started_at_idx
  on streams(status, started_at desc);

-- ─── mandates ────────────────────────────────────────────────────────
-- Signed autonomy boundary for an agent. One active mandate per account
-- at a time; older ones are soft-revoked (revoked_at set) for audit.
--
-- payload shape (validated in TS):
--   brand:    BrandMandate    (daily_cap_usdc, min/max_bid_usdc, targeting,
--                              brand_safety, ad library reference, …)
--   streamer: StreamerMandate (hard_floor_usdc, blocked_keywords,
--                              preferred_brands, …)
-- See apps/web/src/lib/agents/types.ts.
--
-- signature: MVP uses 'mvp:dummy:<account_id>'. Post-MVP §14 swaps for
-- real EIP-712 onchain.
create table mandates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  type text not null check (type in ('brand', 'streamer')),
  payload jsonb not null,
  signed_at timestamptz not null default now(),
  signature text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- A given account has at most ONE active (non-revoked) mandate at a time.
create unique index mandates_one_active_per_account_idx
  on mandates(account_id)
  where revoked_at is null;

create index mandates_type_idx on mandates(type);
create index mandates_account_id_idx on mandates(account_id);

-- ─── RLS scaffolding ─────────────────────────────────────────────────
-- Tables RLS-enabled but no policies yet — server-side service role
-- bypasses RLS. End-user policies wired alongside auth setup in a later
-- migration (out of scope for P0-04).
alter table accounts enable row level security;
alter table streams enable row level security;
alter table mandates enable row level security;
