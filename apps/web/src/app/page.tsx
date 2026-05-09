import Link from "next/link";

const PAGES = [
  {
    href: "/demo-display?demo=1",
    label: "Demo Display",
    description: "Bid leaderboard · negotiation chat · tx feed",
    tag: "DEMO",
    tagColor: "bg-[#6366f1]/20 text-[#6366f1] border-[#6366f1]/30",
  },
  {
    href: "/dock?demo=1",
    label: "Streamer Dock",
    description: "Balance · recent placements · FORCE EVENT / FULL BREAK",
    tag: "OBS",
    tagColor: "bg-[#22d3ee]/20 text-[#22d3ee] border-[#22d3ee]/30",
  },
  {
    href: "/overlay/test-stream",
    label: "Overlay",
    description: "Browser Source transparente para OBS",
    tag: "OBS",
    tagColor: "bg-[#22d3ee]/20 text-[#22d3ee] border-[#22d3ee]/30",
  },
  {
    href: "/settings/preferences",
    label: "Preferences",
    description: "Brands aprobadas · brand-safety keywords",
    tag: "SETTINGS",
    tagColor: "bg-[#9090a8]/20 text-[#9090a8] border-[#9090a8]/30",
  },
  {
    href: "/settings/inventory",
    label: "Inventory",
    description: "Zonas · floors · max duration",
    tag: "SETTINGS",
    tagColor: "bg-[#9090a8]/20 text-[#9090a8] border-[#9090a8]/30",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] text-[#f0f0f5] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Logo / wordmark */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-[#f0f0f5]">
            Addie
          </h1>
          <p className="text-[#9090a8] mt-1 text-sm">
            Agentic ad-tech para streams en vivo · Base · USDC
          </p>
        </div>

        {/* Nav cards */}
        <nav className="flex flex-col gap-2">
          {PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group flex items-center justify-between rounded-xl border border-[#2a2a38] bg-[#111118] px-4 py-3.5 hover:border-[#6366f1]/50 hover:bg-[#1a1a28] transition-all"
            >
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-[#f0f0f5] group-hover:text-white">
                    {p.label}
                  </span>
                  <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${p.tagColor}`}>
                    {p.tag}
                  </span>
                </div>
                <p className="text-xs text-[#55556a]">{p.description}</p>
              </div>
              <span className="text-[#2a2a38] group-hover:text-[#6366f1] transition-colors text-lg">→</span>
            </Link>
          ))}
        </nav>

        <p className="text-center text-xs text-[#2a2a38] mt-8">
          Platanus Hack BSAS 2026 · Track 🤑 Agentic Money
        </p>
      </div>
    </main>
  );
}
