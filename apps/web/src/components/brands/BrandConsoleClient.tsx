"use client";

import Link from "next/link";
import { useReducer, useState, useRef, useCallback } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import type { BrandMandateData, BrandStats, AdRow } from "@/lib/db";

export type BrandInitial = {
  mandate: BrandMandateData | null;
  stats: BrandStats;
  ads: AdRow[];
};

export interface BrandMeta {
  id: string;
  label: string;
  color: string;
  daily_cap_usdc: number;
  min_bid_usdc: number;
  max_bid_usdc: number;
  always_bid_floor: boolean;
  persona_slug: string;
  tracking_url: string;
  allowed_zones: string[];
  preferred_zones: string[];
  target_moods: string[];
  safety_keywords: string[];
}

const BRAND_REGISTRY: Record<string, BrandMeta> = {
  adidas: {
    id: "adidas", label: "Adidas Argentina", color: "#e8e8e8",
    daily_cap_usdc: 50, min_bid_usdc: 0.50, max_bid_usdc: 5.00, always_bid_floor: false,
    persona_slug: "Directo, deportivo y apasionado. Solo momentos épicos.",
    tracking_url: "https://adidas.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "celebration", "victory", "clutch", "comeback", "goal"],
    safety_keywords: ["muerte", "violencia", "drogas", "insulto_grave"],
  },
  nike: {
    id: "nike", label: "Nike Argentina", color: "#ff6600",
    daily_cap_usdc: 55, min_bid_usdc: 0.50, max_bid_usdc: 6.00, always_bid_floor: false,
    persona_slug: "Inspiracional y directo. Momentos de superación personal.",
    tracking_url: "https://nike.com.ar/addie",
    allowed_zones: ["lower_third", "fullscreen_takeover"],
    preferred_zones: ["fullscreen_takeover"],
    target_moods: ["high_energy", "comeback", "victory", "clutch"],
    safety_keywords: ["muerte", "violencia", "drogas"],
  },
  quilmes: {
    id: "quilmes", label: "Quilmes", color: "#f5c400",
    daily_cap_usdc: 40, min_bid_usdc: 0.30, max_bid_usdc: 3.50, always_bid_floor: false,
    persona_slug: "Relajado y social. Momentos de compartir y celebrar.",
    tracking_url: "https://quilmes.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["celebration", "casual", "chat_active", "social"],
    safety_keywords: ["muerte", "violencia", "drogas", "menores"],
  },
  mp: {
    id: "mp", label: "Mercado Pago", color: "#009ee3",
    daily_cap_usdc: 100, min_bid_usdc: 0.20, max_bid_usdc: 2.00, always_bid_floor: true,
    persona_slug: "Default bidder. Garantiza fill al floor. No negocia.",
    tracking_url: "https://mercadopago.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["any"],
    safety_keywords: ["estafa", "fraude", "hack", "robo", "muerte", "violencia", "drogas"],
  },
  steam: {
    id: "steam", label: "Steam", color: "#66c0f4",
    daily_cap_usdc: 45, min_bid_usdc: 0.40, max_bid_usdc: 4.00, always_bid_floor: false,
    persona_slug: "Gamer-nativo y técnico. Contextos de gaming intenso.",
    tracking_url: "https://store.steampowered.com/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "clutch", "new_game", "rage", "victory"],
    safety_keywords: ["muerte", "violencia_real", "drogas"],
  },
  rappi: {
    id: "rappi", label: "Rappi Argentina", color: "#ff441f",
    daily_cap_usdc: 35, min_bid_usdc: 0.25, max_bid_usdc: 2.50, always_bid_floor: false,
    persona_slug: "Urgente y conveniente. Momentos de pausa y snack.",
    tracking_url: "https://rappi.com.ar/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["bottom_right_corner"],
    target_moods: ["idle", "calm", "chat_active", "casual"],
    safety_keywords: ["muerte", "violencia", "drogas"],
  },
  globant: {
    id: "globant", label: "Globant", color: "#b8d430",
    daily_cap_usdc: 30, min_bid_usdc: 0.30, max_bid_usdc: 3.00, always_bid_floor: false,
    persona_slug: "Tech-forward y aspiracional. Audiencias gamer-profesionales.",
    tracking_url: "https://globant.com/addie",
    allowed_zones: ["lower_third", "bottom_right_corner"],
    preferred_zones: ["lower_third"],
    target_moods: ["high_energy", "clutch", "victory", "technical"],
    safety_keywords: ["muerte", "violencia", "drogas", "discriminacion"],
  },
  cocacola: {
    id: "cocacola", label: "Coca-Cola Argentina", color: "#f40009",
    daily_cap_usdc: 80, min_bid_usdc: 1.00, max_bid_usdc: 8.00, always_bid_floor: false,
    persona_slug: "Clásico y celebratorio. Los momentos más épicos del stream.",
    tracking_url: "https://coca-cola.com.ar/addie",
    allowed_zones: ["lower_third", "fullscreen_takeover"],
    preferred_zones: ["fullscreen_takeover"],
    target_moods: ["celebration", "victory", "high_energy", "goal"],
    safety_keywords: ["muerte", "violencia", "drogas", "menores", "insulto_grave"],
  },
};

