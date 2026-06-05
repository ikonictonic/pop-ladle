alter table recipe_requests
  add column if not exists care_recipient_id uuid references care_recipients(id) on delete set null;

create index if not exists recipe_requests_care_recipient_idx
  on recipe_requests (household_id, care_recipient_id, created_at desc)
  where care_recipient_id is not null;

alter table recipe_adaptations
  add column if not exists care_recipient_id uuid references care_recipients(id) on delete set null;

create index if not exists recipe_adaptations_care_recipient_saved_idx
  on recipe_adaptations (household_id, care_recipient_id, saved_at desc)
  where care_recipient_id is not null and deleted_at is null;

