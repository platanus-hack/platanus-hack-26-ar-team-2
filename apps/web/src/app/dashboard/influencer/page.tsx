import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function InfluencerDashboard() {
  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <div className="border-b border-[var(--line)] bg-[var(--page-2)]">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <Link href="/" className="text-[var(--text-3)] hover:text-[var(--text-2)] text-xs transition-colors">← Addie</Link>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-lg">🎮</span>
              <h1 className="text-xl font-bold">Influencer Dashboard</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-3">
        {[
          { href: "/dock?demo=1",          label: "Streamer Dock",  desc: "Balance · placements · hotkeys" },
          { href: "/settings/preferences", label: "Preferences",    desc: "Approved brands · safety keywords" },
          { href: "/settings/inventory",   label: "Inventory",      desc: "Zones · floor prices · max duration" },
          { href: "/demo-display?demo=1",  label: "Demo Display",   desc: "Bid leaderboard · negotiation chat" },
          { href: "/overlay/test-stream",  label: "Overlay",        desc: "Browser Source transparente para OBS" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 hover:border-[#6366f1]/50 hover:bg-[var(--card-2)] transition-all"
          >
            <div>
              <p className="font-medium text-sm">{item.label}</p>
              <p className="mt-0.5 text-xs text-[var(--text-3)]">{item.desc}</p>
            </div>
            <span className="text-[var(--line)] group-hover:text-[#6366f1] transition-colors">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
