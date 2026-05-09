/**
 * Server-side Supabase helpers.
 * SERVER ONLY — never import from Client Components.
 *
 * Uses supabaseAdmin() (service role, bypasses RLS) because no auth policies
 * are wired yet. All public helpers return safe defaults on any DB error so
 * the UI stays functional even without a service-role key in .env.local.
 */

import { supabaseAdmin } from "./supabase";

// ─── Brand registry (static) ─────────────────────────────────────────────────

const BRAND_META: Record<string, { display_name: string; color: string }> = {
  adidas:   { display_name: "Adidas Argentina",    color: "#e8e8e8" },
  nike:     { display_name: "Nike Argentina",       color: "#ff6600" },
  quilmes:  { display_name: "Quilmes",              color: "#f5c400" },
  mp:       { display_name: "Mercado Pago",         color: "#009ee3" },
  steam:    { display_name: "Steam",                color: "#66c0f4" },
  rappi:    { display_name: "Rappi Argentina",      color: "#ff441f" },
  globant:  { display_name: "Globant",              color: "#b8d430" },
  cocacola: { display_name: "Coca-Cola Argentina",  color: "#f40009" },
};

export const ALL_BRAND_SLUGS = Object.keys(BRAND_META);

// ─── Demo creator ────────────────────────────────────────────────────────────

const DEMO_CREATOR_NAME = "Addie Demo Creator";

