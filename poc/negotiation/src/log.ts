import chalk from "chalk";
import { brandById } from "./brands.js";
import { STREAMER_MANDATE } from "./inventory.js";

const TYPEWRITER_MS = Number(process.env.ADDIE_TYPEWRITER_MS ?? 8);
const PHASE_PAUSE_MS = Number(process.env.ADDIE_PHASE_PAUSE_MS ?? 400);

const startedAt = Date.now();

function ts(): string {
  const elapsed = (Date.now() - startedAt) / 1000;
  return chalk.gray(`T+${elapsed.toFixed(1).padStart(5, " ")}s`);
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

const NAME_COL = 12;

export function speakerLabel(brandId: string): string {
  if (brandId === "streamer") {
    return chalk.bold.hex(STREAMER_MANDATE.color)(pad(STREAMER_MANDATE.display_name.toLowerCase(), NAME_COL));
  }
  const b = brandById(brandId);
  return chalk.bold.hex(b.color)(pad(b.display_name.toLowerCase(), NAME_COL));
}

export function brandColor(brandId: string): (s: string) => string {
  if (brandId === "streamer") return chalk.hex(STREAMER_MANDATE.color);
  return chalk.hex(brandById(brandId).color);
}

export function banner(title: string, subtitle?: string) {
  const line = "═".repeat(64);
  console.log("");
  console.log(chalk.bold.cyan(`╔${line}╗`));
  console.log(chalk.bold.cyan(`║`) + chalk.bold.white(pad(`  ${title}`, 64)) + chalk.bold.cyan(`║`));
  if (subtitle) {
    console.log(chalk.bold.cyan(`║`) + chalk.gray(pad(`  ${subtitle}`, 64)) + chalk.bold.cyan(`║`));
  }
  console.log(chalk.bold.cyan(`╚${line}╝`));
  console.log("");
}

export function section(title: string) {
  const line = "─".repeat(64);
  console.log("");
  console.log(chalk.dim(line));
  console.log(`  ${chalk.bold.white(title)}  ${ts()}`);
  console.log(chalk.dim(line));
}

export function info(text: string) {
  console.log(`  ${chalk.gray(text)}`);
}

export function note(label: string, value: string) {
  console.log(`  ${chalk.gray(pad(label, 10))} ${chalk.white(value)}`);
}

export function tickRow(brandId: string, status: "BID" | "SKIP", detail: string) {
  const dot = status === "BID" ? chalk.green("✓") : chalk.dim("✗");
  const label = speakerLabel(brandId);
  const tag =
    status === "BID"
      ? chalk.bgGreen.black(" BID  ")
      : chalk.bgGray.black(" SKIP ");
  console.log(`  ${dot} ${label} ${tag} ${chalk.white(detail)}`);
}

export function actionTag(action: string): string {
  const a = action.toUpperCase();
  switch (a) {
    case "ACCEPT":
      return chalk.bgGreen.black(` ${pad(a, 7)} `);
    case "COUNTER":
      return chalk.bgYellow.black(` ${pad(a, 7)} `);
    case "REJECT":
      return chalk.bgRed.white(` ${pad(a, 7)} `);
    case "WALK":
      return chalk.bgRed.white(` ${pad(a, 7)} `);
    case "OPEN":
      return chalk.bgBlue.white(` ${pad(a, 7)} `);
    default:
      return chalk.bgWhite.black(` ${pad(a, 7)} `);
  }
}

export function termsLine(
  terms: { bid_usdc: number; duration_s: number; zone: string; exclusivity_s?: number } | undefined,
): string {
  if (!terms) return "";
  const excl = terms.exclusivity_s ? chalk.cyan(` · excl=${terms.exclusivity_s}s`) : "";
  return chalk.dim(`$${terms.bid_usdc.toFixed(2)} · ${terms.zone} · ${terms.duration_s}s`) + excl;
}

async function typewrite(text: string, color: (s: string) => string) {
  if (TYPEWRITER_MS <= 0) {
    process.stdout.write(color(text));
    return;
  }
  for (const ch of text) {
    process.stdout.write(color(ch));
    if (ch !== " ") await sleep(TYPEWRITER_MS);
  }
}

export async function turnLine(opts: {
  from: string;
  to: string;
  action: string;
  message: string;
  terms?: { bid_usdc: number; duration_s: number; zone: string; exclusivity_s?: number };
  /** Streamer-side: which playbook tactic was applied. */
  tactic?: string;
  /** Concession-curve target the speaker was supposed to follow this round. */
  curve_target_usdc?: number;
  /** Code-side override that flipped the LLM's intended action. */
  override?: { from_action: string; rule: string; reason: string };
}) {
  const arrow = chalk.dim("→");
  const tag = actionTag(opts.action);
  const fromL = speakerLabel(opts.from);
  const toL = speakerLabel(opts.to);
  const tline = termsLine(opts.terms);
  const tactic = opts.tactic ? chalk.dim(`  [${opts.tactic}]`) : "";
  let curveTag = "";
  if (opts.curve_target_usdc != null && opts.terms) {
    const delta = opts.terms.bid_usdc - opts.curve_target_usdc;
    const deltaPct = (delta / opts.curve_target_usdc) * 100;
    const sign = delta >= 0 ? "+" : "";
    curveTag = chalk.dim(`  [curve $${opts.curve_target_usdc.toFixed(2)} · Δ${sign}${deltaPct.toFixed(1)}%]`);
  }
  console.log(`  ${ts()}  [${fromL} ${arrow} ${toL}]  ${tag}  ${tline}${tactic}${curveTag}`);
  if (opts.override) {
    console.log(
      `             ${chalk.bgRed.white(" GATE ")} ${chalk.red(`override ${opts.override.from_action}→${opts.action}`)} ${chalk.dim(`[${opts.override.rule}] ${opts.override.reason}`)}`,
    );
  }
  process.stdout.write(`             ${chalk.dim("│")}  `);
  await typewrite(`"${opts.message}"`, brandColor(opts.from));
  process.stdout.write("\n");
}

export function valuationLine(brandId: string, v: import("./types.js").ValuationBreakdown) {
  const c = brandColor(brandId);
  const line = chalk.dim(
    `      └─ fit ×${v.brand_fit_multiplier.toFixed(2)} → perceived $${v.perceived_value_usdc.toFixed(2)} → max $${v.max_acceptable_usdc.toFixed(2)} → open ×${v.opening_factor.toFixed(2)} = $${v.opening_bid_usdc.toFixed(2)}`,
  );
  console.log(c(line));
  if (v.fit_reasons.length > 0) {
    console.log(chalk.dim(`         fit: ${v.fit_reasons.join(" · ")}`));
  }
  if (v.competitive_assumption) {
    console.log(chalk.dim(`         comp: ${v.competitive_assumption}`));
  }
}

export function marketSignalsBlock(market: import("./valuation.js").MarketSignals) {
  console.log(`  ${chalk.bold.white("Market signals")} ${chalk.dim("(shared baseline · mismo que ven todos los agents)")}`);
  console.log(
    `  ${pad("intensity", 10)} ${chalk.white(market.intensity_label)} ${chalk.dim(`(${market.moment_intensity}, CPM ×${market.intensity_multiplier})`)}`,
  );
  console.log(`  ${pad("reasoning", 10)} ${chalk.dim(market.reasoning)}`);
  for (const z of Object.keys(market.fair_value_usdc)) {
    const fv = market.fair_value_usdc[z as keyof typeof market.fair_value_usdc];
    const cpm = market.effective_cpm_usdc[z as keyof typeof market.effective_cpm_usdc];
    const imp = market.expected_impressions[z as keyof typeof market.expected_impressions];
    const res = market.dynamic_reserve_usdc[z as keyof typeof market.dynamic_reserve_usdc];
    const asp = market.streamer_aspiration_usdc[z as keyof typeof market.streamer_aspiration_usdc];
    console.log(
      `  ${pad(z, 22)} fair=${chalk.white(`$${fv.toFixed(2)}`)} ${chalk.dim(`(eCPM=$${cpm}, imp=${imp})`)}  ${chalk.yellow(`reserve=$${res.toFixed(2)}`)}  ${chalk.cyan(`aspiration=$${asp.toFixed(2)}`)}`,
    );
  }
}

export function metricsBlock(opts: {
  brands_evaluated: number;
  brands_bid: number;
  closure_rate: number;
  avg_rounds_to_close: number;
  total_llm_calls: number;
  ac_overrides_fired: number;
  walks_due_to_walk_away: number;
  winner_pct_of_fair_value?: number;
  total_revenue_usdc: number;
}) {
  const line = "─".repeat(64);
  console.log("");
  console.log(chalk.dim(line));
  console.log(`  ${chalk.bold.white("ROUND METRICS")}`);
  console.log(chalk.dim(line));
  const row = (k: string, v: string) => console.log(`  ${chalk.gray(pad(k, 28))} ${chalk.white(v)}`);
  row("brands evaluated", `${opts.brands_evaluated}`);
  row("brands that bid", `${opts.brands_bid}`);
  row("closure rate", `${(opts.closure_rate * 100).toFixed(0)}%  (${Math.round(opts.closure_rate * opts.brands_bid)}/${opts.brands_bid} closed-as-deal)`);
  row("avg rounds to close", opts.avg_rounds_to_close.toFixed(2));
  row("total LLM calls", `${opts.total_llm_calls}`);
  row("AC_combi overrides fired", `${opts.ac_overrides_fired}${opts.ac_overrides_fired > 0 ? chalk.red(" ← gates caught LLM mistakes") : ""}`);
  row("walks-on-mandate-cap", `${opts.walks_due_to_walk_away}`);
  if (opts.winner_pct_of_fair_value != null) {
    row("winner % of fair_value", `${(opts.winner_pct_of_fair_value * 100).toFixed(1)}%`);
  }
  row("total revenue this round", chalk.bold.green(`$${opts.total_revenue_usdc.toFixed(2)} USDC`));
  console.log(chalk.dim(line));
}

export function strategyLine(text: string) {
  console.log(`  ${ts()}  ${chalk.italic.gray(`└─ round_strategy: ${text}`)}`);
}

export function thinking(actor: string, what: string) {
  console.log(`  ${ts()}  ${chalk.dim("…")} ${speakerLabel(actor)} ${chalk.italic.gray(what)}`);
}

export function dealRow(brandId: string, terms: { bid_usdc: number; duration_s: number; zone: string }, accepted: boolean) {
  const tag = accepted ? chalk.green("● closed") : chalk.red("● failed");
  const cps = accepted ? chalk.dim(`($${(terms.bid_usdc / terms.duration_s).toFixed(3)}/s)`) : "";
  console.log(`  ${tag}  ${speakerLabel(brandId)}  ${termsLine(terms)}  ${cps}`);
}

export function winnerRow(brandId: string, terms: { bid_usdc: number; duration_s: number; zone: string }, reason: string) {
  console.log(`  ${chalk.bgGreen.black(" WIN ")}  ${speakerLabel(brandId)}  ${termsLine(terms)}`);
  console.log(`         ${chalk.italic.gray(reason)}`);
}

export function rejectedRow(brandId: string, reason: string) {
  console.log(`  ${chalk.bgRed.white(" OUT ")}  ${speakerLabel(brandId)}  ${chalk.italic.gray(reason)}`);
}

export async function phasePause(): Promise<void> {
  await sleep(PHASE_PAUSE_MS);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
