/** Centralized env reads. Throws fast on missing required vars. */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`missing required env: ${name}`);
  }
  return v;
}

function optionalFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got: ${v}`);
  return n;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v === "true" || v === "1";
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  apiBaseUrl: required("ADDIE_API_BASE_URL"),
  streamKey: required("MANAGER_STREAM_KEY"),

  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
  dryRun: optionalBool("MANAGER_DRY_RUN", false),

  momentQualityMin: optionalFloat("MANAGER_MOMENT_QUALITY_MIN", 0.5),
  brandMatchMin: optionalFloat("MANAGER_BRAND_MATCH_MIN", 0.55),
  cooldownMs: optionalFloat("MANAGER_COOLDOWN_S", 30) * 1000,
};
