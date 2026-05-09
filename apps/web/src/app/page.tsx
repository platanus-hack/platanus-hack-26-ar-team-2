import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

const PAGES = [
  {
    href: "/demo-display?demo=1",
    label: "Demo Display",
    description: "Bid leaderboard · negotiation chat · tx feed",
    tag: "DEMO",
    tagColor: "bg-[#6366f1]/15 text-[#6366f1] border-[#6366f1]/25",
  },
  {
    href: "/dock?demo=1",
    label: "Streamer Dock",
    description: "Balance · recent placements · FORCE EVENT / FULL BREAK",
    tag: "OBS",
    tagColor: "bg-[#22d3ee]/15 text-[#22d3ee] border-[#22d3ee]/25",
  },
  {
    href: "/overlay/test-stream",
    label: "Overlay",
    description: "Browser Source transparente para OBS",
    tag: "OBS",
    tagColor: "bg-[#22d3ee]/15 text-[#22d3ee] border-[#22d3ee]/25",
  },
  {
    href: "/settings/preferences",
    label: "Preferences",
    description: "Brands aprobadas · brand-safety keywords",
    tag: "SETTINGS",
    tagColor: "bg-[var(--card-2)] text-[var(--text-2)] border-[var(--line)]",
  },
  {
    href: "/settings/inventory",
    label: "Inventory",
    description: "Zonas · floors · max duration",
    tag: "SETTINGS",
    tagColor: "bg-[var(--card-2)] text-[var(--text-2)] border-[var(--line)]",
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
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Header row */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--text)]">Addie</h1>
            <p className="text-[var(--text-2)] mt-1 text-sm">
              Agentic ad-tech para streams en vivo · Base · USDC
            </p>
          </div>
          <ThemeToggle className="mt-1" />
        </div>

        {/* Nav cards */}
        <nav className="flex flex-col gap-2">
          {PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 hover:border-[#6366f1]/50 hover:bg-[var(--card-2)] transition-all"
            >
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-[var(--text)] group-hover:text-[var(--text)]">
                    {p.label}
                  </span>
                  <span className={`text-[10px] border rounded px-1.5 py-0.5 font-medium ${p.tagColor}`}>
                    {p.tag}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-3)]">{p.description}</p>
              </div>
              <span className="text-[var(--line)] group-hover:text-[#6366f1] transition-colors text-lg">→</span>
            </Link>
          ))}
        </nav>

        {/* Brand consoles */}
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] font-medium mb-2">Brand consoles</p>
          <div className="grid grid-cols-4 gap-1.5">
            {BRANDS.map((b) => (
              <Link
                key={b.id}
                href={`/brands/${b.id}`}
                className="group flex items-center gap-2 rounded-lg border border-[var(--line-2)] bg-[var(--page-2)] px-3 py-2 hover:border-[var(--line)] hover:bg-[var(--card)] transition-all"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.color }} />
                <span className="text-xs text-[var(--text-3)] group-hover:text-[var(--text-2)] truncate transition-colors">{b.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text-5)] mt-8">
          Platanus Hack BSAS 2026 · Track 🤑 Agentic Money
        </p>
      </div>
    </main>
  );
}
