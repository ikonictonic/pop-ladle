-- =============================================================================
-- 019_abac_subject_grants — Phase 4 of the RBAC→ABAC migration.
--
-- The grants store. A subject's authorization is the SET of grants they hold,
-- each scoped to one entity (tenant/client/patient/org/study) — this is what
-- replaces "one role string per user" and kills role explosion.
--
-- ADDITIVE, on purpose: household roles keep living in household_members and
-- internal staff roles in internal_admin_users (single source each, no sync
-- trap). This table is only for grants that have no other home — professional /
-- cross-tenant / comped / future-surface grants. resolveSubjectGrants() (in
-- features/access/grants.js) UNIONs all three into the PDP subject.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'grant_status') then
    create type grant_status as enum ('active', 'revoked', 'expired');
  end if;
end $$;

create table if not exists subject_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  role_id text not null,                 -- matrix role id, e.g. 'PL-077-PRO'
  scope_type text not null,              -- 'tenant' | 'client' | 'patient' | 'org' | 'study' | 'global'
  scope_id uuid,                         -- the scoped entity; null for a global grant
  domain text,                           -- optional domain override (else the role's domain)
  phi_clearance text,                    -- optional PHI clearance note
  dual_control_state text,               -- 'na' | 'pending' | 'satisfied' for dual-control grants
  granted_by uuid references app_users(id) on delete set null,
  status grant_status not null default 'active',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subject_grants_role_id_format check (role_id ~ '^PL-[0-9]{3}-[A-Z]+$'),
  constraint subject_grants_global_scope_null check (scope_type <> 'global' or scope_id is null)
);

create index if not exists subject_grants_user_idx
  on subject_grants (user_id, status);
create index if not exists subject_grants_scope_idx
  on subject_grants (scope_type, scope_id);

drop trigger if exists subject_grants_set_updated_at on subject_grants;
create trigger subject_grants_set_updated_at
before update on subject_grants
for each row execute function set_updated_at();
