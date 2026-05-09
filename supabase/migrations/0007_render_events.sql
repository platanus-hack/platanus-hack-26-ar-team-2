-- 0007_render_events.sql — render-events queue for the iframe overlay channel
--
-- Source-of-truth for "show this thing on creator X's overlay iframe right now."
-- POST /api/creators/[creator_id]/render writes here + NOTIFY.
-- GET /api/creators/[creator_id]/stream LISTENs and pushes via SSE.
-- See DESIGN.md §4 "Event broadcast pattern".
--
-- MVP shape: just a `message` text field. Later iterations add:
--   asset_url text, asset_type text check (asset_type in ('video','image','iframe')),
--   duration_ms int, zone text, expires_at timestamptz
-- when the auction layer (C-14) starts shipping real ad placements.

create table render_events (
  id uuid primary key default gen_random_uuid(),
  -- creator_id stored as text for MVP — works with arbitrary slugs in tests
  -- (e.g. 'team-stream'). Migrates to FK on accounts(id) when seed-wallets (A-05)
  -- populates the creators table.
  creator_id text not null,
  -- MVP: pure text message. Future: replaced/extended by structured ad payload.
  message text not null,
  created_at timestamptz not null default now(),
  -- Set by the SSE handler when the event was pushed to a connected iframe.
  -- Null = pending. Useful for debugging "did it actually deliver" + replay
  -- on iframe reconnect (only undelivered events on catch-up).
  delivered_at timestamptz
);

-- Per-creator query is the hot path (catch-up replay + audit).
create index render_events_creator_created_idx
  on render_events(creator_id, created_at desc);

-- Used by the SSE catch-up logic ("show me undelivered events for this creator").
create index render_events_pending_idx
  on render_events(creator_id, created_at)
  where delivered_at is null;

comment on table render_events is
  'Queue of overlay-render events. Producer: POST /api/creators/[id]/render. Consumer: SSE stream /api/creators/[id]/stream. See DESIGN.md §4 event broadcast.';
