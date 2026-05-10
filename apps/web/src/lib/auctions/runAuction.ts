/**
 * runAuction() — auction orchestration core (C-14).
 *
 * Synchronous (~5–8s) end-to-end auction:
 *   1. computeMarketSignals(tick)
 *   2. huntForBrand × N in parallel — each brand decides bid / skip
 *   3. filter should_bid:true → empty list returns `decision: 'no_bidders'`
 *   4. runNegotiation (1-turn MVP) with onTurn → broadcast turns to /demo-display
 *   5. streamerEvaluate single-shot at deadline → walk or pick winner
 *   6. resolve UUIDs (creator / brand / stream / ad) — best-effort, never blocks
 *   7. INSERT placements row with full audit (agent_reasoning, transcript, terms)
 *   8. attempt escrow.lock — A-12 kill-switch is honored; runner-up retry on real failures
 *   9. POST /api/creators/<creator>/render with asset metadata (visible in OBS)
 *
 * The HTTP wrapper lives in `app/api/auctions/run/route.ts`; this module is
 * the unit `sim-orchestrator.ts` (C-08test) and `smoke-auction-run.ts` will
 * call directly so they don't need a live Next server.
 */

import { randomUUID } from "node:crypto";

import { padHex, type Hex } from "viem";

import { pool } from "@/lib/pg";
import { isChainLiveTxsEnabled } from "@/lib/chain/env";
import { getLoadedBrands } from "@/lib/manager/pickBrand";

// chain/privy + chain/escrow trigger module-level env reads (ALCHEMY_RPC_URL,
// PRIVY_*) — gate them behind a lazy import so smoke + harness flows that run
// fully offline don't blow up during module load.
async function loadChain() {
  const [{ getBrandWallet, signLockEscrow }, { ESCROW_OWNER_ADDRESS, usdcAmount }] =
    await Promise.all([
      import("@/lib/chain/privy"),
      import("@/lib/chain/escrow"),
    ]);
  return { getBrandWallet, signLockEscrow, ESCROW_OWNER_ADDRESS, usdcAmount };
}

import { huntForBrand, type HuntResult } from "@/lib/agents/brand/huntForBrand";
import {
  runNegotiation,
  type NegotiationBrand,
  type NegotiationResult,
} from "@/lib/agents/negotiation";
import {
  decisionToTurn,
  makeClaudeStreamerEvaluator,
  makeStubStreamerEvaluator,
  type StreamerDecision,
} from "@/lib/agents/streamer";
import type { LoadedBrand } from "@/lib/agents/brands/loader";
import type {
  AccountId,
  BrandValuation,
  DealTerms,
  NegotiationTurn,
  StandingOffer,
  StreamerMandate,
  ZoneId,
} from "@/lib/agents/types";
import type { ContextChunk } from "@/lib/manager/types";
import type { ManagerDecisionSummary } from "@/lib/agents/brand/huntForBrand";

import { computeMarketSignals } from "./marketSignals";

// ─── Public types ────────────────────────────────────────────────────

export type RunAuctionArgs = {
  tick: ContextChunk;
  manager_decision: ManagerDecisionSummary;
  /**
   * Slug del creator — usado por /render como path param. Si no se pasa,
   * cae a `tick.stream_key` (alineado con la convención manager-tick:
   * `stream_key === creator_id slug`).
   */
  creator_id?: string;
  /**
   * Base URL al que el orquestador POSTea /render (negotiation_turn + asset).
   * Default: VERCEL_URL → http://localhost:3000.
   */
  base_url?: string;
  /** Bearer secret reusado para POSTs internos (mismo CRON_SECRET). */
  cron_secret?: string;
  /** ANTHROPIC_API_KEY — requerido a menos que `dry_run: true`. */
  anthropic_api_key?: string;
  /**
   * Stub mode: salta Sonnet/Haiku en hunt + streamer y corre con stubs
   * deterministas. Uso: harness, smoke, MANAGER_DRY_RUN=true.
   */
  dry_run?: boolean;
  /** Override del runtime en tests/harness. Default Date.now. */
  now?: () => number;
};

export type AuctionDecision =
  | "no_bidders"
  | "walk"
  | "placed"
  | "lock_failed"
  | "lock_skipped_killswitch";

