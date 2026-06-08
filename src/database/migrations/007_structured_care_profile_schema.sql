alter table care_profiles
  add column if not exists profile_data jsonb not null default '{}'::jsonb,
  add column if not exists review_status text not null default 'draft',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references app_users(id) on delete set null;

alter table care_profiles
  drop constraint if exists care_profiles_review_status_valid;

alter table care_profiles
  add constraint care_profiles_review_status_valid
  check (review_status in ('draft', 'ready_for_use', 'needs_review'));

create index if not exists care_profiles_profile_data_idx
  on care_profiles using gin (profile_data);

create index if not exists care_profiles_review_status_idx
  on care_profiles (review_status, updated_at desc);

alter table recipe_brain_runs
  add column if not exists clinical_profile_data jsonb not null default '{}'::jsonb;
