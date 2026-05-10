-- 0012_context_chunks_processing_lock.sql — atomic concurrency for managerTick (Franco, 2026-05-09)
--
-- Problema: managerTick() leía la última row de context_chunks con un SELECT
-- y deduplicaba post-hoc consultando render_events. Race window real entre
-- ticks que corren cada 5s: tick #1 lee chunk → llama LLM (2-5s) → recién
-- ahí escribe render_event. Tick #2 (5s después) ve el mismo chunk como
-- "no procesado" → ambos llaman al LLM y ambos emiten brand event +
-- (futuro C-12) ambos disparan settlement on-chain. Doble publicación,
-- doble pago.
--
-- Fix: claim atómico al chunk vía `FOR UPDATE SKIP LOCKED` + columna
-- `processed_at` como estado terminal. El tick entero corre en una
-- transacción (BEGIN..COMMIT en tick.ts) — si crashea a mitad, todo
-- rollback (claim, render_events, pg_notify). Si COMMIT exitoso, no hay
-- forma de que otro tick agarre la misma row porque processed_at IS NOT NULL.
--
-- TTL `processing_locked_until` es defensa secundaria por si la tx queda
-- colgada (network blip que no rompe la conexión, idle-in-transaction).
-- Default 14s vía MANAGER_CHUNK_LOCK_TTL_S — calibrado para quedar por
-- debajo de los 15s del chunkWriter (CHUNK_INTERVAL_MS) → el lock nunca
-- solapa dos chunks consecutivos. El tick lo setea adentro de la tx; si
-- la tx commitea, el `processed_at = now()` deja la row como terminal.
-- Si la tx rollbackea, locked_until también rollbackea (queda NULL).
--
-- Pagos on-chain (C-12): cuando lande, el broadcast a Base va a vivir
-- AFUERA de esta tx (el RPC call no es transaccional). Idempotency
-- adicional ahí: usar `render_events.id` (event_id) como nonce/idempotency
-- key contra el escrow contract — si llamás `lockEscrow(event_id)` dos
-- veces, la segunda revierte. NO confiar solo en este chunk-lock para
-- pagos.
--
-- Backfill: marcamos todas las rows existentes como processed_at = now()
-- para que el manager nuevo NO re-procese chunks viejos al primer arranque.
-- Las rows pre-migration ya tuvieron su render_event vía el dedup viejo.

ALTER TABLE context_chunks
  ADD COLUMN IF NOT EXISTS processing_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

COMMENT ON COLUMN context_chunks.processing_locked_until IS
  'Si NOT NULL y > now(), un manager tick está procesando esta row dentro de una tx abierta (defensa secundaria al FOR UPDATE row-lock). TTL configurable via MANAGER_CHUNK_LOCK_TTL_S (default 14s, < 15s chunk cadence). Rollback de la tx revierte esto a NULL.';
COMMENT ON COLUMN context_chunks.processed_at IS
  'Terminal state. Si NOT NULL, el tick que ganó el claim ya commiteó el render_event. El claim-query filtra processed_at IS NULL. Set en la misma tx que los INSERT en render_events para garantizar atomicidad publicación⇄terminal.';

-- Backfill: rows pre-migration ya rindieron sus render_events vía el dedup
-- viejo. Marcarlas processed para que el manager nuevo no las re-procese
-- al arrancar.
UPDATE context_chunks
   SET processed_at = COALESCE(processed_at, now())
 WHERE processed_at IS NULL;

-- Index parcial para el claim-query: latest unprocessed por stream.
-- Cubre el ORDER BY ts_start DESC + filtro stream_key.
CREATE INDEX IF NOT EXISTS context_chunks_claim_idx
  ON context_chunks (stream_key, ts_start DESC)
  WHERE processed_at IS NULL;