const AD_VARIANTS = [
  { name: "epic_goal_lower",  zone: "lower_third",         duration_ms: 6000,  mood_tags: ["high_energy", "celebration", "victory"] },
  { name: "premium_takeover", zone: "fullscreen_takeover", duration_ms: 30000, mood_tags: ["storytelling", "brand_moment"] },
  { name: "persistent_logo",  zone: "bottom_right_corner", duration_ms: 60000, mood_tags: ["any"] },
  { name: "calm_chat_lower",  zone: "lower_third",         duration_ms: 5000,  mood_tags: ["calm", "chat_active"] },
];

const ZONE_LABELS: Record<string, string> = {
  lower_third: "Lower Third",
  bottom_right_corner: "Corner",
  fullscreen_takeover: "Fullscreen",
};

const ZONE_COLORS: Record<string, string> = {
  lower_third:         "bg-[#6366f1]/15 text-[#6366f1] border-[#6366f1]/30",
  bottom_right_corner: "bg-[#22d3ee]/15 text-[#22d3ee] border-[#22d3ee]/30",
  fullscreen_takeover: "bg-[#f59e0b]/15 text-[#f59e0b] border-[#f59e0b]/30",
};

const EMPTY_STATS: BrandStats = { impressions: 0, spend_usdc: 0, win_rate: 0, placements: 0 };

// ─── Mandate editor state ─────────────────────────────────────────────

interface MandateState {
  daily_cap_usdc: number;
  min_bid_usdc: number;
  max_bid_usdc: number;
  safety_keywords: string[];
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  saveError: boolean;
}

type MandateAction =
  | { type: "SET_DAILY_CAP"; value: number }
  | { type: "SET_MIN_BID"; value: number }
  | { type: "SET_MAX_BID"; value: number }
  | { type: "ADD_KW"; kw: string }
  | { type: "REMOVE_KW"; kw: string }
  | { type: "SET_SAVING" }
  | { type: "SET_SAVED" }
  | { type: "SET_ERROR" };

function mandateReducer(state: MandateState, action: MandateAction): MandateState {
  const touch = { dirty: true, saved: false, saveError: false };
  switch (action.type) {
    case "SET_DAILY_CAP": return { ...state, ...touch, daily_cap_usdc: action.value };
    case "SET_MIN_BID":   return { ...state, ...touch, min_bid_usdc: action.value };
    case "SET_MAX_BID":   return { ...state, ...touch, max_bid_usdc: action.value };
    case "ADD_KW":
      if (!action.kw || state.safety_keywords.includes(action.kw)) return state;
      return { ...state, ...touch, safety_keywords: [...state.safety_keywords, action.kw] };
    case "REMOVE_KW":
      return { ...state, ...touch, safety_keywords: state.safety_keywords.filter((k) => k !== action.kw) };
    case "SET_SAVING": return { ...state, saving: true, saveError: false };
    case "SET_SAVED":  return { ...state, saving: false, saved: true, dirty: false };
    case "SET_ERROR":  return { ...state, saving: false, saveError: true };
  }
}

// ─── Main component ───────────────────────────────────────────────────

type Tab = "overview" | "library" | "mandate";

