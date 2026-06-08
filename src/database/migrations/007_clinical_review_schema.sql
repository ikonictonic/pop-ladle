-- Clinical Review — the human verdict gate + audit queue, plus the deterministic
-- accuracy check.
--
-- The committee already writes its verdict to recipe_adaptations.clinical_review_status
-- (migration 003). This adds the human review layer (confirm/override + notes/caveats),
-- the append-only audit history, and the accuracy-check audit trail + rollup.

-- Rollup columns on the recipe (current state for fast queue/detail queries).
alter table recipe_adaptations
  -- Human review rollup
  add column if not exists clinical_review_notes text,
  add column if not exists clinical_review_caveats text,
  add column if not exists clinical_reviewed_by uuid references app_users(id) on delete set null,
  add column if not exists clinical_reviewed_at timestamptz,
  add column if not exists clinical_review_version_number integer,
  add column if not exists clinical_review_updated_at timestamptz,
  -- Accuracy check rollup
  add column if not exists accuracy_check_status text
    not null default 'unrun'
    check (accuracy_check_status in ('passed', 'needs_review', 'unrun')),
  add column if not exists accuracy_confidence text
    not null default 'unknown'
    check (accuracy_confidence in ('high', 'medium', 'low', 'unknown')),
  add column if not exists needs_clinician_review boolean not null default false,
  add column if not exists clinician_review_flags jsonb not null default '[]'::jsonb;

-- Audit trail of deterministic accuracy-check runs.
create table if not exists recipe_accuracy_checks (
  id uuid primary key default gen_random_uuid(),
  recipe_adaptation_id uuid not null references recipe_adaptations(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  passed boolean not null default false,
  confidence text not null default 'unknown'
    check (confidence in ('high', 'medium', 'low', 'unknown')),
  clinical_profile_used boolean not null default false,
  hard_rules_used boolean not null default false,
  serving_check_passed boolean not null default true,
  ingredient_check_passed boolean not null default true,
  substitution_check_passed boolean not null default true,
  dietary_claim_check_passed boolean not null default true,
  medication_food_check_passed boolean not null default true,
  caregiver_practicality_passed boolean not null default true,
  issues jsonb not null default '[]'::jsonb,
  required_corrections jsonb not null default '[]'::jsonb,
  clinician_review_flags jsonb not null default '[]'::jsonb,
  source_registry_topics_used jsonb not null default '[]'::jsonb,
  final_safety_summary text,
  check_version text,
  correction_pass_ran boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists recipe_accuracy_checks_recipe_idx
  on recipe_accuracy_checks (recipe_adaptation_id, created_at desc);

create index if not exists recipe_accuracy_checks_household_idx
  on recipe_accuracy_checks (household_id, created_at desc);

-- Append-only audit history of clinical review decisions (committee + human).
create table if not exists recipe_clinical_reviews (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  recipe_adaptation_id uuid not null references recipe_adaptations(id) on delete cascade,
  source text not null default 'human'
    check (source in ('committee', 'human')),
  status text not null
    check (status in ('needs_review', 'approved', 'approved_with_caveats', 'denied')),
  notes text,
  caveats text,
  reviewer_user_id uuid references app_users(id) on delete set null,
  recipe_version_number integer,
  recipe_brain_run_id uuid references recipe_brain_runs(id) on delete set null,
  accuracy_check_id uuid references recipe_accuracy_checks(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists recipe_clinical_reviews_recipe_idx
  on recipe_clinical_reviews (recipe_adaptation_id, created_at desc);

create index if not exists recipe_clinical_reviews_household_idx
  on recipe_clinical_reviews (household_id, created_at desc);
