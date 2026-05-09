import SettingsNav from "@/components/settings/SettingsNav";

export const metadata = { title: "Addie — Settings" };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f0f0f5] p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <a href="/" className="text-[#55556a] hover:text-[#9090a8] text-sm transition-colors">← Addie</a>
        </div>
        <h1 className="text-xl font-bold mb-1 text-[#f0f0f5]">Settings</h1>
        <SettingsNav />
        {children}
      </div>
    </div>
  );
}
