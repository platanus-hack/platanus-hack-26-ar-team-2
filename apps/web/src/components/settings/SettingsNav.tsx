"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/inventory", label: "Inventory" },
];

export default function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 mb-6 border-b border-[var(--line)] pb-3">
      {NAV.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              active
                ? "bg-[#6366f1]/15 text-[var(--text)] font-medium"
                : "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--card-2)]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
