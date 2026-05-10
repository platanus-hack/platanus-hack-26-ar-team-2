/**
 * Negotiation orchestrator module barrel (C-10).
 *
 * Public surface consumed by:
 *   - C-14 `POST /api/auctions/run` — calls `runNegotiation` per auction
 *   - C-12 settlement engine        — reads `NegotiationResult.standing_offers`
 *   - smoke-negotiation.ts          — exercises the orchestrator standalone
 */

export type {
  NegotiationArgs,
  NegotiationBrand,
  NegotiationResult,
} from "./types.ts";

export { runNegotiation } from "./orchestrate.ts";
