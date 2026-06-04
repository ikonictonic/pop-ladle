create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_status') then
    create type user_status as enum ('active', 'suspended', 'deleted');
  end if;

  if not exists (select 1 from pg_type where typname = 'household_status') then
    create type household_status as enum ('active', 'suspended', 'deleted');
  end if;

  if not exists (select 1 from pg_type where typname = 'household_role') then
    create type household_role as enum ('owner', 'co_owner', 'caregiver', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type member_status as enum ('invited', 'accepted', 'revoked', 'suspended');
  end if;

  if not exists (select 1 from pg_type where typname = 'internal_admin_role') then
    create type internal_admin_role as enum ('super_admin', 'support_admin', 'clinical_admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'admin_status') then
    create type admin_status as enum ('active', 'suspended');
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_tier') then
    create type plan_tier as enum ('free', 'solo', 'family', 'pro', 'clinician', 'enterprise');
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_status') then
    create type plan_status as enum ('trialing', 'active', 'past_due', 'canceled', 'comped', 'suspended');
  end if;

  if not exists (select 1 from pg_type where typname = 'billing_source') then
    create type billing_source as enum ('web', 'ios', 'android', 'partner', 'manual_comp', 'enterprise_contract');
  end if;

  if not exists (select 1 from pg_type where typname = 'care_recipient_status') then
    create type care_recipient_status as enum ('active', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'privacy_request_type') then
    create type privacy_request_type as enum ('export_user', 'delete_user', 'delete_household', 'anonymize_records');
  end if;

  if not exists (select 1 from pg_type where typname = 'workflow_status') then
    create type workflow_status as enum ('requested', 'approved', 'processing', 'completed', 'rejected', 'failed', 'canceled');
  end if;
end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email citext not null unique,
  display_name text,
  image_url text,
  status user_status not null default 'active',
  email_verified_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint app_users_email_not_blank check (length(trim(email::text)) > 0),
  constraint app_users_clerk_user_id_not_blank check (length(trim(clerk_user_id)) > 0)
);

drop trigger if exists app_users_set_updated_at on app_users;
create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Pop & Ladle Household',
  primary_owner_user_id uuid references app_users(id) on delete restrict,
  billing_owner_user_id uuid references app_users(id) on delete restrict,
  status household_status not null default 'active',
  created_by uuid references app_users(id) on delete set null,
  suspended_at timestamptz,
  suspended_by uuid references app_users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint households_name_not_blank check (length(trim(name)) > 0)
);

drop trigger if exists households_set_updated_at on households;
create trigger households_set_updated_at
before update on households
for each row execute function set_updated_at();

create table if not exists household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  email citext not null,
  role household_role not null,
  status member_status not null default 'accepted',
  invited_by uuid references app_users(id) on delete set null,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references app_users(id) on delete set null,
  suspended_at timestamptz,
  suspended_by uuid references app_users(id) on delete set null,
  onboarding_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id),
  constraint household_members_email_not_blank check (length(trim(email::text)) > 0),
  constraint household_members_acceptance_timestamp check (
    status <> 'accepted' or accepted_at is not null
  )
);

create index if not exists household_members_household_role_idx
  on household_members (household_id, role, status);

create index if not exists household_members_user_idx
  on household_members (user_id, status);

drop trigger if exists household_members_set_updated_at on household_members;
create trigger household_members_set_updated_at
before update on household_members
for each row execute function set_updated_at();

create table if not exists care_recipients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  display_name text not null,
  relationship_label text,
  status care_recipient_status not null default 'active',
  sort_order integer not null default 100,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_recipients_display_name_not_blank check (length(trim(display_name)) > 0)
);

create index if not exists care_recipients_household_idx
  on care_recipients (household_id, status, sort_order);

drop trigger if exists care_recipients_set_updated_at on care_recipients;
create trigger care_recipients_set_updated_at
before update on care_recipients
for each row execute function set_updated_at();

create table if not exists care_profiles (
  id uuid primary key default gen_random_uuid(),
  care_recipient_id uuid not null unique references care_recipients(id) on delete cascade,
  profile_text text not null default '',
  completed_sections jsonb not null default '{}'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists care_profiles_set_updated_at on care_profiles;
create trigger care_profiles_set_updated_at
before update on care_profiles
for each row execute function set_updated_at();

create table if not exists internal_admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references app_users(id) on delete cascade,
  role internal_admin_role not null,
  status admin_status not null default 'active',
  created_by uuid references app_users(id) on delete set null,
  suspended_at timestamptz,
  suspended_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_admin_users_role_idx
  on internal_admin_users (role, status);

drop trigger if exists internal_admin_users_set_updated_at on internal_admin_users;
create trigger internal_admin_users_set_updated_at
before update on internal_admin_users
for each row execute function set_updated_at();

create table if not exists household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  email citext not null,
  role household_role not null default 'caregiver',
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid references app_users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references app_users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint household_invites_email_not_blank check (length(trim(email::text)) > 0)
);

