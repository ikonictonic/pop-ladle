-- Hydration tracking (Application Brain A8) — per care recipient fluid intake
-- logged against the daily goal from their Care Profile. The caregiver logs on
-- the recipient's behalf ("log hydration in two taps"); the recipient never logs in.

create table if not exists hydration_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  care_recipient_id uuid not null references care_recipients(id) on delete cascade,
  logged_at timestamptz not null default now(),
  -- Day bucket (UTC date of logged_at) so the day view + daily totals are a
  -- simple indexed equality rather than a range scan.
  log_date date not null default (now() at time zone 'utc')::date,
  amount_ml integer not null,
  beverage text,
  notes text,
  logged_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hydration_logs_amount_positive check (amount_ml > 0 and amount_ml <= 5000),
  constraint hydration_logs_beverage_len check (beverage is null or length(beverage) <= 80)
);

create index if not exists hydration_logs_recipient_day_idx
  on hydration_logs (care_recipient_id, log_date, logged_at desc);

create index if not exists hydration_logs_household_idx
  on hydration_logs (household_id, log_date);
