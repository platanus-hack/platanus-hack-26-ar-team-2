import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--page)] text-[var(--text)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">

        <div className="mb-12 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Addie</h1>
            <p className="text-[var(--text-2)] mt-1 text-sm">
              Brand agents bid for epic stream moments · USDC on-chain
            </p>
          </div>
          <ThemeToggle className="mt-1" />
        </div>

        <div className="flex flex-col gap-4">
          <Link
            href="/dashboard/influencer"
            className="group flex items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 py-6 hover:border-[#6366f1]/60 hover:bg-[var(--card-2)] transition-all"
          >
            <div className="flex items-center gap-4">
              <span className="text-3xl">🎮</span>
              <div>
                <p className="text-lg font-semibold">Influencer</p>
                <p className="text-sm text-[var(--text-3)]">Streamer dashboard · manage zones & brands</p>
              </div>
            </div>
            <span className="text-[var(--line)] group-hover:text-[#6366f1] transition-colors text-xl">→</span>
          </Link>

          <Link
            href="/dashboard/brand"
            className="group flex items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 py-6 hover:border-[#22d3ee]/60 hover:bg-[var(--card-2)] transition-all"
          >
            <div className="flex items-center gap-4">
              <span className="text-3xl">📣</span>
              <div>
                <p className="text-lg font-semibold">Brand</p>
                <p className="text-sm text-[var(--text-3)]">Brand dashboard · mandate, budget & ads</p>
              </div>
            </div>
            <span className="text-[var(--line)] group-hover:text-[#22d3ee] transition-colors text-xl">→</span>
          </Link>
        </div>

        <p className="text-center text-xs text-[var(--text-5)] mt-10">
          Platanus Hack BSAS 2026 · Track 🤑 Agentic Money
        </p>
      </div>
    </main>
  );
}
