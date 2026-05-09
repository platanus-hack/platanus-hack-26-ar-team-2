-- 0003_ads.sql — Brand ad library
--
-- Each row is a pre-generated creative asset uploaded by a brand.
-- For the demo, rows are inserted by scripts/pregen-brand-ads.ts (D-10).
-- Schema matches DESIGN.md §5 "Modelo de datos ads".

create table ads (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references accounts(id) on delete cascade,
  variant_name   text not null,
  format         text not null check (format in (
                   'lower_third',
                   'top_banner',
                   'bottom_right_corner',
                   'side_panel',
                   'fullscreen_takeover',
                   'picture_in_picture'
                 )),
  asset_url      text not null,
  asset_type     text not null check (asset_type in ('video', 'image', 'gif')),
  duration_ms    int,
  has_baked_audio boolean not null default false,
  tracking_url   text not null,
  -- { games, languages, audiences }
  targeting      jsonb not null default '{}'::jsonb,
  -- e.g. ['high_energy', 'celebration']
  mood_tags      text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create index ads_brand_id_idx on ads(brand_id);
create index ads_format_idx   on ads(format);

alter table ads enable row level security;
