/**
 * Smoke test for gate3 Haiku triage (C-08c).
 *
 * Ejercita la función `evaluateGate3()` directamente contra Claude Haiku
 * con 3 escenarios sintéticos cuya intención es clara — verificamos que
 * el LLM tome el call que esperamos:
 *
 *   case A · CafetITO + clutch épico (audio_intent=reaction, mood=clutch)
 *           → expected: should_proceed=true, confidence ≥ 0.6
 *   case B · CafetITO + late-night silence (audio_intent=silence, mood=idle)
 *           → expected: should_proceed=false, code='triage_should_not_bid'
 *   case C · MateBros + festejo grupal con mate (mention "mate", social)
 *           → expected: should_proceed=true, confidence ≥ 0.6
 *
 * Calibrado al PITCH (docs/PITCH.md) — CafetITO targetea clutchs/comebacks,
 * MateBros entra en momentos comunitarios.
 *
 * Falla si Haiku rompe alguna de las 3 expectativas. NO falla por
 * confidence: la idea es validar el direccional, no el exacto.
 *
 * Run: cd apps/web && pnpm smoke:gate3
 *      (requiere ANTHROPIC_API_KEY en .env.local)
 */

import { evaluateGate3 } from "../src/lib/agents/brand/gates/gate3Haiku.ts";
import type {
  BrandMandate,
  BrandPrompt,
  Gate1Context,
} from "../src/lib/agents/types.ts";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    "ANTHROPIC_API_KEY missing. Run with: node --env-file=.env.local --import tsx scripts/smoke-gate3.mts",
  );
  process.exit(1);
}

const cafetitoMandate: BrandMandate = {
  type: "brand",
  account_id: "cafetito",
  display_name: "☕ CafetITO",
  brand_voice: "épico, segunda persona, energía alta, deportivo",
  daily_cap_usdc: 50,
  spent_today_usdc: 0,
  min_bid_usdc: 0.5,
  max_bid_usdc: 5.0,
  targeting: {
    games: ["any"],
    moods: ["high_energy", "celebration", "victory", "clutch", "comeback"],
  },
  brand_safety: { blocked_keywords: ["muerte", "violencia", "droga"] },
  always_bid_floor: false,
};

const cafetitoPrompt: BrandPrompt = {
  system_persona:
    "Sos el brand-agent de CafetITO. Voz épica, segunda persona, energía alta. Entrás en clutchs, comebacks y celebraciones sostenidas.",
  voice_examples: [
    "Ese clutch merece un CafetITO bien cargado.",
    "Comeback épico, lo banco.",
  ],
  dont_say: ["barato", "promo"],
  dont_do: ["mencionar precios competidores", "tono formal"],
};

const matebrosMandate: BrandMandate = {
  type: "brand",
  account_id: "matebros",
  display_name: "🧉 MateBros",
  brand_voice: "comunitario, fogón, ronda, cálido",
  daily_cap_usdc: 40,
  spent_today_usdc: 0,
  min_bid_usdc: 0.3,
  max_bid_usdc: 3.5,
  targeting: {
    games: ["any"],
    moods: ["casual_chat", "social", "celebration", "community", "fogón"],
  },
  brand_safety: { blocked_keywords: ["menor", "droga"] },
  always_bid_floor: false,
};

const matebrosPrompt: BrandPrompt = {
  system_persona:
    "Sos el brand-agent de MateBros. Voz cálida, comunitaria, fogón, primera persona del plural. Entrás en festejos grupales, charlas relajadas. NO bideas en clutchs individuales.",
  voice_examples: ["Ronda completa, festejo común — MateBros calza."],
  dont_say: ["estadio"],
  dont_do: ["bidear en clutchs individuales"],
};

const cases: Array<{
  label: string;
  brandId: string;
  brandDisplayName: string;
  mandate: BrandMandate;
  prompt: BrandPrompt;
  context: Gate1Context;
  expectProceed: boolean;
  adVariants: string[];
}> = [
  {
    label: "A · CafetITO + clutch épico",
    brandId: "cafetito",
    brandDisplayName: "☕ CafetITO",
    mandate: cafetitoMandate,
    prompt: cafetitoPrompt,
    adVariants: ["epic_goal_lower", "clutch_lower"],
    context: {
      audio_text:
        "¡Increíble! Cerró la transacción en 8 segundos, eso es un clutch técnico de manual. El comeback del build después de 6 horas debuggeando.",
      audio_mentions: ["clutch", "comeback"],
      audio_topics: ["tech", "deploy"],
      mood_tags: ["high_energy", "celebration", "clutch"],
      scene_type: "talking_head",
      viewers: 150,
    },
    expectProceed: true,
  },
  {
    label: "B · CafetITO + silencio nocturno",
    brandId: "cafetito",
    brandDisplayName: "☕ CafetITO",
    mandate: cafetitoMandate,
    prompt: cafetitoPrompt,
    adVariants: ["epic_goal_lower"],
    context: {
      audio_text: "...",
      audio_mentions: [],
      audio_topics: [],
      mood_tags: ["idle", "silence"],
      scene_type: "empty_room",
      viewers: 3,
    },
    expectProceed: false,
  },
  {
    label: "C · MateBros + festejo grupal con mate",
    brandId: "matebros",
    brandDisplayName: "🧉 MateBros",
    mandate: matebrosMandate,
    prompt: matebrosPrompt,
    adVariants: ["fogon_corner", "community_celebration_lower"],
    context: {
      audio_text:
        "Loco, ronda de mate todos festejando que cerramos el deploy. Fogón total, los cuatro tomando mate juntos.",
      audio_mentions: ["mate", "ronda", "fogón"],
      audio_topics: ["comunidad", "celebración"],
      mood_tags: ["social", "celebration", "community", "fogón"],
      scene_type: "team_chat",
      viewers: 2,
    },
    expectProceed: true,
  },
];

async function main(): Promise<void> {
  console.log("▶ smoke-gate3 · Claude Haiku triage · 3 cases\n");

  let pass = 0;
  let fail = 0;

  for (const c of cases) {
    process.stdout.write(`  ${c.label}  ... `);
    const result = await evaluateGate3({
      brandId: c.brandId,
      brandDisplayName: c.brandDisplayName,
      mandate: c.mandate,
      prompt: c.prompt,
      context: c.context,
      ad_variant_names: c.adVariants,
      apiKey: apiKey!,
    });

    const proceed = result.pass;
    const conf =
      result.pass
        ? result.confidence
        : "skip" in result
        ? null
        : 0;
    const detail = result.pass
      ? `ad=${result.ad_id_candidate ?? "(none)"} conf=${conf?.toFixed(2)}`
      : `code=${result.skip.code} detail="${result.skip.detail ?? ""}"`;

    if (proceed === c.expectProceed) {
      console.log(`OK · ${detail} · ${result.latency_ms}ms`);
      pass++;
    } else {
      console.log(
        `FAIL · expected proceed=${c.expectProceed}, got proceed=${proceed} · ${detail}`,
      );
      fail++;
    }
  }

  console.log(`\n── done · ${pass} pass · ${fail} fail ──`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
