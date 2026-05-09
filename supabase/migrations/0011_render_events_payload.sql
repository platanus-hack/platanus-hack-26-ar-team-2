-- 0011_render_events_payload.sql — payload jsonb en render_events (D-02)
-- Lucas, 2026-05-09
--
-- Hasta 0010 el endpoint POST /api/creators/[id]/render solo persistía
-- `message text` en la fila. Los campos del placement (zone_id, asset_url,
-- qr_url, position, brand_id, etc) viajaban SOLO via pg_notify payload, sin
-- snapshot en DB.
--
-- Bug: si el iframe del creator se reconecta (browser de OBS pierde la SSE,
-- network blip), el catch-up `select ... from render_events where created_at > since`
-- recupera message + kind PERO NO los campos del placement → el ad que estaba
-- sonando se "pierde" para los reconnects, queda como text vacío en pantalla.
--
-- Fix: columna `payload jsonb` que guarda el body completo del POST. SSE
-- catch-up devuelve esto y el OverlayClient renderiza el ad con todos los
-- datos (asset_url, qr_url, zone_id, position, etc) intactos.

alter table render_events
  add column if not exists payload jsonb;

comment on column render_events.payload is
  'Body completo del POST /api/creators/[id]/render serializado a JSON. Campos: zone_id, asset_url, asset_type, qr_url, duration_ms, max_duration_ms, position, audio, brand_id. Permite que catch-up post-reconexión SSE recupere placements visuales completos, no solo el text del message.';

-- Index opcional sobre kind para acelerar las queries del manager-tick
-- (cooldown lookup filtra por kind='brand'). Idempotente.
create index if not exists render_events_creator_kind_idx
  on render_events (creator_id, kind, created_at desc);
