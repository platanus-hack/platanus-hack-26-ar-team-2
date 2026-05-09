-- 0005_mandates_prompt.sql — separate prompt jsonb column on mandates
--
-- Why a dedicated column (not just nested in payload):
--   - mandates.payload      = legal/financial mandate (cap, bid range, targeting,
--                              brand_safety, always_bid_floor) — owned by the
--                              brand-human / legal team.
--   - mandates.prompt       = AI/prompting (system_persona, voice_examples,
--                              dont_say, dont_do) — owned by the brand-human's
--                              marketing/creative team.
-- Different stakeholders, different update cadence, different review process.
-- Keeping them separate makes audit + diffs cleaner.
--
-- Shape (validated in TS — see apps/web/src/lib/agents/types.ts → BrandPrompt):
--   {
--     "system_persona": "Sos el agent de adidas Argentina. Voz épica, deportiva, …",
--     "voice_examples": [
--       "Dale campeón, ese golazo merece adidas. Predator es para vos.",
--       "Sentilo: tu juego, nuestra energía."
--     ],
--     "dont_say": ["barato", "promo", "descuento"],
--     "dont_do": ["mencionar precios competidores", "tono formal/corporativo"]
--   }
--
-- Streamer mandates (type='streamer') leave prompt NULL — the streamer-agent's
-- voice is implicit in the creator's persona, not a separately-edited prompt.

alter table mandates
  add column if not exists prompt jsonb;

comment on column mandates.prompt is
  'AI prompting fields for brand mandates: system_persona, voice_examples, dont_say, dont_do. NULL for streamer mandates. See apps/web/src/lib/agents/types.ts BrandPrompt.';
