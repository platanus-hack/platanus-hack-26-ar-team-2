/**
 * Authenticated dashboard. Two layers of auth check:
 *   1. middleware.ts (cookie present) — fast, runs on every /dashboard/* request
 *   2. server-side getSession() here — real validation against DB session row
 *
 * If a session cookie exists but the underlying session is expired/revoked,
 * the middleware lets it through but this server-side check redirects.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import DashboardClient from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login?next=/dashboard");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm opacity-70">
            Hola <span className="font-medium">{session.user.name}</span>{" "}
            <span className="opacity-60">({session.user.email})</span>
          </p>
        </div>
        <DashboardClient />
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <a
          href="/dock"
          className="rounded border border-current/20 p-4 transition hover:bg-foreground/5"
        >
          <h2 className="font-medium">Creator Dock</h2>
          <p className="mt-1 text-sm opacity-70">
            Saldo + placements recientes + hotkeys (FORCE EVENT, FULL BREAK).
          </p>
        </a>
        <a
          href="/settings/inventory"
          className="rounded border border-current/20 p-4 transition hover:bg-foreground/5"
        >
          <h2 className="font-medium">Inventory</h2>
          <p className="mt-1 text-sm opacity-70">
            Zonas, floor prices, max duration por zona.
          </p>
        </a>
        <a
          href="/settings/preferences"
          className="rounded border border-current/20 p-4 transition hover:bg-foreground/5"
        >
          <h2 className="font-medium">Preferences</h2>
          <p className="mt-1 text-sm opacity-70">
            Brands aprobadas y brand-safety keywords.
          </p>
        </a>
        <a
          href="/brands/adidas"
          className="rounded border border-current/20 p-4 transition hover:bg-foreground/5"
        >
          <h2 className="font-medium">Brand consoles</h2>
          <p className="mt-1 text-sm opacity-70">
            Ad library, mandate, performance. (Demo: adidas, mp.)
          </p>
        </a>
      </section>
    </main>
  );
}
