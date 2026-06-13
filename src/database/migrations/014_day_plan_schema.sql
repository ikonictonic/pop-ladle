-- Today Plan / Day Plan — the caregiver's daily meal plan per care recipient
-- (Application Brain A7 Today Plan). One row per planned item in a meal slot on
-- a date. A planned item can reference a household recipe OR be free text
-- ("leftovers", "smoothie"). Completion captures the Food Acceptance Record
-- (finished / partial / refused) that feeds Rejection Routing later.

create table if not exists day_plan_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  care_recipient_id uuid not null references care_recipients(id) on delete cascade,
  plan_date date not null,
  meal_slot text not null
    check (meal_slot in (
      'breakfast', 'mid_morning_snack', 'lunch',
      'mid_afternoon_snack', 'dinner', 'dessert', 'snack'
    )),
  -- Planned content: a saved household recipe and/or a free-text title.
  recipe_adaptation_id uuid references recipe_adaptations(id) on delete set null,
  title text,
  position integer not null default 0,
  status text not null default 'planned'
    check (status in ('planned', 'completed', 'skipped')),
  -- Food Acceptance Record (set when completed).
  acceptance text
    check (acceptance is null or acceptance in ('finished', 'partial', 'refused')),
  notes text,
  completed_at timestamptz,
  completed_by uuid references app_users(id) on delete set null,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint day_plan_entries_has_content check (
    recipe_adaptation_id is not null or length(trim(coalesce(title, ''))) > 0
  )
);

-- The day-view query: a recipient's entries for a date (or range), ordered.
create index if not exists day_plan_entries_recipient_date_idx
  on day_plan_entries (care_recipient_id, plan_date, meal_slot, position);

create index if not exists day_plan_entries_household_date_idx
  on day_plan_entries (household_id, plan_date);

drop trigger if exists day_plan_entries_set_updated_at on day_plan_entries;
create trigger day_plan_entries_set_updated_at
before update on day_plan_entries
for each row execute function set_updated_at();
