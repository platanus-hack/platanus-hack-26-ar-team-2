import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { BRANDS } from "@/lib/brands";

export default function BrandDashboard() {
  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      <div className="border-b border-[var(--line)] bg-[var(--page-2)]">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <Link href="/" className="text-[var(--text-3)] hover:text-[var(--text-2)] text-xs transition-colors">← Addie</Link>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-lg">📣</span>
              <h1 className="text-xl font-bold">Panel de Marca</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] font-medium mb-1">Seleccioná tu marca</p>
        {BRANDS.map((brand) => (
          <Link
            key={brand.id}
            href={`/brand/${brand.id}`}
            className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3.5 hover:border-[#22d3ee]/50 hover:bg-[var(--card-2)] transition-all"
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: brand.brand_color }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{brand.display_name}</p>
              <p className="text-[10px] text-[var(--text-3)] truncate mt-0.5">{brand.default_persona}</p>
            </div>
            <span className="text-[var(--line)] group-hover:text-[#22d3ee] transition-colors shrink-0">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
