-- 0012_render_events_offer.sql — pre-approval flow para placements.
-- Lucas, 2026-05-09.
--
-- Hasta 0011 el manager-tick hacía INSERT directo de kind='brand' → SSE →
-- overlay. El streamer no podía aceptar/rechazar antes que saliera al aire.
--
-- Con esta migration el flow es:
--   1. agent → INSERT kind='offer' status='pending' bid_usdc_cents=N
--   2. dock muestra card con countdown (default TTL 8s, configurable)
--   3. streamer ✅ → endpoint UPDATE offer status='accepted' + INSERT kind='brand'
--                    (esa nueva row es la que el overlay consume vía SSE)
--   4. streamer ❌ → endpoint UPDATE offer status='rejected'
--   5. timeout sin acción → endpoint marca status='expired' on demand
--
-- Soporta multiples offers pendientes simultáneas — cada una con su propia
-- card en el dock y su propio TTL. Se aceptan/rechazan independientemente.

alter table render_events
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  add column if not exists responded_at timestamptz,
  add column if not exists bid_usdc_cents int;

comment on column render_events.status is
  'Solo aplica a kind=offer. pending=esperando streamer, accepted=streamer dijo OK (una row kind=brand derivada se emitió), rejected=streamer dijo NO, expired=TTL vencido sin acción. Para kind=brand|render|raw siempre queda en default pending — no se usa.';

comment on column render_events.responded_at is
  'Solo offers. Cuándo el streamer respondió (accepted/rejected) o cuándo el endpoint marcó expired.';

comment on column render_events.bid_usdc_cents is
  'Bid del agent en cents USDC. El agent lo elige dentro de [brand.min_bid_usdc, brand.max_bid_usdc] según brand_match score. Cuando se accept un offer, la row kind=brand derivada copia este valor.';

-- Index para el dock query "offers pendientes de mi creator, ordenadas por más reciente".
create index if not exists render_events_creator_pending_offers_idx
  on render_events (creator_id, created_at desc)
  where kind = 'offer' and status = 'pending';

-- Index complementario para cooldown lookup del manager (último accepted brand event).
create index if not exists render_events_creator_kind_brand_idx
  on render_events (creator_id, created_at desc)
  where kind = 'brand';
