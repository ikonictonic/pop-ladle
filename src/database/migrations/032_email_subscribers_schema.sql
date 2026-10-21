-- Early-access email subscribers from the public site (popladle.com) and the
-- consent evidence behind them (Subscriber Preference Capture handoff,
-- October 2026).
--
-- Pop & Ladle owns consent: this table is the source of truth for whether an
-- address may receive marketing. Resend holds a contact only once an address
-- is confirmed (for broadcasts and the meal-planning automation) and is kept
-- in step from subscriberService. Double opt-in: a row stays 'pending' until
-- the emailed confirmation link is used. Bounces and complaints set
-- suppressed_at, which no signup or confirmation can clear.
--
-- These people are not app users, so there is deliberately no link to
-- app_users. The id is the pseudonymous subscriber_id.

create table if not exists email_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  consent_status text not null default 'pending'
    check (consent_status in ('pending', 'confirmed', 'withdrawn')),
  -- Exact checkbox wording version and privacy notice version shown at the
  -- latest submission. The full wording is copied into the event history.
  consent_text_version text not null,
  privacy_notice_version text not null,
  consent_source text not null,
  submitted_at timestamptz not null,
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,
  -- sha256 of the emailed confirmation token; cleared when used or expired.
  confirmation_token_hash text unique,
  confirmation_expires_at timestamptz,
  primary_interest text
    check (primary_interest in ('meal_planning', 'hydration', 'food_preferences', 'time_saving', 'other')),
  preference_updated_at timestamptz,
  welcome_sent_at timestamptz,
  meal_planning_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_subscribers_email_lowercase check (email = lower(email))
);

create index if not exists idx_email_subscribers_confirmation_expiry
  on email_subscribers (confirmation_expires_at)
  where confirmation_token_hash is not null;

-- Append-only consent and lifecycle history: signup, confirmation, preference
-- changes, withdrawals, suppressions, welcome delivery. Rows are never
-- updated; deleting a subscriber (an erasure request) removes their history.
create table if not exists email_subscriber_events (
  id bigserial primary key,
  subscriber_id uuid not null references email_subscribers(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_subscriber_events_subscriber
  on email_subscriber_events (subscriber_id, created_at);

create or replace function email_subscriber_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'email_subscriber_events is append-only';
end;
$$;

drop trigger if exists email_subscriber_events_no_update on email_subscriber_events;
create trigger email_subscriber_events_no_update
  before update on email_subscriber_events
  for each row execute function email_subscriber_events_append_only();

-- Short-lived session issued after signup so the thank-you page can save an
-- optional interest. Only the sha256 of the token is stored.
create table if not exists email_signup_sessions (
  token_hash text primary key,
  subscriber_id uuid not null references email_subscribers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_signup_sessions_expiry
  on email_signup_sessions (expires_at);

-- Resend webhook deliveries already applied, keyed by the svix-id header, so a
-- retried delivery produces one state transition.
create table if not exists email_webhook_receipts (
  webhook_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

-- Aggregate measurement only (handoff section 8). No per-person rows.
create or replace view email_subscriber_metrics as
select
  count(*) as submitted,
  count(*) filter (where confirmed_at is not null) as confirmed,
  round(100.0 * count(*) filter (where confirmed_at is not null) / nullif(count(*), 0), 1)
    as confirmation_rate_pct,
  count(*) filter (where primary_interest is not null) as preference_responses,
  round(100.0 * count(*) filter (where primary_interest is not null) / nullif(count(*), 0), 1)
    as preference_completion_pct,
  round(
    100.0 * count(*) filter (where primary_interest = 'meal_planning')
      / nullif(count(*) filter (where primary_interest is not null), 0),
    1
  ) as meal_planning_share_pct,
  count(*) filter (where consent_status = 'withdrawn' and confirmed_at is not null) as unsubscribed,
  round(
    100.0 * count(*) filter (where consent_status = 'withdrawn' and confirmed_at is not null)
      / nullif(count(*) filter (where confirmed_at is not null), 0),
    1
  ) as unsubscribe_rate_pct,
  count(*) filter (where suppressed_at is not null) as suppressed
from email_subscribers;
