-- Account saves — a signed-in user's saved marketing content (recipes, drinks,
-- products, articles) from the public site (popladle.com).
--
-- This is deliberately separate from recipe_favorites: favorites are per-user
-- bookmarks on household/master recipe_adaptations rows keyed by UUID, and are
-- care data inside a household. Account saves are the *public* site's saves —
-- keyed by a content slug (e.g. "recipe:warm-oats"), not a UUID, and belong to
-- the user with no household. The public site saves to localStorage while a
-- visitor is a guest; when they sign in on the app, those device saves are
-- adopted into this table (see accountSavesService.adopt).

create table if not exists account_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  -- "<type>:<id>", e.g. "recipe:warm-oats". Canonical identity of a save.
  save_key text not null,
  item_type text not null
    check (item_type in ('recipe', 'drink', 'product', 'article')),
  item_id text not null,
  title text not null,
  img text not null default '',
  -- Client-supplied original save time (ms since epoch) so an adopted device
  -- save keeps when the visitor first saved it; 0 when unknown.
  saved_at_ms bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_saves_key_not_blank check (length(trim(save_key)) > 0),
  constraint account_saves_item_id_not_blank check (length(trim(item_id)) > 0),
  constraint account_saves_title_not_blank check (length(trim(title)) > 0),
  -- One save per (user, content item). Adoption upserts on this.
  unique (user_id, save_key)
);

create index if not exists idx_account_saves_user
  on account_saves (user_id, created_at desc);
