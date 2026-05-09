"use client";

import { useRouter } from "next/navigation";

import { signOut } from "@/lib/auth-client";

export default function DashboardClient() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded border border-current/30 px-3 py-1.5 text-sm transition hover:bg-foreground/5"
    >
      Cerrar sesión
    </button>
  );
}
