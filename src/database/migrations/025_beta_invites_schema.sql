-- Private-beta sign-up links (the Super Admin "Beta Links" tab).
--
-- Replaces the Supabase beta_invites table + its redeem_beta_invite RPC. The
-- super admin mints one-time links; redeeming one provisions the caller as the
-- owner of a brand-new household (the only path to becoming a new owner now
-- that signup runs on Clerk). A link may be bound to a specific email or left
-- "open" (any email). Revocation and use are soft stamps for the audit trail.

create table if not exists beta_invites (
  id uuid primary key default gen_random_uuid(),
  email text,
  note text,
  invite_token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references app_users(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Admin list (newest first).
create index if not exists beta_invites_created_at_idx
  on beta_invites (created_at desc);
