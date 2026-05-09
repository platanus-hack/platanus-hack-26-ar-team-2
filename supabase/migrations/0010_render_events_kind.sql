-- 0010_render_events_kind.sql — distinguish raw debug emits from brand placements.
--
-- The cron manager (C-08m-cron) now emits a `raw_chunk` row every tick (every
-- 5s) so the iframe at `/o/<id>` sees the full Supabase chunk content as a
-- live debug feed. Brand placements (Stage1+Stage2 winners) are separate.
--
-- Cooldown logic queries the latest `kind='brand'` row to anchor the 30s
-- anti-spam window — without the column filter, every 5s raw emit would
-- block all brand emits permanently.

alter table render_events add column if not exists kind text not null default 'render';

-- Backfill existing rows already default to 'render' from the column default.
-- Index for the cooldown lookup (latest brand emit per creator).
create index if not exists render_events_creator_kind_created_idx
  on render_events(creator_id, kind, created_at desc);

comment on column render_events.kind is
  'render = generic event from POST /api/creators/[id]/render (default, backward compat). raw = full Supabase chunk dump from manager-tick (firehose, no gating). brand = brand placement from Stage1+Stage2 winner (gated by cooldown).';
