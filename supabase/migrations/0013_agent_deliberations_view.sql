-- 0013_agent_deliberations_view.sql — vista de deliberación por tick (C-08m-multiagent, Franco 2026-05-09).
--
-- Contexto: post-C-08m-multiagent cada tick del manager-tick emite ~N+2
-- render_events asociados (1 raw firehose + N brand_thoughts en paralelo
-- + 1 offer ganador). Todos llevan `payload->>'deliberation_id'` (UUID) y
-- mismo `creator_id` para correlación.
--
-- Esta vista colapsa toda esa cadena en UNA row por deliberation_id, con
-- sub-arrays JSON de los thoughts y la offer ganadora. Útil para:
--   - audit post-demo: "qué decidió cada brand-agent en el chunk X?"
--   - replay UI: armar un timeline de la deliberación sin N round-trips.
--   - métricas: % chunks con ≥1 interested, latency p50 por brand-agent, etc.
--
-- No materialized — render_events es low-volume (≤ 1k rows/día en MVP) y
-- la query es indexable por (creator_id, created_at). Si crece, materializar
-- con refresh on COMMIT trigger.

create or replace view agent_deliberations as
with raw as (
  select
    re.creator_id,
    re.payload->>'deliberation_id' as deliberation_id,
    re.id            as event_id,
    re.created_at,
    re.payload
  from render_events re
  where re.kind = 'raw'
    and re.payload ? 'deliberation_id'
),
thoughts as (
  select
    re.payload->>'deliberation_id' as deliberation_id,
    jsonb_agg(
      jsonb_build_object(
        'event_id', re.id,
        'created_at', re.created_at,
        'brand_id', re.payload->>'brand_id',
        'brand_label', re.payload->>'brand_label',
        'interested', (re.payload->>'interested')::boolean,
        'score', (re.payload->>'score')::numeric,
        'bid_usdc', nullif(re.payload->>'bid_usdc', '')::numeric,
        'pitch', re.payload->>'pitch',
        'reasoning', re.payload->>'reasoning',
        'latency_ms', (re.payload->>'latency_ms')::int,
        'error', re.payload->>'error'
      )
      order by re.created_at
    ) as thoughts
  from render_events re
  where re.kind = 'brand_thought'
    and re.payload ? 'deliberation_id'
  group by re.payload->>'deliberation_id'
),
offer as (
  select
    re.payload->>'deliberation_id' as deliberation_id,
    re.id           as offer_event_id,
    re.created_at   as offer_created_at,
    re.status       as offer_status,
    re.message      as offer_message,
    re.bid_usdc_cents,
    re.payload      as offer_payload
  from render_events re
  where re.kind = 'offer'
    and re.payload ? 'deliberation_id'
)
select
  raw.deliberation_id,
  raw.creator_id,
  raw.created_at as started_at,
  raw.event_id   as raw_event_id,
  raw.payload->'chunk'->>'id'             as chunk_id,
  raw.payload->'chunk'->>'audio_summary'  as audio_summary,
  raw.payload->'chunk'->>'audio_intent'   as audio_intent,
  raw.payload->'chunk'->'audio_mentions'  as audio_mentions,
  coalesce(thoughts.thoughts, '[]'::jsonb) as thoughts,
  jsonb_array_length(coalesce(thoughts.thoughts, '[]'::jsonb)) as thought_count,
  offer.offer_event_id,
  offer.offer_created_at,
  offer.offer_status,
  offer.offer_message,
  offer.bid_usdc_cents,
  offer.offer_payload->>'brand_id'     as winner_brand_id,
  offer.offer_payload->>'brand_label'  as winner_brand_label,
  (offer.offer_payload->>'brand_match')::numeric as winner_score,
  (offer.offer_payload->>'moment_quality')::numeric as moment_quality
from raw
left join thoughts on thoughts.deliberation_id = raw.deliberation_id
left join offer    on offer.deliberation_id    = raw.deliberation_id;

comment on view agent_deliberations is
  'Una row por deliberación del manager-tick (C-08m-multiagent). Agrupa raw chunk + N brand_thoughts paralelos + offer ganador en JSON arrays. Key: payload->>deliberation_id en render_events.';
