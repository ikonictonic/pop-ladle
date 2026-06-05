-- Recipe Brain — the governed Care Team committee pipeline.
--
-- Adds the run-tracking and roster-configuration tables for the server-side
-- committee orchestration (specialists in parallel -> Chairman synthesis ->
-- Clinical Review verdict), plus the verdict columns on recipe_adaptations so
-- every produced recipe carries its Clinical Review result.
--
-- Provider API keys are NOT stored here: they live in server env vars resolved
-- by provider name (see config/env.js). llm_provider_configs holds only the
-- roster + model mapping the Super Admin governs.

-- Recipe Brain verdict carried on the produced recipe.
alter table recipe_adaptations
  add column if not exists clinical_review_status text
    not null default 'not_reviewed'
    check (clinical_review_status in (
      'not_reviewed', 'needs_review', 'approved', 'approved_with_caveats', 'denied'
    )),
  add column if not exists clinical_review_summary text,
  add column if not exists recipe_brain_run_id uuid;

-- Roster: the specialists + Chairman, governed by the Super Admin. system_prompt
-- null means "use the bundled default prompt for role_key".
create table if not exists llm_provider_configs (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  display_name text not null,
  kind text not null default 'specialist'
    check (kind in ('specialist', 'chairman')),
  provider text not null
    check (provider in ('anthropic', 'groq', 'gemini', 'mock')),
  model text not null,
  system_prompt text,
  active boolean not null default true,
  position integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint llm_provider_configs_display_name_not_blank check (length(trim(display_name)) > 0),
  constraint llm_provider_configs_model_not_blank check (length(trim(model)) > 0)
);

create index if not exists llm_provider_configs_active_idx
  on llm_provider_configs (kind, active, position);

drop trigger if exists llm_provider_configs_set_updated_at on llm_provider_configs;
create trigger llm_provider_configs_set_updated_at
before update on llm_provider_configs
for each row execute function set_updated_at();

-- One committee run.
create table if not exists recipe_brain_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  care_recipient_id uuid references care_recipients(id) on delete set null,
  recipe_adaptation_id uuid references recipe_adaptations(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  mode text not null default 'committee',
  source_recipe_text text not null default '',
  clinical_profile_text text not null default '',
  verdict text
    check (verdict is null or verdict in ('approved', 'approved_with_caveats', 'denied')),
  verdict_summary text,
  caveats jsonb not null default '[]'::jsonb,
  warning_items jsonb not null default '[]'::jsonb,
  clinician_flags jsonb not null default '[]'::jsonb,
  specialist_count integer not null default 0,
  total_input_tokens integer,
  total_output_tokens integer,
  total_cost_usd numeric(12,6),
  error_message text,
  requested_by uuid references app_users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipe_brain_runs_household_created_idx
  on recipe_brain_runs (household_id, created_at desc);

create index if not exists recipe_brain_runs_status_idx
  on recipe_brain_runs (status, created_at desc);

drop trigger if exists recipe_brain_runs_set_updated_at on recipe_brain_runs;
create trigger recipe_brain_runs_set_updated_at
before update on recipe_brain_runs
for each row execute function set_updated_at();

-- Now that recipe_brain_runs exists, link the FK from recipe_adaptations.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recipe_adaptations_recipe_brain_run_id_fkey'
  ) then
    alter table recipe_adaptations
      add constraint recipe_adaptations_recipe_brain_run_id_fkey
      foreign key (recipe_brain_run_id) references recipe_brain_runs(id) on delete set null;
  end if;
end $$;

-- One specialist's structured deliberation within a run.
create table if not exists care_team_specialist_runs (
  id uuid primary key default gen_random_uuid(),
  brain_run_id uuid not null references recipe_brain_runs(id) on delete cascade,
  role_key text not null,
  display_name text not null,
  provider text not null,
  model text not null,
  ok boolean not null default false,
  verdict text
    check (verdict is null or verdict in ('approve', 'approve_with_caveats', 'deny')),
  verdict_rationale text,
  concerns jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  raw_output text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_message text,
  position integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists care_team_specialist_runs_brain_idx
  on care_team_specialist_runs (brain_run_id, position);

-- The Chairman's synthesis within a run.
create table if not exists chairman_synthesis_runs (
  id uuid primary key default gen_random_uuid(),
  brain_run_id uuid not null references recipe_brain_runs(id) on delete cascade,
  provider text not null,
  model text not null,
  ok boolean not null default false,
  verdict text
    check (verdict is null or verdict in ('approved', 'approved_with_caveats', 'denied')),
  verdict_summary text,
  recipe_markdown text,
  caveats jsonb not null default '[]'::jsonb,
  warning_items jsonb not null default '[]'::jsonb,
  clinician_flags jsonb not null default '[]'::jsonb,
  raw_output text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists chairman_synthesis_runs_brain_idx
  on chairman_synthesis_runs (brain_run_id);

-- Proxy observability: one row per upstream model call.
create table if not exists llm_proxy_logs (
  id uuid primary key default gen_random_uuid(),
  brain_run_id uuid references recipe_brain_runs(id) on delete set null,
  provider text not null,
  model text not null,
  purpose text not null default 'specialist'
    check (purpose in ('specialist', 'chairman')),
  status text not null default 'ok'
    check (status in ('ok', 'error')),
  http_status integer,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  cost_usd numeric(12,6),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists llm_proxy_logs_brain_idx
  on llm_proxy_logs (brain_run_id, created_at);

create index if not exists llm_proxy_logs_provider_idx
  on llm_proxy_logs (provider, created_at desc);

-- Seed the default roster: the 6 ported specialists + Chairman. Provider/model
-- are operator-tunable; system_prompt null = use the bundled persona prompt.
insert into llm_provider_configs (role_key, display_name, kind, provider, model, position)
values
  ('dietician',             'Dietician',             'specialist', 'groq',      'llama-3.3-70b-versatile', 10),
  ('clinical_nutritionist', 'Clinical Nutritionist', 'specialist', 'gemini',    'gemini-2.0-flash',        20),
  ('chef',                  'Michelin Chef',         'specialist', 'groq',      'llama-3.3-70b-versatile', 30),
  ('cardiologist',          'Cardiologist',          'specialist', 'anthropic', 'claude-sonnet-4-6',       40),
  ('nephrologist',          'Nephrologist',          'specialist', 'anthropic', 'claude-sonnet-4-6',       50),
  ('neurologist',           'Neurologist',           'specialist', 'gemini',    'gemini-2.0-flash',        60),
  ('chairman',              'Care Team Lead',        'chairman',   'anthropic', 'claude-sonnet-4-6',        0)
on conflict (role_key) do nothing;
