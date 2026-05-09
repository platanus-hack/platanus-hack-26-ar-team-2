-- 0004_placements.sql — Ad placements with full audit trail
--
-- One row per won auction. Created at settlement (C-12), enriched async
-- by the audit clip pipeline (B-09..B-11) and the agent reasoning logger (C-16).
-- Schema matches DESIGN.md §5 "Modelo de datos placements".

create table placements (
  id           uuid primary key default gen_random_uuid(),
  stream_id    uuid not null references streams(id) on delete restrict,
  brand_id     uuid not null references accounts(id) on delete restrict,
  ad_id        uuid not null references ads(id) on delete restrict,
  zone         text not null,
  amount_usdc_cents int not null check (amount_usdc_cents > 0),
  duration_ms  int not null check (duration_ms > 0),
  rendered_at  timestamptz,

  -- ── Audit fields ─────────────────────────────────────────────────────
  -- 30s composed mp4 in Vercel Blob (uploaded by B-11)
  clip_url             text,
  -- What the brand-agent saw when it decided to bid
  context_snapshot     jsonb,
  -- Full LLM output: { should_bid, ad_id, bid_usdc_cents, zone, opening_message, reasoning }
  agent_reasoning      jsonb,
  -- All negotiation turns in Spanish between brand-agent and streamer-agent
  negotiation_transcript jsonb,
  -- The winning offer that settled the auction
  winning_offer        jsonb,

  -- ── On-chain refs ─────────────────────────────────────────────────────
  lock_tx_hash         text,
  release_tx_hash      text,
  refund_tx_hash       text,

  -- ── QR metrics ───────────────────────────────────────────────────────
  qr_scans             int not null default 0,

  status       text not null check (status in ('locked', 'rendered', 'refunded', 'failed')),
  created_at   timestamptz not null default now()
);

create index placements_stream_id_idx  on placements(stream_id);
create index placements_brand_id_idx   on placements(brand_id);
create index placements_status_idx     on placements(status);
create index placements_created_at_idx on placements(created_at desc);

alter table placements enable row level security;