export type RunAuctionResult = {
  auction_id: string;
  decision: AuctionDecision;
  hunt_summary: { bid_count: number; skip_count: number; total_ms: number };
  negotiation: { transcript: NegotiationTurn[]; total_turns: number; total_ms: number };
  streamer_decision: StreamerDecision | null;
  placement?: {
    placement_id: string;
    brand_id: string;
    brand_slug: string;
    terms: DealTerms;
    db_inserted: boolean;
    lock_tx_hash: Hex | null;
    lock_error?: string;
    runner_up_used?: boolean;
  };
  total_ms: number;
};

// ─── Implementation ──────────────────────────────────────────────────

const STREAMER_HARD_FLOOR_USDC = 0.1;

export async function runAuction(args: RunAuctionArgs): Promise<RunAuctionResult> {
  const t0 = (args.now ?? Date.now)();
  const auctionId = randomUUID();
  const creatorSlug = args.creator_id ?? args.tick.stream_key;
  const baseUrl = args.base_url ?? defaultBaseUrl();

  log("auction:start", {
    auction_id: auctionId,
    chunk_id: args.tick.id,
    creator_slug: creatorSlug,
    dry_run: !!args.dry_run,
  });

  // 1. Market signals derived from the tick + manager decision.
  const signals = computeMarketSignals({
    tick: args.tick,
    manager_decision: args.manager_decision,
  });

  // 2. Run hunts for every loaded brand in parallel.
  const brands = getLoadedBrands();
  const tHuntStart = (args.now ?? Date.now)();
  const huntResults = await Promise.all(
    brands.map(async (brand): Promise<{ brand: LoadedBrand; result: HuntResult }> => {
      const cap = brand.payload.daily_cap_usdc;
      const spent = brand.payload.spent_today_usdc ?? 0;
      const available = Math.max(0, cap - spent);
      try {
        const result = await huntForBrand({
          brand,
          context: args.tick,
          stream: null,
          market_signals: signals.hunt,
          manager_decision: args.manager_decision,
          available_balance_usdc: available,
          apiKey: args.anthropic_api_key,
          dryRun: !!args.dry_run,
        });
        return { brand, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("auction:hunt_error", { auction_id: auctionId, brand_slug: brand.slug, error: msg });
        return {
          brand,
          result: {
            decision: { should_bid: false, reason: `hunt error: ${msg}` },
            gate_path: [],
            latency_ms: 0,
          },
        };
      }
    }),
  );
  const huntMs = (args.now ?? Date.now)() - tHuntStart;

  const bidders = huntResults.filter(
    (h): h is { brand: LoadedBrand; result: HuntResult } & { result: { decision: { should_bid: true } } } =>
      h.result.decision.should_bid === true,
  );
  const huntSummary = {
    bid_count: bidders.length,
    skip_count: huntResults.length - bidders.length,
    total_ms: huntMs,
  };
  log("auction:hunt_summary", { auction_id: auctionId, ...huntSummary });

  // 3. Empty bidder list — return early.
  if (bidders.length === 0) {
    return {
      auction_id: auctionId,
      decision: "no_bidders",
      hunt_summary: huntSummary,
      negotiation: { transcript: [], total_turns: 0, total_ms: 0 },
      streamer_decision: null,
      total_ms: (args.now ?? Date.now)() - t0,
    };
  }

  // 4. Negotiation orchestrator. onTurn broadcasts each turn to /demo-display.
  const negotiationBrands: NegotiationBrand[] = bidders.map(({ brand, result }) => {
    const decision = result.decision as Extract<typeof result.decision, { should_bid: true }>;
    const cap = brand.payload.daily_cap_usdc;
    const spent = brand.payload.spent_today_usdc ?? 0;
    const available = Math.max(0, cap - spent);
    return {
      brand,
      account_id: brand.slug as AccountId,
      opening_terms: {
        bid_usdc: decision.bid_usdc,
        duration_s: decision.duration_s,
        zone: decision.zone,
        exclusivity_s: decision.exclusivity_s,
        ad_id: decision.ad_id,
      },
      opening_message: decision.opening_message,
      valuation: decision.reasoning,
      available_balance_usdc: available,
    };
  });

  const negotiation = await runNegotiation({
    auction_id: auctionId,
    brands: negotiationBrands,
    market_signals: signals.streamer,
    manager_hint: signals.manager_hint,
    cap_turns: 1,
    onTurn: (turn) => broadcastNegotiationTurn(baseUrl, creatorSlug, auctionId, turn, args.cron_secret),
    now: args.now,
  });

  // 5. Streamer single-shot evaluation.
  const evaluator = args.dry_run || !args.anthropic_api_key
    ? makeStubStreamerEvaluator()
    : makeClaudeStreamerEvaluator(args.anthropic_api_key);

  const streamerMandate = buildStreamerMandate(creatorSlug);

  const streamerDecision = await evaluator({
    standing_offers: negotiation.standing_offers,
    market_signals: signals.streamer,
    manager_hint: signals.manager_hint,
    creator_mandate: streamerMandate,
  });

  // Broadcast the accept/walk turn so /demo-display closes the auction visually.
  const fallbackBrandId = pickFallbackBrandId(negotiation.standing_offers, negotiationBrands);
  if (fallbackBrandId) {
    const closingTurn = decisionToTurn(
      streamerDecision,
      (args.now ?? Date.now)() - t0,
      fallbackBrandId,
    );
    await broadcastNegotiationTurn(baseUrl, creatorSlug, auctionId, closingTurn, args.cron_secret);
  }

  log("auction:streamer", {
    auction_id: auctionId,
    action: streamerDecision.action,
    winner: streamerDecision.winner_brand_id ?? null,
    revenue: streamerDecision.total_revenue_usdc,
    override: streamerDecision.override?.rule ?? null,
  });

  if (streamerDecision.action === "walk") {
    return {
      auction_id: auctionId,
      decision: "walk",
      hunt_summary: huntSummary,
      negotiation: { transcript: negotiation.transcript, total_turns: negotiation.metrics.total_turns, total_ms: negotiation.metrics.total_ms },
      streamer_decision: streamerDecision,
      total_ms: (args.now ?? Date.now)() - t0,
    };
  }

  // 6. Resolve winner + INSERT placements + attempt escrow.lock.
  const winnerSlug = streamerDecision.winner_brand_id!;
  const winnerBrand = negotiationBrands.find((b) => b.account_id === winnerSlug);
  if (!winnerBrand) {
    // Defensive: the streamer named a brand that's not in the standings. Walk.
    log("auction:winner_unknown", { auction_id: auctionId, winner: winnerSlug });
    return {
      auction_id: auctionId,
      decision: "walk",
      hunt_summary: huntSummary,
      negotiation: { transcript: negotiation.transcript, total_turns: negotiation.metrics.total_turns, total_ms: negotiation.metrics.total_ms },
      streamer_decision: streamerDecision,
      total_ms: (args.now ?? Date.now)() - t0,
    };
  }
  const placementId = randomUUID();

  const placementResult = await placeAndLock({
    auction_id: auctionId,
    placement_id: placementId,
    creator_slug: creatorSlug,
    winner: winnerBrand,
    streamer_decision: streamerDecision,
    negotiation,
    standing_offers: negotiation.standing_offers,
    tick: args.tick,
    dry_run: !!args.dry_run,
  });

  // 9. Broadcast asset metadata to /render → iframe (consumed by OBS browser source).
  await broadcastAssetRender({
    base_url: baseUrl,
    creator_slug: creatorSlug,
    cron_secret: args.cron_secret,
    placement_id: placementResult.placement_id,
    brand: placementResult.winner_brand,
    terms: placementResult.terms,
  });

  return {
    auction_id: auctionId,
    decision: placementResult.decision,
    hunt_summary: huntSummary,
    negotiation: { transcript: negotiation.transcript, total_turns: negotiation.metrics.total_turns, total_ms: negotiation.metrics.total_ms },
    streamer_decision: streamerDecision,
    placement: {
      placement_id: placementResult.placement_id,
      brand_id: placementResult.brand_account_id ?? placementResult.winner_brand.account_id,
      brand_slug: placementResult.winner_brand.brand.slug,
      terms: placementResult.terms,
      db_inserted: placementResult.db_inserted,
      lock_tx_hash: placementResult.lock_tx_hash,
      lock_error: placementResult.lock_error,
      runner_up_used: placementResult.runner_up_used,
    },
    total_ms: (args.now ?? Date.now)() - t0,
  };
}

// ─── Placement + escrow ──────────────────────────────────────────────

type PlaceArgs = {
  auction_id: string;
  placement_id: string;
  creator_slug: string;
  winner: NegotiationBrand;
  streamer_decision: StreamerDecision;
  negotiation: NegotiationResult;
  standing_offers: StandingOffer[];
  tick: ContextChunk;
  dry_run: boolean;
};

type PlaceResult = {
  decision: AuctionDecision;
  placement_id: string;
  winner_brand: NegotiationBrand;
  brand_account_id?: string;
  terms: DealTerms;
  db_inserted: boolean;
  lock_tx_hash: Hex | null;
  lock_error?: string;
  runner_up_used?: boolean;
};

async function placeAndLock(args: PlaceArgs): Promise<PlaceResult> {
  const winner = args.winner;
  const terms = args.streamer_decision.terms ?? winner.opening_terms;

  // Best-effort UUID resolution. None of these block the placement broadcast —
  // if the seed scripts didn't run, the placement still renders + the audit is
  // logged in render_events; only the DB row is skipped.
  const ids = await resolveOnchainIds(winner.brand.slug, args.creator_slug, args.dry_run);

  const dbInserted = await insertPlacement({
    placement_id: args.placement_id,
    brand_id: ids.brand_account_id,
    creator_id: ids.creator_account_id,
    stream_id: ids.stream_id,
    ad_id: ids.ad_id,
    terms,
    valuation: winner.valuation,
    streamer_decision: args.streamer_decision,
    transcript: args.negotiation.transcript,
    tick: args.tick,
  });

  // Try lock with the winning brand first; on real failure (not kill-switch),
  // try the next-best standing that still clears the streamer's hard floor.
  const lockAttempt = await tryLockWithFallback({
    placement_id: args.placement_id,
    primary_brand_slug: winner.brand.slug,
    primary_amount_usdc: terms.bid_usdc,
    standing_offers: args.standing_offers,
    streamer_decision: args.streamer_decision,
  });

  if (lockAttempt.lock_tx_hash) {
    if (dbInserted) {
      await pool()
        .query(
          "update placements set lock_tx_hash = $1, status = 'locked' where id = $2",
          [lockAttempt.lock_tx_hash, args.placement_id],
        )
        .catch((err) =>
          log("auction:db_update_tx_error", {
            auction_id: args.auction_id,
            placement_id: args.placement_id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }
    return {
      decision: "placed",
      placement_id: args.placement_id,
      winner_brand: winner,
      brand_account_id: ids.brand_account_id,
      terms,
      db_inserted: dbInserted,
      lock_tx_hash: lockAttempt.lock_tx_hash,
      runner_up_used: lockAttempt.runner_up_used,
    };
  }

  // Kill-switch path: A-12 shorted us before signing. Treat as success-with-mock
  // so /demo-display + iframe still get the placement; lock_tx_hash stays null.
  if (lockAttempt.kill_switch) {
    if (dbInserted) {
      await pool()
        .query("update placements set status = 'locked' where id = $1", [args.placement_id])
        .catch(() => {});
    }
    return {
      decision: "lock_skipped_killswitch",
      placement_id: args.placement_id,
      winner_brand: winner,
      brand_account_id: ids.brand_account_id,
      terms,
      db_inserted: dbInserted,
      lock_tx_hash: null,
      lock_error: lockAttempt.error,
    };
  }

  // Real failure: mark placement lock_failed but still let the demo show the agreed terms.
  if (dbInserted) {
    await pool()
      .query("update placements set status = 'failed' where id = $1", [args.placement_id])
      .catch(() => {});
  }
  log("auction:lock_failed", {
    auction_id: args.auction_id,
    placement_id: args.placement_id,
    error: lockAttempt.error,
  });
  return {
    decision: "lock_failed",
    placement_id: args.placement_id,
    winner_brand: winner,
    brand_account_id: ids.brand_account_id,
    terms,
    db_inserted: dbInserted,
    lock_tx_hash: null,
    lock_error: lockAttempt.error,
  };
}

type LockOutcome = {
  lock_tx_hash: Hex | null;
  kill_switch: boolean;
  runner_up_used: boolean;
  error?: string;
};

async function tryLockWithFallback(args: {
  placement_id: string;
  primary_brand_slug: string;
  primary_amount_usdc: number;
  standing_offers: StandingOffer[];
  streamer_decision: StreamerDecision;
}): Promise<LockOutcome> {
  // Short-circuit on kill-switch BEFORE any wallet I/O — A-12 contract.
  if (!isChainLiveTxsEnabled()) {
    return {
      lock_tx_hash: null,
      kill_switch: true,
      runner_up_used: false,
      error: "CHAIN_LIVE_TXS=false (A-12 kill-switch)",
    };
  }

  const chain = await loadChain();

  const tryOne = async (slug: string, amount: number): Promise<LockOutcome | null> => {
    try {
      const txHash = await chain.signLockEscrow({
        brandSlug: slug,
        placementId: placementIdToHex32(args.placement_id),
        payee: chain.ESCROW_OWNER_ADDRESS,
        amount: chain.usdcAmount(amount.toFixed(6)),
      });
      return {
        lock_tx_hash: txHash.txHash,
        kill_switch: false,
        runner_up_used: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("auction:lock_attempt_error", { brand_slug: slug, error: msg });
      return {
        lock_tx_hash: null,
        kill_switch: false,
        runner_up_used: false,
        error: msg,
      };
    }
  };

  const primary = await tryOne(args.primary_brand_slug, args.primary_amount_usdc);
  if (primary?.lock_tx_hash) return primary;

  // Runner-up retry: pick the next standing offer (sorted by bid desc) that
  // still beats the streamer's hard floor.
  const eligible = args.standing_offers
    .filter((s) => !s.walked && s.brand_id !== args.primary_brand_slug)
    .filter((s) => s.terms.bid_usdc >= STREAMER_HARD_FLOOR_USDC)
    .sort((a, b) => b.terms.bid_usdc - a.terms.bid_usdc);

  for (const candidate of eligible) {
    const attempt = await tryOne(candidate.brand_id, candidate.terms.bid_usdc);
    if (attempt?.lock_tx_hash) {
      return { ...attempt, runner_up_used: true };
    }
  }

  return primary ?? { lock_tx_hash: null, kill_switch: false, runner_up_used: false, error: "no eligible bidders" };
}

// ─── DB helpers ──────────────────────────────────────────────────────

type ResolvedIds = {
  brand_account_id?: string;
  creator_account_id?: string;
  stream_id?: string;
  ad_id?: string;
};

async function resolveOnchainIds(
  brandSlug: string,
  creatorSlug: string,
  dryRun: boolean,
): Promise<ResolvedIds> {
  if (dryRun) return {};
  const out: ResolvedIds = {};

  try {
    const { getBrandWallet } = await loadChain();
    const wallet = await getBrandWallet(brandSlug);
    out.brand_account_id = wallet.account_id;
  } catch (err) {
    log("auction:resolve_brand_skip", {
      brand_slug: brandSlug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // creator + stream + ad are ALL best-effort. Slug-based accounts.metadata
  // lookup matches the seed pattern in db.ts.
  try {
    const c = await pool().query<{ id: string }>(
      `select id from accounts where type = 'creator' and (metadata->>'slug' = $1 or display_name = $1) limit 1`,
      [creatorSlug],
    );
    out.creator_account_id = c.rows[0]?.id;

    if (out.creator_account_id) {
      const s = await pool().query<{ id: string }>(
        `select id from streams where creator_id = $1 order by started_at desc limit 1`,
        [out.creator_account_id],
      );
      out.stream_id = s.rows[0]?.id;
    }

    if (out.brand_account_id) {
      const a = await pool().query<{ id: string }>(
        `select id from ads where brand_id = $1 order by created_at asc limit 1`,
        [out.brand_account_id],
      );
      out.ad_id = a.rows[0]?.id;
    }
  } catch (err) {
    log("auction:resolve_db_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return out;
}

async function insertPlacement(args: {
  placement_id: string;
  brand_id?: string;
  creator_id?: string;
  stream_id?: string;
  ad_id?: string;
  terms: DealTerms;
  valuation: BrandValuation;
  streamer_decision: StreamerDecision;
  transcript: NegotiationTurn[];
  tick: ContextChunk;
}): Promise<boolean> {
  if (!args.brand_id || !args.stream_id || !args.ad_id) {
    log("auction:placement_skip_insert", {
      placement_id: args.placement_id,
      reason: "missing FK target",
      have: {
        brand_id: !!args.brand_id,
        stream_id: !!args.stream_id,
        ad_id: !!args.ad_id,
      },
    });
    return false;
  }

  const cents = Math.max(1, Math.round(args.terms.bid_usdc * 100));
  const durationMs = Math.max(1, Math.round(args.terms.duration_s * 1000));

  try {
    await pool().query(
      `insert into placements
        (id, stream_id, brand_id, ad_id, zone, amount_usdc_cents, duration_ms,
         context_snapshot, agent_reasoning, negotiation_transcript, winning_offer, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, 'locked')`,
      [
        args.placement_id,
        args.stream_id,
        args.brand_id,
        args.ad_id,
        args.terms.zone,
        cents,
        durationMs,
        JSON.stringify({
          chunk_id: args.tick.id,
          audio_intent: args.tick.audio_intent,
          mood_tags: args.tick.mood_tags,
          viewers: args.tick.viewers,
        }),
        JSON.stringify(args.valuation),
        JSON.stringify(args.transcript),
        JSON.stringify({
          terms: args.terms,
          streamer_reason: args.streamer_decision.reason,
          rejected: args.streamer_decision.rejected,
          override: args.streamer_decision.override ?? null,
        }),
      ],
    );
    return true;
  } catch (err) {
    log("auction:placement_insert_error", {
      placement_id: args.placement_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Broadcast helpers ───────────────────────────────────────────────

async function broadcastNegotiationTurn(
  baseUrl: string,
  creatorSlug: string,
  auctionId: string,
  turn: NegotiationTurn,
  cronSecret?: string,
): Promise<void> {
  await postJson(
    `${baseUrl.replace(/\/$/, "")}/api/creators/${creatorSlug}/render`,
    {
      kind: "negotiation_turn",
      auction_id: auctionId,
      message: condenseTurn(turn),
      brand_id: turn.brand_id,
      payload: {
        turn,
      },
    },
    cronSecret,
  ).catch((err) => log("auction:broadcast_turn_error", { auction_id: auctionId, error: err?.message }));
}

async function broadcastAssetRender(args: {
  base_url: string;
  creator_slug: string;
  cron_secret?: string;
  placement_id: string;
  brand: NegotiationBrand;
  terms: DealTerms;
}): Promise<void> {
  const ad = args.brand.brand.ad;
  if (!ad?.asset_url) {
    log("auction:asset_skip", {
      placement_id: args.placement_id,
      brand_slug: args.brand.brand.slug,
      reason: "brand has no ad_asset_url in YAML",
    });
    return;
  }
  await postJson(
    `${args.base_url.replace(/\/$/, "")}/api/creators/${args.creator_slug}/render`,
    {
      asset_url: ad.asset_url,
      asset_type: ad.asset_type ?? "video",
      zone_id: args.terms.zone,
      duration_ms: args.terms.duration_s * 1000,
      brand_id: args.brand.brand.slug,
      placement_id: args.placement_id,
      audio: true,
    },
    args.cron_secret,
  ).catch((err) =>
    log("auction:asset_render_error", {
      placement_id: args.placement_id,
      error: err?.message,
    }),
  );
}

// ─── Misc helpers ────────────────────────────────────────────────────

function defaultBaseUrl(): string {
  if (process.env.AUCTIONS_BASE_URL) return process.env.AUCTIONS_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function postJson(url: string, body: unknown, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function pickFallbackBrandId(
  standings: StandingOffer[],
  brands: NegotiationBrand[],
): AccountId | null {
  // Highest active standing. Used when streamer walks: gives /demo-display
  // a coherent counterparty for the closing turn message.
  const sorted = [...standings].filter((s) => !s.walked).sort((a, b) => b.terms.bid_usdc - a.terms.bid_usdc);
  if (sorted[0]) return sorted[0].brand_id;
  return brands[0]?.account_id ?? null;
}

function buildStreamerMandate(creatorSlug: string): StreamerMandate {
  // Static defaults — there's no creator-side YAML in MVP and the DB lookup
  // (lib/db.ts:getStreamerPrefs) would need a UUID. For C-14 we run with
  // PITCH-aligned defaults; F-05 dress-rehearsal can swap in a real fetch.
  return {
    type: "streamer",
    account_id: creatorSlug,
    display_name: creatorSlug,
    hard_floor_usdc: STREAMER_HARD_FLOOR_USDC,
    blocked_keywords: [],
    preferred_brands: [],
  };
}

function condenseTurn(turn: NegotiationTurn): string {
  if (turn.action === "open" && turn.message) return truncate(turn.message, 280);
  if (turn.action === "accept" && turn.message) return truncate(turn.message, 280);
  if (turn.action === "walk" && turn.message) return truncate(turn.message, 280);
  return truncate(`${turn.from} ${turn.action}`, 280);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function placementIdToHex32(uuid: string): Hex {
  const hex = ("0x" + uuid.replace(/-/g, "")) as Hex;
  return padHex(hex, { size: 32 });
}

function log(tag: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ tag, ...fields }));
}
