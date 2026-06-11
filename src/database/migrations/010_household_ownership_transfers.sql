-- Household ownership transfer — the plan's audited two-step flow:
-- Owner initiates -> target accepts -> swap owner, all audited.
-- One pending transfer per household at a time.

create table if not exists household_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  from_user_id uuid not null references app_users(id) on delete cascade,
  to_user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'canceled', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint household_ownership_transfers_not_self check (from_user_id <> to_user_id)
);

create unique index if not exists household_ownership_transfers_one_pending_idx
  on household_ownership_transfers (household_id)
  where status = 'pending';

create index if not exists household_ownership_transfers_to_user_idx
  on household_ownership_transfers (to_user_id, status);
