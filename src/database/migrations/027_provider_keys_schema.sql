-- Platform-managed LLM provider API keys — encrypted at rest.
--
-- Replaces the Supabase v19 tables platform_provider_keys (one row per cloud
-- provider) and committee_member_keys (one row per Care Team specialist). Both
-- collapse into a single table here because the storage shape is identical: an
-- encrypted secret + who set it. The `scope` column distinguishes them:
--
--   scope = 'provider'       -> provider-wide key (roster_member_id NULL)
--   scope = 'roster_member'  -> per-specialist key (roster_member_id set)
--
-- SECURITY: unlike the Supabase version (which stored api_key as plaintext and
-- leaned on RLS), the plaintext NEVER lands in this table. The application
-- encrypts with AES-256-GCM (key from PROVIDER_KEY_ENC_SECRET) and stores only
-- the ciphertext, iv, and auth tag. Read endpoints return a masked value only;
-- the raw key is never returned to any client. The recipe-brain proxy decrypts
-- server-side at call time and falls back to the legacy <PROVIDER>_API_KEY env
-- vars when no DB key is present.

create table if not exists platform_provider_keys (
  id uuid primary key default gen_random_uuid(),

  -- 'provider' (provider-wide) or 'roster_member' (per-specialist).
  scope text not null default 'provider'
    check (scope in ('provider', 'roster_member')),

  -- Always set: which provider adapter this key is for. Mirrors the
  -- llm_provider_configs.provider check constraint.
  provider text not null
    check (provider in ('anthropic', 'groq', 'gemini', 'mock')),

  -- Set only for scope = 'roster_member': the specialist/chairman this key
  -- belongs to. ON DELETE CASCADE so removing a roster row removes its key.
  roster_member_id uuid
    references llm_provider_configs(id) on delete cascade,

  -- AES-256-GCM material. ciphertext/iv/auth_tag are raw bytes.
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,

  -- Short, non-sensitive display hint: the last 4 chars of the plaintext, used
  -- to render "sk-…last4" without ever decrypting for a read. Stored separately
  -- because masking a value you can't decrypt on read would otherwise be
  -- impossible.
  last4 text,

  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- scope must line up with roster_member_id presence.
  constraint platform_provider_keys_scope_shape check (
    (scope = 'provider' and roster_member_id is null)
    or (scope = 'roster_member' and roster_member_id is not null)
  )
);

-- One provider-wide key per provider. Two partial unique indexes because a NULL
-- roster_member_id can't participate in a normal composite unique constraint.
create unique index if not exists platform_provider_keys_provider_uidx
  on platform_provider_keys (provider)
  where scope = 'provider';

-- One key per specialist.
create unique index if not exists platform_provider_keys_member_uidx
  on platform_provider_keys (roster_member_id)
  where scope = 'roster_member';

drop trigger if exists platform_provider_keys_set_updated_at on platform_provider_keys;
create trigger platform_provider_keys_set_updated_at
before update on platform_provider_keys
for each row execute function set_updated_at();
