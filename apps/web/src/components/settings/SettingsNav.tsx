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
    <nav className="flex gap-1 mb-6 border-b border-[#2a2a38] pb-3">
      {NAV.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              active
                ? "bg-[#6366f1]/15 text-[#f0f0f5] font-medium"
                : "text-[#9090a8] hover:text-[#f0f0f5] hover:bg-[#1a1a24]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
