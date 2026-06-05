create table if not exists recipe_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source_recipe_text text not null default '',
  provider text,
  model text,
  status text not null default 'completed',
  requested_by uuid references app_users(id) on delete set null,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_requests_status_known check (
    status in ('queued', 'processing', 'completed', 'failed')
  )
);

create index if not exists recipe_requests_household_created_idx
  on recipe_requests (household_id, created_at desc);

create index if not exists recipe_requests_status_idx
  on recipe_requests (status);

drop trigger if exists recipe_requests_set_updated_at on recipe_requests;
create trigger recipe_requests_set_updated_at
before update on recipe_requests
for each row execute function set_updated_at();

create table if not exists recipe_adaptations (
  id uuid primary key default gen_random_uuid(),
  recipe_request_id uuid references recipe_requests(id) on delete set null,
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  source_recipe_text text not null default '',
  output_markdown text not null,
  output_json jsonb not null default '{}'::jsonb,
  meal_slots text[] not null default '{}',
  recipe_categories text[] not null default '{}',
  saved_by uuid references app_users(id) on delete set null,
  saved_at timestamptz,
  is_favorite boolean not null default false,
  photo_url text,
  photo_storage_path text,
  original_servings integer,
  target_servings integer,
  serving_scale_factor numeric(8,3) not null default 1,
  serving_count_estimated boolean not null default false,
  serving_notes text,
  generation_mode text not null default 'manual',
  clinical_warning boolean not null default false,
  clinical_warning_items jsonb not null default '[]'::jsonb,
  version_number integer not null default 1,
  current_version_label text not null default 'Original',
  version_history jsonb not null default '[]'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_adaptations_title_not_blank check (length(trim(title)) > 0),
  constraint recipe_adaptations_output_not_blank check (length(trim(output_markdown)) > 0),
  constraint recipe_adaptations_original_servings_positive check (
    original_servings is null or original_servings > 0
  ),
  constraint recipe_adaptations_target_servings_positive check (
    target_servings is null or target_servings > 0
  ),
  constraint recipe_adaptations_scale_positive check (serving_scale_factor > 0),
  constraint recipe_adaptations_version_positive check (version_number > 0)
);

create index if not exists recipe_adaptations_household_created_idx
  on recipe_adaptations (household_id, created_at desc)
  where deleted_at is null;

create index if not exists recipe_adaptations_household_saved_idx
  on recipe_adaptations (household_id, saved_at desc)
  where saved_at is not null and deleted_at is null;

create index if not exists recipe_adaptations_meal_slots_idx
  on recipe_adaptations using gin (meal_slots);

create index if not exists recipe_adaptations_recipe_categories_idx
  on recipe_adaptations using gin (recipe_categories);

drop trigger if exists recipe_adaptations_set_updated_at on recipe_adaptations;
create trigger recipe_adaptations_set_updated_at
before update on recipe_adaptations
for each row execute function set_updated_at();
