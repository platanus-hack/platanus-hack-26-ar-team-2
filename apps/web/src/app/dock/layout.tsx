export const metadata = { title: "Addie — Dock" };

export default function DockLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a0f] text-[#f0f0f5] min-h-screen overflow-x-hidden">
      {children}
    </div>
  );
}
