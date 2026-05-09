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

const BRANDS = [
  { id: "adidas",   label: "Adidas",       color: "#e8e8e8" },
  { id: "nike",     label: "Nike",         color: "#ff6600" },
  { id: "quilmes",  label: "Quilmes",      color: "#f5c400" },
  { id: "mp",       label: "Mercado Pago", color: "#009ee3" },
  { id: "steam",    label: "Steam",        color: "#66c0f4" },
  { id: "rappi",    label: "Rappi",        color: "#ff441f" },
  { id: "globant",  label: "Globant",      color: "#b8d430" },
  { id: "cocacola", label: "Coca-Cola",    color: "#f40009" },
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

        {/* Brand consoles */}
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-wider text-[#3a3a4a] font-medium mb-2">Brand consoles</p>
          <div className="grid grid-cols-4 gap-1.5">
            {BRANDS.map((b) => (
              <Link
                key={b.id}
                href={`/brands/${b.id}`}
                className="group flex items-center gap-2 rounded-lg border border-[#1e1e2a] bg-[#0d0d14] px-3 py-2 hover:border-[#2a2a38] hover:bg-[#111118] transition-all"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                <span className="text-xs text-[#55556a] group-hover:text-[#9090a8] truncate transition-colors">{b.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-[#2a2a38] mt-8">
          Platanus Hack BSAS 2026 · Track 🤑 Agentic Money
        </p>
      </div>
    </main>
  );
}
