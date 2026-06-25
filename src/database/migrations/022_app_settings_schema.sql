-- Per-household app settings (the Control Center "Branding" section).
--
-- Replaces the Supabase app_settings table (and households.patient_display_name).
-- One row per household: cosmetic branding (title / subtitle / patient display
-- name / owner help name) plus a stored default provider + model.
--
-- NOTE: default_provider / default_model are persisted here only so the
-- not-yet-migrated Recipe Brain section has a home once it moves off Supabase.
-- Backend generation does NOT read them — provider keys are env-only and the
-- committee roster is governed via /admin/roster. They are inert config until
-- Recipe Brain migrates.

create table if not exists app_settings (
  household_id uuid primary key references households(id) on delete cascade,
  title text,
  subtitle text,
  patient_display_name text,
  caregiver_help_name text,
  default_provider text,
  default_model text,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
