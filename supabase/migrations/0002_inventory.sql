-- 0002_inventory.sql — Creator inventory: zones, floors, and max durations
--
-- One row per (creator_account, zone). Populated by scripts/seed-inventory.ts (C-07)
-- and editable via the Inventory editor UI (D-04).
--
-- Zones match the set defined in DESIGN.md §4:
--   lower_third | bottom_right_corner | fullscreen_takeover

create table inventory (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references accounts(id) on delete cascade,
  zone         text not null check (zone in ('lower_third', 'bottom_right_corner', 'fullscreen_takeover')),
  floor_usdc_cents int not null check (floor_usdc_cents >= 0),
  max_duration_ms  int not null check (max_duration_ms > 0),
  -- fullscreen_takeover is manual-only (hotkey FULL BREAK), not auctioned automatically
  manual_only  boolean not null default false,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (creator_id, zone)
);

create index inventory_creator_id_idx on inventory(creator_id);

alter table inventory enable row level security;