export async function getDemoCreatorId(): Promise<string> {
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("accounts")
    .select("id")
    .eq("type", "creator")
    .eq("display_name", DEMO_CREATOR_NAME)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await db
    .from("accounts")
    .insert({
      type: "creator",
      display_name: DEMO_CREATOR_NAME,
      metadata: { twitch_channel: "addie_demo", language: "es", demo_persona: true },
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(`getDemoCreatorId: ${error?.message}`);
  return created.id as string;
}

// ─── Brand accounts ──────────────────────────────────────────────────────────

export async function getBrandAccountId(slug: string): Promise<string | null> {
  const meta = BRAND_META[slug];
  if (!meta) return null;

  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("accounts")
    .select("id")
    .eq("type", "brand")
    .eq("display_name", meta.display_name)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await db
    .from("accounts")
    .insert({
      type: "brand",
      display_name: meta.display_name,
      metadata: { slug, color: meta.color },
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(`getBrandAccountId(${slug}): ${error?.message}`);
  return created.id as string;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export type InventoryRow = {
  zone: "lower_third" | "bottom_right_corner" | "fullscreen_takeover";
  floor_usdc_cents: number;
  max_duration_ms: number;
  manual_only: boolean;
  enabled: boolean;
};

const INVENTORY_DEFAULTS: InventoryRow[] = [
  { zone: "lower_third",         floor_usdc_cents: 50,  max_duration_ms: 8000,  manual_only: false, enabled: true },
  { zone: "bottom_right_corner", floor_usdc_cents: 25,  max_duration_ms: 60000, manual_only: false, enabled: true },
  { zone: "fullscreen_takeover", floor_usdc_cents: 300, max_duration_ms: 30000, manual_only: true,  enabled: true },
];

export async function getInventory(creatorId: string): Promise<InventoryRow[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("inventory")
    .select("zone, floor_usdc_cents, max_duration_ms, manual_only, enabled")
    .eq("creator_id", creatorId);

  if (!data || data.length === 0) return INVENTORY_DEFAULTS;
  return data as InventoryRow[];
}

export async function upsertInventory(creatorId: string, rows: InventoryRow[]): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("inventory").upsert(
    rows.map((r) => ({ creator_id: creatorId, ...r, updated_at: new Date().toISOString() })),
    { onConflict: "creator_id,zone" },
  );
  if (error) throw new Error(`upsertInventory: ${error.message}`);
}

// ─── Streamer preferences (streamer mandate payload) ──────────────────────────

export type StreamerPrefs = {
  approved_brand_slugs: string[];
  blocked_keywords: string[];
  hard_floor_usdc: number;
};

const DEFAULT_STREAMER_PREFS: StreamerPrefs = {
  approved_brand_slugs: ALL_BRAND_SLUGS,
  blocked_keywords: [],
  hard_floor_usdc: 0.10,
};

export async function getStreamerPrefs(creatorId: string): Promise<StreamerPrefs> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("mandates")
    .select("payload")
    .eq("account_id", creatorId)
    .eq("type", "streamer")
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return DEFAULT_STREAMER_PREFS;

  const p = data.payload as Record<string, unknown>;
  return {
    approved_brand_slugs: (p.approved_brand_slugs as string[] | undefined) ?? ALL_BRAND_SLUGS,
    blocked_keywords: (p.blocked_keywords as string[] | undefined) ?? [],
    hard_floor_usdc: (p.hard_floor_usdc as number | undefined) ?? 0.10,
  };
}

export async function upsertStreamerPrefs(creatorId: string, prefs: StreamerPrefs): Promise<void> {
  const db = supabaseAdmin();

  await db
    .from("mandates")
    .update({ revoked_at: new Date().toISOString() })
    .eq("account_id", creatorId)
    .eq("type", "streamer")
    .is("revoked_at", null);

  const { error } = await db.from("mandates").insert({
    account_id: creatorId,
    type: "streamer",
    payload: {
      type: "streamer",
      account_id: creatorId,
      display_name: DEMO_CREATOR_NAME,
      hard_floor_usdc: prefs.hard_floor_usdc,
      blocked_keywords: prefs.blocked_keywords,
      preferred_brands: [],
      approved_brand_slugs: prefs.approved_brand_slugs,
    },
    signature: `mvp:dummy:${creatorId}`,
  });
  if (error) throw new Error(`upsertStreamerPrefs: ${error.message}`);
}

// ─── Brand mandate ────────────────────────────────────────────────────────────

export type BrandMandateData = {
  daily_cap_usdc: number;
  min_bid_usdc: number;
  max_bid_usdc: number;
  safety_keywords: string[];
};

export async function getBrandMandateData(brandAccountId: string): Promise<BrandMandateData | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("mandates")
    .select("payload")
    .eq("account_id", brandAccountId)
    .eq("type", "brand")
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;

  const p = data.payload as Record<string, unknown>;
  const safety = p.brand_safety as { blocked_keywords: string[] } | undefined;
  return {
    daily_cap_usdc: (p.daily_cap_usdc as number) ?? 0,
    min_bid_usdc: (p.min_bid_usdc as number) ?? 0,
    max_bid_usdc: (p.max_bid_usdc as number) ?? 0,
    safety_keywords: safety?.blocked_keywords ?? [],
  };
}

export async function upsertBrandMandateData(
  brandAccountId: string,
  displayName: string,
  data: BrandMandateData,
): Promise<void> {
  const db = supabaseAdmin();

  await db
    .from("mandates")
    .update({ revoked_at: new Date().toISOString() })
    .eq("account_id", brandAccountId)
    .eq("type", "brand")
    .is("revoked_at", null);

  const { error } = await db.from("mandates").insert({
    account_id: brandAccountId,
    type: "brand",
    payload: {
      type: "brand",
      account_id: brandAccountId,
      display_name: displayName,
      brand_voice: "",
      daily_cap_usdc: data.daily_cap_usdc,
      spent_today_usdc: 0,
      min_bid_usdc: data.min_bid_usdc,
      max_bid_usdc: data.max_bid_usdc,
      targeting: { games: ["any"], moods: ["any"] },
      brand_safety: { blocked_keywords: data.safety_keywords },
    },
    signature: `mvp:dummy:${brandAccountId}`,
  });
  if (error) throw new Error(`upsertBrandMandateData: ${error.message}`);
}

// ─── Brand stats (aggregated from placements) ─────────────────────────────────

export type BrandStats = {
  placements: number;
  impressions: number;
  spend_usdc: number;
  win_rate: number;
};

export async function getBrandStats(brandAccountId: string): Promise<BrandStats> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("placements")
    .select("amount_usdc_cents, qr_scans, status")
    .eq("brand_id", brandAccountId);

  if (!data || data.length === 0) {
    return { placements: 0, impressions: 0, spend_usdc: 0, win_rate: 0 };
  }

  const rendered = data.filter((p) => p.status === "rendered" || p.status === "locked");
  const spend = rendered.reduce((sum: number, p) => sum + (p.amount_usdc_cents as number), 0) / 100;
  const totalScans = data.reduce((sum: number, p) => sum + ((p.qr_scans as number) || 0), 0);

  return {
    placements: rendered.length,
    impressions: totalScans,
    spend_usdc: spend,
    win_rate: data.length > 0 ? rendered.length / data.length : 0,
  };
}

// ─── Brand ads ────────────────────────────────────────────────────────────────

export type AdRow = {
  id: string;
  variant_name: string;
  format: string;
  asset_url: string;
  asset_type: string;
  duration_ms: number | null;
  mood_tags: string[];
  tracking_url: string;
};

export async function getBrandAds(brandAccountId: string): Promise<AdRow[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("ads")
    .select("id, variant_name, format, asset_url, asset_type, duration_ms, mood_tags, tracking_url")
    .eq("brand_id", brandAccountId);

  return (data ?? []) as AdRow[];
}

// ─── Recent placements (for Dock) ────────────────────────────────────────────

export type PlacementRow = {
  id: string;
  brand_display_name: string;
  ad_variant_name: string;
  amount_usdc_cents: number;
  zone: string;
  status: string;
  created_at: string;
};

export async function getRecentPlacements(limit = 8): Promise<PlacementRow[]> {
  const db = supabaseAdmin();

  const { data } = await db
    .from("placements")
    .select(`
      id,
      amount_usdc_cents,
      zone,
      status,
      created_at,
      accounts!placements_brand_id_fkey ( display_name ),
      ads!placements_ad_id_fkey ( variant_name )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((p) => {
    const acct = (p.accounts as unknown) as { display_name: string } | { display_name: string }[] | null;
    const ad = (p.ads as unknown) as { variant_name: string } | { variant_name: string }[] | null;
    const acctObj = Array.isArray(acct) ? acct[0] : acct;
    const adObj = Array.isArray(ad) ? ad[0] : ad;
    return {
      id: p.id as string,
      brand_display_name: acctObj?.display_name ?? "Unknown",
      ad_variant_name: adObj?.variant_name ?? "—",
      amount_usdc_cents: p.amount_usdc_cents as number,
      zone: p.zone as string,
      status: p.status as string,
      created_at: p.created_at as string,
    };
  });
}
