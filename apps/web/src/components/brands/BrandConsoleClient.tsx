"use client";

import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import type { AdRow } from "@/lib/db";
import { getBrand, type Brand } from "@/lib/brands";
import { truncateAddress, basescanUrl } from "@/lib/format";

export type BrandInitial = {
  ads: AdRow[];
  wallet_address?: string | null;
};

export type BrandMeta = Brand;

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

export default function BrandConsoleClient({ brandId, initial }: { brandId: string; initial?: BrandInitial }) {
  const brand = getBrand(brandId);

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

  const ads = initial?.ads ?? [];

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      {/* Header */}
      <div className="border-b border-[var(--line)] bg-[var(--page-2)]">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <Link href="/brand/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-2)] text-xs transition-colors">← Marcas</Link>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <span className="w-4 h-4 rounded-full shrink-0" style={{ background: brand.brand_color }} />
            <h1 className="text-xl font-bold">{brand.display_name}</h1>
            {initial?.wallet_address ? (
              <a
                href={basescanUrl(initial.wallet_address, "address")}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[10px] font-mono text-[var(--text-3)] hover:text-[#22d3ee] hover:underline transition-colors"
              >
                {truncateAddress(initial.wallet_address)} ↗
              </a>
            ) : (
              <span className="ml-auto text-[10px] text-[var(--text-4)]">wallet not provisioned</span>
            )}
          </div>
          <p className="text-xs text-[var(--text-3)] mt-1 ml-7">{brand.default_persona}</p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-6">

        {/* Targeting */}
        <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold">Targeting</h2>
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
        </section>

        {/* Ad library */}
        <section>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] font-medium mb-3">Ad library</p>
          <div className="flex flex-col gap-3">
            {(ads.length > 0 ? ads.map((ad) => ({
              name: ad.variant_name,
              zone: ad.format,
              duration_ms: ad.duration_ms ?? 0,
              mood_tags: ad.mood_tags,
              asset_url: ad.asset_url,
            })) : AD_VARIANTS).map((ad) => {
              const zoneOk = brand.allowed_zones.includes(ad.zone);
              const preferred = brand.preferred_zones.includes(ad.zone);
              return (
                <div
                  key={ad.name}
                  className={`rounded-xl border bg-[var(--card)] overflow-hidden ${zoneOk ? "border-[var(--line)]" : "border-[var(--line-2)] opacity-40"}`}
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div
                      className="w-16 h-10 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-mono text-[var(--text-4)] border"
                      style={{
                        background: zoneOk ? `${brand.brand_color}18` : "var(--card-2)",
                        borderColor: zoneOk ? `${brand.brand_color}30` : "var(--line-2)",
                      }}
                    >
                      AD
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium font-mono">{ad.name}</span>
                        <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${ZONE_COLORS[ad.zone] ?? ""}`}>
                          {ZONE_LABELS[ad.zone] ?? ad.zone}
                        </span>
                        {preferred && <span className="text-[10px] bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/25 rounded px-1.5 py-0.5">preferred</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-[var(--text-3)]">{(ad.duration_ms / 1000).toFixed(0)}s</span>
                        <div className="flex gap-1 flex-wrap">
                          {ad.mood_tags.map((t) => (
                            <span key={t} className="text-[10px] font-mono text-[var(--text-4)] bg-[var(--card-2)] rounded px-1.5 py-0.5">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
