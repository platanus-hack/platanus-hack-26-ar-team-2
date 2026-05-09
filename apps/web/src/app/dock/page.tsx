import DockClient from "@/components/dock/DockClient";

export default function DockPage() {
  // onBalance / onPlacement / onStatusChange wired in I-01 once A-08 + Supabase Realtime are ready
  return (
    <main className="p-0">
      <DockClient />
    </main>
  );
}
