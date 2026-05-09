/**
 * Better Auth catch-all route. Handles every /api/auth/* path
 * (signin, signup, signout, session, callback, etc.) by delegating
 * to the Better Auth handler.
 */

import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth.handler);
