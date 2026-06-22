-- Caregiver Notes + Rejection Routing (Private Household App).
--
-- A timeline of caregiver observations about a care recipient ("good days and
-- hard days", appetite, refusals). A note can optionally link to the recipe or
-- the Day Plan entry it's about. Refusal signals (here, plus Day Plan entries
-- with acceptance = 'refused') feed Rejection Routing, which suggests alternates.

create table if not exists caregiver_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  care_recipient_id uuid not null references care_recipients(id) on delete cascade,
  note_text text not null,
  category text not null default 'general'
    check (category in (
      'general', 'good_day', 'hard_day', 'refusal',
      'appetite', 'medication', 'observation'
    )),
  -- Optional context the note is about.
  related_recipe_id uuid references recipe_adaptations(id) on delete set null,
  related_day_plan_entry_id uuid references day_plan_entries(id) on delete set null,
  logged_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caregiver_notes_text_not_blank check (length(trim(note_text)) > 0)
);

create index if not exists caregiver_notes_recipient_idx
  on caregiver_notes (care_recipient_id, created_at desc);

create index if not exists caregiver_notes_household_idx
  on caregiver_notes (household_id, created_at desc);

-- Fast lookup of refusal notes for Rejection Routing.
create index if not exists caregiver_notes_refusals_idx
  on caregiver_notes (care_recipient_id, created_at desc)
  where category = 'refusal';

drop trigger if exists caregiver_notes_set_updated_at on caregiver_notes;
create trigger caregiver_notes_set_updated_at
before update on caregiver_notes
for each row execute function set_updated_at();