create index if not exists household_invites_household_idx
  on household_invites (household_id, created_at desc);

create index if not exists household_invites_email_idx
  on household_invites (email);

create index if not exists household_invites_open_token_idx
  on household_invites (invite_token)
  where accepted_at is null and revoked_at is null;

create table if not exists beta_invites (
  id uuid primary key default gen_random_uuid(),
  email citext,
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  note text,
  created_by uuid references app_users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz,
  used_by uuid references app_users(id) on delete set null,
  redeemed_household_id uuid references households(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists beta_invites_email_idx
  on beta_invites (email);

create index if not exists beta_invites_open_token_idx
  on beta_invites (invite_token)
  where used_at is null and revoked_at is null;

create table if not exists plan_definitions (
  code plan_tier primary key,
  display_name text not null,
  monthly_price_cents integer,
  care_recipient_limit integer,
  household_member_limit integer,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_definitions_display_name_not_blank check (length(trim(display_name)) > 0)
);

drop trigger if exists plan_definitions_set_updated_at on plan_definitions;
create trigger plan_definitions_set_updated_at
before update on plan_definitions
for each row execute function set_updated_at();

create table if not exists household_entitlements (
  household_id uuid primary key references households(id) on delete cascade,
  plan_tier plan_tier not null default 'free',
  plan_status plan_status not null default 'active',
  billing_source billing_source,
  external_customer_id text,
  external_subscription_id text,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  grace_period_ends_at timestamptz,
  usage_limits jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists household_entitlements_plan_idx
  on household_entitlements (plan_tier, plan_status);

drop trigger if exists household_entitlements_set_updated_at on household_entitlements;
create trigger household_entitlements_set_updated_at
before update on household_entitlements
for each row execute function set_updated_at();

create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references app_users(id) on delete set null,
  actor_admin_role internal_admin_role,
  household_id uuid references households(id) on delete set null,
  target_user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_logs_action_not_blank check (length(trim(action)) > 0)
);

create index if not exists admin_audit_logs_actor_idx
  on admin_audit_logs (actor_user_id, created_at desc);

create index if not exists admin_audit_logs_household_idx
  on admin_audit_logs (household_id, created_at desc);

create index if not exists admin_audit_logs_action_idx
  on admin_audit_logs (action, created_at desc);

create table if not exists privacy_requests (
  id uuid primary key default gen_random_uuid(),
  request_type privacy_request_type not null,
  status workflow_status not null default 'requested',
  household_id uuid references households(id) on delete set null,
  target_user_id uuid references app_users(id) on delete set null,
  requested_by uuid references app_users(id) on delete set null,
  approved_by uuid references app_users(id) on delete set null,
  processed_by uuid references app_users(id) on delete set null,
  reason text,
  result_metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  processed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists privacy_requests_status_idx
  on privacy_requests (status, requested_at desc);

create index if not exists privacy_requests_household_idx
  on privacy_requests (household_id, requested_at desc);

drop trigger if exists privacy_requests_set_updated_at on privacy_requests;
create trigger privacy_requests_set_updated_at
before update on privacy_requests
for each row execute function set_updated_at();

insert into plan_definitions (
  code,
  display_name,
  monthly_price_cents,
  care_recipient_limit,
  household_member_limit,
  features
)
values
  ('free', 'Free', 0, 1, 1, '{"generator_access":"limited","hard_rules":false,"reports":false}'::jsonb),
  ('solo', 'Solo', 1900, 1, 2, '{"generator_access":true,"hard_rules":true,"family_kitchen":"basic"}'::jsonb),
  ('family', 'Family', 3900, 3, 3, '{"generator_access":true,"hard_rules":true,"notes_delegation":true}'::jsonb),
  ('pro', 'Pro', 7900, null, null, '{"generator_access":true,"hard_rules":true,"reports":true,"team":true}'::jsonb),
  ('clinician', 'Clinician', 17500, null, null, '{"generator_access":true,"hard_rules":true,"clinical_reports":true,"caseload":true}'::jsonb),
  ('enterprise', 'Enterprise', null, null, null, '{"enterprise_controls":true,"org_defined_limits":true}'::jsonb)
on conflict (code) do update set
  display_name = excluded.display_name,
  monthly_price_cents = excluded.monthly_price_cents,
  care_recipient_limit = excluded.care_recipient_limit,
  household_member_limit = excluded.household_member_limit,
  features = excluded.features;

create or replace function has_household_role(
  _user_id uuid,
  _household_id uuid,
  _roles household_role[]
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from household_members
    where user_id = _user_id
      and household_id = _household_id
      and role = any(_roles)
      and status = 'accepted'
  );
$$;

create or replace function has_internal_admin_role(
  _user_id uuid,
  _roles internal_admin_role[]
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from internal_admin_users
    where user_id = _user_id
      and role = any(_roles)
      and status = 'active'
  );
$$;
