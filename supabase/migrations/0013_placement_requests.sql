-- 0013_placement_requests.sql — approval queue para placements (Franco, 2026-05-09)
--
-- Cambio de approach: el worker ya no inserta directo en render_events. En lugar
-- de "pickear → mostrar en OBS", ahora "pickear → mostrar pedido en Dock →
-- creator aprueba → recién ahí render_event y (futuro) pago on-chain".
--
-- Flujo:
--   1. Worker picker matchea brand → INSERT placement_requests (status=pending)
--   2. Trigger pg_notify('placement_requests_new', ...) → worker SSE → Dock UI
--   3. Creator aprueba en Dock → POST /api/placements/[id]/approve
--      a. UPDATE status='approved' WHERE status='pending' (atómico, idempotente)
--      b. INSERT render_events + pg_notify('render_events', ...) → OBS
--      c. UPDATE placement_requests.render_event_id (UNIQUE → no double-render)
--   4. Futuro on-chain (C-12+): placement_requests.id como nonce/idempotency key
--      contra el escrow contract — segundo lockEscrow(id) revierte.
--
-- Garantías:
--   - existencia del anuncio: message NOT NULL, FK a context_chunks (no requests
--     huérfanos). Worker solo inserta si pick.brand_id != null && message !=
--     '...' (existencia semántica del ad).
--   - idempotencia request: unique(chunk_id, brand_id) — no se duplica el mismo
--     pedido aunque el LISTEN se dispare dos veces.
--   - idempotencia approval: transición atómica con WHERE status='pending'.
--     Segundo approve no actualiza nada (RETURNING vacío → 409).
--   - idempotencia render: render_event_id UNIQUE — 1 render por request.

create table placement_requests (
  id uuid primary key default gen_random_uuid(),

  creator_id text not null,
  brand_id text not null,
  brand_display_name text not null,

  -- chunk_id es el origen del match (auditoría). FK con ON DELETE SET NULL para
  -- no romper requests si se hace cleanup de chunks viejos.
  chunk_id uuid references context_chunks(id) on delete set null,

  -- El "ad" mínimo que se va a mostrar si se aprueba. NOT NULL — si el picker no
  -- devolvió un message útil, el worker no debería crear el request.
  message text not null,

  -- Asset opcional. Si NULL, el OBS muestra el message como texto (matebros caso).
  payload jsonb,

  bid_usdc numeric(10, 4) not null,
  reason text,
  brand_match numeric(3, 2),
  moment_quality numeric(3, 2),

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired')),

  created_at timestamptz not null default now(),
  -- TTL: si nadie aprueba en 120s, el momento ya pasó. Cron futuro marca
  -- expired. Para el demo lo evaluamos en el approve endpoint.
  expires_at timestamptz not null default (now() + interval '120 seconds'),
  decided_at timestamptz,
  decided_by text,

  -- Idempotencia render: cuando aprobamos, insertamos en render_events y
  -- guardamos su id acá. UNIQUE → un mismo request no puede generar dos renders.
  render_event_id uuid unique,

  -- Idempotencia request: el worker no puede emitir dos requests para el mismo
  -- chunk+brand aunque LISTEN dispare dos veces (race window).
  unique(chunk_id, brand_id)
);

-- Hot path: Dock query "pending requests for creator X" + SSE catch-up.
create index placement_requests_creator_status_idx
  on placement_requests(creator_id, status, created_at desc);

-- pg_notify trigger — el worker LISTEN placement_requests_new y broadcast SSE
-- al Dock. Payload format: <creator_id>:<id>:<json> (mismo patrón que
-- render_events para que el cliente parsee igual).
create or replace function notify_placement_request_new()
returns trigger as $$
begin
  perform pg_notify(
    'placement_requests_new',
    new.creator_id || ':' || new.id::text || ':' || row_to_json(new)::text
  );
  return new;
end;
$$ language plpgsql;

create trigger placement_requests_new_notify
  after insert on placement_requests
  for each row execute function notify_placement_request_new();

-- Trigger en UPDATE de status — el Dock necesita saber cuándo un request se
-- aprueba/rechaza/expira para sacarlo de la lista de pending. Mismo channel
-- distinto event-type implícito (el cliente filtra por status).
create or replace function notify_placement_request_status()
returns trigger as $$
begin
  if new.status is distinct from old.status then
    perform pg_notify(
      'placement_requests_status',
      new.creator_id || ':' || new.id::text || ':' || new.status
    );
  end if;
  return new;
end;
$$ language plpgsql;

create trigger placement_requests_status_notify
  after update on placement_requests
  for each row execute function notify_placement_request_status();

comment on table placement_requests is
  'Approval queue. Producer: worker tick (worker/src/tick.ts). Consumer: Dock UI via worker SSE /requests/:creator_id. Approve: POST /api/placements/[id]/approve (apps/web).';
comment on column placement_requests.render_event_id is
  'UNIQUE → garantiza 1 render_event por request. Set en la misma tx que UPDATE status=approved.';
comment on column placement_requests.bid_usdc is
  'Bid propuesto por el picker (lerp entre min_bid/max_bid del YAML usando brand_match). Para C-12 on-chain: este es el monto exacto del lockEscrow.';
