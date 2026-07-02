-- Stripe billing: price mapping on the catalog + webhook event ledger.
--
-- plan_definitions gains the Stripe Product/Price ids written by the admin
-- "sync catalog to Stripe" action. Webhooks resolve tier by product id first
-- (products are stable per tier), price id second (prices are immutable in
-- Stripe — a price change archives the old price and creates a new one, but
-- existing subscriptions keep referencing the archived price).

alter table plan_definitions
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text;

create unique index if not exists plan_definitions_stripe_product_idx
  on plan_definitions (stripe_product_id) where stripe_product_id is not null;

create unique index if not exists plan_definitions_stripe_price_idx
  on plan_definitions (stripe_price_id) where stripe_price_id is not null;

-- Webhook ledger. PK = the Stripe event id (evt_...), so `insert ... on
-- conflict do nothing` dedupes Stripe's at-least-once delivery; the same rows
-- feed the admin billing screen, making skipped/errored events visible instead
-- of silent. household_id is `set null` on delete so the ledger survives
-- household deletion (a still-billing subscription for a deleted household
-- must stay diagnosable).
create table if not exists billing_events (
  id text primary key,
  event_type text not null,
  household_id uuid references households(id) on delete set null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'skipped', 'error')),
  detail text,
  payload jsonb not null default '{}'::jsonb,
  stripe_created_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists billing_events_household_idx
  on billing_events (household_id, created_at desc);

create index if not exists billing_events_created_idx
  on billing_events (created_at desc);

-- Webhook household resolution when subscription metadata is missing
-- (portal-driven changes reference only the subscription/customer).
create index if not exists household_entitlements_ext_sub_idx
  on household_entitlements (external_subscription_id)
  where external_subscription_id is not null;

create index if not exists household_entitlements_ext_cust_idx
  on household_entitlements (external_customer_id)
  where external_customer_id is not null;
