/**
 * Better Auth React client. Use from Client Components / browser code.
 *
 * Imports from `better-auth/react` so React hooks (useSession, etc.)
 * work without leaking server-side code into the bundle.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Same-origin in dev (next dev) and prod (Vercel). Override here only
  // if the auth API is hosted on a different domain than the UI.
  // baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
