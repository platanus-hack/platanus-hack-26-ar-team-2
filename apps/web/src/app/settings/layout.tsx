import SettingsNav from "@/components/settings/SettingsNav";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = { title: "Addie — Settings" };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)] p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <a href="/" className="text-[var(--text-3)] hover:text-[var(--text-2)] text-sm transition-colors">← Addie</a>
          <ThemeToggle />
        </div>
        <h1 className="text-xl font-bold mb-1 text-[var(--text)]">Settings</h1>
        <SettingsNav />
        {children}
      </div>
    </div>
  );
}
