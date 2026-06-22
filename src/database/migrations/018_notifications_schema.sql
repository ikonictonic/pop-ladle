-- In-app notifications (Notification Service).
--
-- Per-recipient inbox. System events (a recipe reviewed, a member joined, a plan
-- limit hit, hydration falling behind, ...) write a row addressed to one user;
-- the user lists/reads/dismisses their own. `type` is free text (not an enum) so
-- new event kinds don't need a migration. household_id is context (nullable for
-- account-level notices); entity_type/entity_id deep-link to the thing it's about.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references app_users(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_title_not_blank check (length(trim(title)) > 0),
  constraint notifications_type_len check (length(type) between 1 and 64)
);

-- Inbox query: a user's notifications, newest first.
create index if not exists notifications_recipient_idx
  on notifications (recipient_user_id, created_at desc);

-- Unread badge count + unread-only listing.
create index if not exists notifications_recipient_unread_idx
  on notifications (recipient_user_id, created_at desc)
  where read_at is null;
