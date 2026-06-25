-- Owner-managed CMS bearer tokens (the Control Center "API Keys" section).
--
-- Replaces the Supabase cms_api_keys table. Read-only bearer tokens for
-- external integrations (a public family website, a CMS, a print-book
-- generator). We store only a SHA-256 hash of the token plus a short prefix
-- used as a display identifier — never the plaintext, which is shown once at
-- creation. Revocation is soft (revoked_at stamp) to preserve the audit trail.
--
-- NOTE: the public read API that CONSUMES these tokens (the legacy
-- supabase/functions/cms-viewer-api edge function) is not yet reimplemented on
-- Express, so tokens created here are stored but not yet consumable end-to-end.

create table if not exists cms_api_keys (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{read_recipes}',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The common read: a household's keys, newest first.
create index if not exists cms_api_keys_household_idx
  on cms_api_keys (household_id, created_at desc);

-- Token validation lookup (used by the future public read API).
create index if not exists cms_api_keys_token_hash_idx
  on cms_api_keys (token_hash);
