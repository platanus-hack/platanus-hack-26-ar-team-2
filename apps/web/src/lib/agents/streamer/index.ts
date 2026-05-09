/**
 * Streamer-agent module barrel (C-09).
 *
 * Public surface consumed by:
 *   - C-10 negotiation orchestrator (calls `streamerEvaluate` once at T+5s)
 *   - C-12 settlement engine (uses `decisionToTurn` for transcript persistence)
 *   - /demo-display (reads the NegotiationTurn rendered by `decisionToTurn`)
 */

export type {
  ManagerHint,
  MarketSignals,
  StreamerDecision,
  StreamerInput,
  ZoneAmounts,
} from "./types.ts";

export {
  decisionToTurn,
  makeClaudeStreamerEvaluator,
  makeStubStreamerEvaluator,
  type StreamerEvaluator,
} from "./streamerEvaluate.ts";
