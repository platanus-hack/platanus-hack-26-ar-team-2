-- 0006_auth.sql — Better Auth (https://www.better-auth.com) tables
--
-- All Better Auth tables prefixed with `auth_` because:
--   - `user` is a Postgres reserved word (would need quoting everywhere)
--   - `account` collides with our existing business `accounts` table
--
-- Better Auth config in apps/web/src/lib/auth.ts overrides table names
-- to match (user.modelName="auth_user", session.modelName="auth_session", etc.)
--
-- Identity model:
--   auth_user        = a person who can sign in (email + password in MVP)
--   accounts         = a business entity (brand, creator, platform) — separate
--                      from identity; one user can own/manage multiple accounts.
--   accounts.owner_user_id → auth_user(id), nullable for legacy / seed data.

-- ─── auth_user ───────────────────────────────────────────────────────
-- Better Auth uses TEXT primary keys (typically UUID-as-text or nanoid).
create table auth_user (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auth_user_email_idx on auth_user(email);

-- ─── auth_session ────────────────────────────────────────────────────
create table auth_session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  ip_address text,
  user_agent text,
  user_id text not null references auth_user(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auth_session_user_id_idx on auth_session(user_id);
create index auth_session_token_idx on auth_session(token);

-- ─── auth_account ────────────────────────────────────────────────────
-- Holds OAuth provider tokens AND the password-credential hash for
-- email+password users (provider_id='credential', password=bcrypt hash).
create table auth_account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references auth_user(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auth_account_user_id_idx on auth_account(user_id);
create unique index auth_account_provider_unique
  on auth_account(provider_id, account_id);

-- ─── auth_verification ───────────────────────────────────────────────
-- Holds magic-link / email-verify tokens. Empty in MVP (no email verify).
create table auth_verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index auth_verification_identifier_idx on auth_verification(identifier);

-- ─── link business accounts to auth users ────────────────────────────
-- Existing rows have NULL owner; seeded accounts get a real user_id later.
alter table accounts add column if not exists owner_user_id text references auth_user(id) on delete set null;
create index if not exists accounts_owner_user_id_idx on accounts(owner_user_id);

comment on column accounts.owner_user_id is
  'Auth user that manages this business account. Nullable for seed data and platform-owned accounts. See auth_user.';
