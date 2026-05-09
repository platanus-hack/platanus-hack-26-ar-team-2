import Link from "next/link";

export const metadata = { title: "Addie — Settings" };

const NAV = [
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/inventory", label: "Inventory" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f0f0f5] p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-1 text-[#f0f0f5]">Settings</h1>
        <nav className="flex gap-1 mb-6 border-b border-[#2a2a38] pb-3">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 rounded text-sm text-[#9090a8] hover:text-[#f0f0f5] hover:bg-[#1a1a24] transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
