/**
 * Better Auth server config.
 *
 * Talks to Postgres via the same Supabase POSTGRES_URL_NON_POOLING the
 * migrations use (sslmode-stripped + rejectUnauthorized:false to handle
 * Supabase's cert chain).
 *
 * Tables are prefixed `auth_` to avoid colliding with our business
 * `accounts` table and the Postgres-reserved word `user`. See
 * supabase/migrations/0006_auth.sql.
 *
 * Methods enabled in MVP:
 *   - email + password (no email verification, no password reset yet)
 *
 * NOT yet enabled (see TODO):
 *   - Magic link / email OTP
 *   - Social OAuth (Google, Twitch)
 *   - Password reset
 */

import { betterAuth } from "better-auth";
import { Pool } from "pg";

function buildConnectionString(): string {
  const raw = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!raw) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING missing. Run `vercel env pull apps/web/.env.local` from apps/web/.",
    );
  }
  // Supabase serves a valid cert from a chain that pg's strict default
  // (sslmode=require → verify-full) can't validate without the Supabase root.
  // Strip sslmode + supa params; pass rejectUnauthorized:false explicitly below.
  const u = new URL(raw);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("supa");
  return u.toString();
}

const pool = new Pool({
  connectionString: buildConnectionString(),
  ssl: { rejectUnauthorized: false },
});

export const auth = betterAuth({
  database: pool,
  // Override default table names + map camelCase JS fields to snake_case
  // SQL columns. See supabase/migrations/0006_auth.sql for column names.
  user: {
    modelName: "auth_user",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  account: {
    modelName: "auth_account",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "auth_verification",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "auth_session",
    fields: {
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh if older than 24h
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5min
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // MVP — skip email verify
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  // Cookies/CSRF/origin defaults are sane for same-origin Next.js. If we
  // start serving the auth API from a different origin than the UI, set
  // `trustedOrigins` here.
});

export type Session = typeof auth.$Infer.Session;