export default function BrandConsoleClient({ brandId, initial }: { brandId: string; initial?: BrandInitial }) {
  const brand = BRAND_REGISTRY[brandId];
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const mandate = initial?.mandate ?? null;

  if (!brand) {
    return (
      <div className="min-h-screen bg-[var(--page)] text-[var(--text)] flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-[var(--text-3)] text-sm">Brand not found: <code className="text-[#ef4444]">{brandId}</code></p>
          <Link href="/" className="mt-4 inline-block text-xs text-[#6366f1] hover:underline">← Back to Addie</Link>
        </div>
      </div>
    );
  }

  const stats = initial?.stats ?? EMPTY_STATS;

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      {/* ── Header ── */}
      <div className="border-b border-[var(--line)] bg-[var(--page-2)]">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-[var(--text-3)] hover:text-[var(--text-2)] text-xs transition-colors">← Addie</Link>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <span className="w-4 h-4 rounded-full shrink-0" style={{ background: brand.color }} />
            <h1 className="text-xl font-bold text-[var(--text)]">{brand.label}</h1>
            {brand.always_bid_floor && (
              <span className="text-[10px] bg-[#22d3ee]/15 text-[#22d3ee] border border-[#22d3ee]/30 rounded px-1.5 py-0.5 font-medium">
                DEFAULT BIDDER
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-3)] mt-1 ml-7">{brand.persona_slug}</p>

          <div className="ml-7 mt-3 flex items-center gap-6">
            <BalanceItem label="Balance" value="$5.00" sub="USDC" valueClass="text-[#22c55e]" />
            <BalanceItem label="Spent today" value={`$${stats.spend_usdc.toFixed(2)}`} sub="USDC" />
            <BalanceItem label="Daily cap" value={`$${(mandate?.daily_cap_usdc ?? brand.daily_cap_usdc).toFixed(2)}`} sub="USDC" />
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex gap-1">
            {(["overview", "library", "mandate"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-[#6366f1] text-[var(--text)]"
                    : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {tab === "library" ? "Ad Library" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-3xl mx-auto px-6 py-6">
        {activeTab === "overview" && <OverviewTab brand={brand} stats={stats} mandate={mandate} />}
        {activeTab === "library" && <LibraryTab brand={brand} ads={initial?.ads} />}
        {activeTab === "mandate" && <MandateTab brand={brand} mandate={mandate} />}
      </div>
    </div>
  );
}

function BalanceItem({ label, value, sub, valueClass = "text-[var(--text)]" }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium">{label}</span>
      <p className={`text-base font-semibold font-mono ${valueClass}`}>
        {value}
        {sub && <span className="text-xs font-normal text-[var(--text-3)] ml-1">{sub}</span>}
      </p>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────

function OverviewTab({
  brand,
  stats,
  mandate,
}: {
  brand: BrandMeta;
  stats: BrandStats;
  mandate: BrandMandateData | null;
}) {
  const safetyKeywords = mandate?.safety_keywords ?? brand.safety_keywords;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Placements"  value={String(stats.placements)} />
        <StatCard label="QR scans"    value={stats.impressions.toLocaleString()} />
        <StatCard label="Total spend" value={`$${stats.spend_usdc.toFixed(2)}`} sub="USDC" />
        <StatCard label="Win rate"    value={stats.placements > 0 ? `${Math.round(stats.win_rate * 100)}%` : "—"} />
      </div>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">Targeting</h2>
        </div>
        <div className="p-5 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium mb-2">Allowed zones</p>
            <div className="flex flex-wrap gap-1.5">
              {brand.allowed_zones.map((z) => (
                <span key={z} className={`text-[10px] border rounded px-2 py-0.5 font-medium ${ZONE_COLORS[z] ?? "bg-[var(--card-2)] text-[var(--text-2)]"}`}>
                  {ZONE_LABELS[z] ?? z}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium mb-2">Target moods</p>
            <div className="flex flex-wrap gap-1.5">
              {brand.target_moods.slice(0, 5).map((m) => (
                <span key={m} className="text-[10px] bg-[var(--card-2)] text-[var(--text-2)] rounded px-2 py-0.5 font-mono">{m}</span>
              ))}
              {brand.target_moods.length > 5 && (
                <span className="text-[10px] text-[var(--text-3)]">+{brand.target_moods.length - 5} more</span>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium mb-2">Preferred zones</p>
          <div className="flex flex-wrap gap-1.5">
            {brand.preferred_zones.map((z) => (
              <span key={z} className={`text-[10px] border rounded px-2 py-0.5 font-medium ${ZONE_COLORS[z] ?? ""}`}>
                {ZONE_LABELS[z] ?? z} ★
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">Brand-safety keywords</h2>
          <p className="text-xs text-[var(--text-3)] mt-0.5">Triggers automatic escrow refund mid-placement.</p>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-1.5">
          {safetyKeywords.map((kw) => (
            <span key={kw} className="text-[10px] bg-[#ef4444]/10 border border-[#ef4444]/25 text-[#ef4444] rounded px-2 py-0.5 font-mono">{kw}</span>
          ))}
        </div>
      </section>

      <p className="text-xs text-[var(--text-5)]">
        Stats are aggregated from the placements table. Spend counts locked/rendered placements only.
      </p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium mb-1">{label}</p>
      <p className="text-xl font-bold text-[var(--text)] font-mono leading-none">
        {value}
        {sub && <span className="text-xs font-normal text-[var(--text-3)] ml-1">{sub}</span>}
      </p>
    </div>
  );
}

// ─── Ad Library tab ───────────────────────────────────────────────────

function LibraryTab({ brand, ads }: { brand: BrandMeta; ads?: AdRow[] }) {
  const hasRealAds = ads && ads.length > 0;

  if (!hasRealAds) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[var(--text-3)]">
          4 variants pre-generated per brand. Assets seeded by D-10 (ElevenLabs Creative + Vercel Blob).
        </p>
        <div className="flex flex-col gap-3">
          {AD_VARIANTS.map((ad) => {
            const zoneOk = brand.allowed_zones.includes(ad.zone);
            const preferred = brand.preferred_zones.includes(ad.zone);
            return (
              <div
                key={ad.name}
                className={`rounded-xl border bg-[var(--card)] overflow-hidden ${zoneOk ? "border-[var(--line)]" : "border-[var(--line-2)] opacity-50"}`}
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  <div
                    className="w-16 h-10 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-mono text-[var(--text-4)] border"
                    style={{
                      background: zoneOk ? `${brand.color}18` : "var(--card-2)",
                      borderColor: zoneOk ? `${brand.color}30` : "var(--line-2)",
                    }}
                  >
                    {zoneOk ? "PLACEHOLDER" : "N/A"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--text)] font-mono">{ad.name}</span>
                      <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${ZONE_COLORS[ad.zone] ?? ""}`}>
                        {ZONE_LABELS[ad.zone]}
                      </span>
                      {preferred && <span className="text-[10px] bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/25 rounded px-1.5 py-0.5">preferred</span>}
                      {!zoneOk && <span className="text-[10px] bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/25 rounded px-1.5 py-0.5">zone excluded</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--text-3)]">{(ad.duration_ms / 1000).toFixed(0)}s</span>
                      <div className="flex gap-1">
                        {ad.mood_tags.map((t) => (
                          <span key={t} className="text-[10px] font-mono text-[var(--text-4)] bg-[var(--card-2)] rounded px-1.5 py-0.5">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-xs text-[var(--text-4)]">asset_url</span>
                    <p className="text-[10px] text-[var(--text-3)]">pending D-10</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--text-3)]">{ads.length} ad{ads.length !== 1 ? "s" : ""} in library.</p>
      <div className="flex flex-col gap-3">
        {ads.map((ad) => {
          const zoneOk = brand.allowed_zones.includes(ad.format);
          const preferred = brand.preferred_zones.includes(ad.format);
          return (
            <div
              key={ad.id}
              className={`rounded-xl border bg-[var(--card)] overflow-hidden ${zoneOk ? "border-[var(--line)]" : "border-[var(--line-2)] opacity-50"}`}
            >
              <div className="flex items-center gap-4 px-5 py-4">
                <div
                  className="w-16 h-10 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-mono text-[var(--text-4)] border"
                  style={{ background: `${brand.color}18`, borderColor: `${brand.color}30` }}
                >
                  {ad.asset_type.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--text)] font-mono">{ad.variant_name}</span>
                    <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${ZONE_COLORS[ad.format] ?? "bg-[var(--card-2)] text-[var(--text-2)]"}`}>
                      {ZONE_LABELS[ad.format] ?? ad.format}
                    </span>
                    {preferred && <span className="text-[10px] bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/25 rounded px-1.5 py-0.5">preferred</span>}
                    {!zoneOk && <span className="text-[10px] bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/25 rounded px-1.5 py-0.5">zone excluded</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    {ad.duration_ms && <span className="text-xs text-[var(--text-3)]">{(ad.duration_ms / 1000).toFixed(0)}s</span>}
                    <div className="flex gap-1">
                      {ad.mood_tags.map((t) => (
                        <span key={t} className="text-[10px] font-mono text-[var(--text-4)] bg-[var(--card-2)] rounded px-1.5 py-0.5">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <a href={ad.asset_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#6366f1] hover:underline">
                    asset ↗
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mandate tab ──────────────────────────────────────────────────────

function MandateTab({ brand, mandate }: { brand: BrandMeta; mandate?: BrandMandateData | null }) {
  const [state, dispatch] = useReducer(mandateReducer, {
    daily_cap_usdc: mandate?.daily_cap_usdc ?? brand.daily_cap_usdc,
    min_bid_usdc: mandate?.min_bid_usdc ?? brand.min_bid_usdc,
    max_bid_usdc: mandate?.max_bid_usdc ?? brand.max_bid_usdc,
    safety_keywords: mandate?.safety_keywords ?? [...brand.safety_keywords],
    dirty: false,
    saving: false,
    saved: true,
    saveError: false,
  });

  const kwRef = useRef<HTMLInputElement>(null);
  const [kwDraft, setKwDraft] = useState("");

  const addKw = useCallback(() => {
    const kw = kwDraft.trim().toLowerCase();
    if (!kw) return;
    dispatch({ type: "ADD_KW", kw });
    setKwDraft("");
    kwRef.current?.focus();
  }, [kwDraft]);

  async function save() {
    dispatch({ type: "SET_SAVING" });
    try {
      await fetch(`/api/brands/${brand.id}/mandate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daily_cap_usdc: state.daily_cap_usdc,
          min_bid_usdc: state.min_bid_usdc,
          max_bid_usdc: state.max_bid_usdc,
          safety_keywords: state.safety_keywords,
        }),
      });
      dispatch({ type: "SET_SAVED" });
    } catch {
      dispatch({ type: "SET_ERROR" });
    }
  }

  const invalid = state.min_bid_usdc > state.max_bid_usdc;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-[var(--text-3)]">
        Mandate constrains the brand-agent autonomy. Changes take effect on the next auction round.
      </p>

      {/* Budget */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">Budget constraints</h2>
          {brand.always_bid_floor && (
            <p className="text-xs text-[#22d3ee] mt-0.5">Default bidder — always bids exactly min_bid at floor.</p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-px bg-[var(--card-3)]">
          <BudgetField label="Daily cap" value={state.daily_cap_usdc} onChange={(v) => dispatch({ type: "SET_DAILY_CAP", value: v })} />
          <BudgetField label="Min bid"   value={state.min_bid_usdc}   onChange={(v) => dispatch({ type: "SET_MIN_BID",   value: v })} step={0.05} />
          <BudgetField label="Max bid"   value={state.max_bid_usdc}   onChange={(v) => dispatch({ type: "SET_MAX_BID",   value: v })} step={0.25} />
        </div>
        {invalid && <p className="px-5 py-2 text-xs text-[#ef4444]">min_bid cannot exceed max_bid</p>}
      </section>

      {/* Safety keywords */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">Brand-safety keywords</h2>
          <p className="text-xs text-[var(--text-3)] mt-0.5">Detected in audio or chat → automatic escrow refund.</p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              ref={kwRef}
              type="text"
              value={kwDraft}
              onChange={(e) => setKwDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addKw()}
              placeholder="Add keyword…"
              className="flex-1 rounded-lg bg-[var(--page-2)] border border-[var(--line)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
            <button
              onClick={addKw}
              disabled={!kwDraft.trim()}
              className="px-4 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
            >
              Add
            </button>
          </div>
          {state.safety_keywords.length === 0 ? (
            <p className="text-xs text-[var(--text-4)] italic">No keywords set.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {state.safety_keywords.map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1 rounded-md bg-[#ef4444]/10 border border-[#ef4444]/25 text-[#ef4444] text-xs px-2.5 py-1 font-mono">
                  {kw}
                  <button onClick={() => dispatch({ type: "REMOVE_KW", kw })} className="ml-0.5 text-[#ef4444]/60 hover:text-[#ef4444] transition-colors leading-none" aria-label={`Remove ${kw}`}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={state.saving || !state.dirty || invalid}
          className="px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
        >
          {state.saving ? "Saving…" : "Save changes"}
        </button>
        {state.saved && !state.dirty && <span className="text-xs text-[#22c55e]">✓ Saved</span>}
        {state.saveError && <span className="text-xs text-[#ef4444]">Save failed — check server</span>}
      </div>
    </div>
  );
}

function BudgetField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="bg-[var(--card)] px-5 py-3 flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-medium">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-3)] text-sm">$</span>
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 0) onChange(v);
          }}
          className="w-20 bg-transparent text-base font-semibold text-[#22d3ee] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-xs text-[var(--text-4)]">USDC</span>
      </div>
    </label>
  );
}
