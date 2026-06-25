-- Owner-managed meal slots and recipe categories (the Control Center
-- "Categories" section).
--
-- Replaces the Supabase recipe_taxonomy table. Household-scoped; one row per
-- (household, type, slug). The slug is the stable matcher stored on
-- recipe_adaptations.meal_slots[] / .recipe_categories[] — renaming a taxonomy
-- row keeps the slug so existing recipes stay tagged. Archiving (is_active =
-- false) hides an item from new tagging while keeping old recipes readable.

create table if not exists recipe_taxonomy (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  type text not null check (type in ('meal_slot', 'recipe_category')),
  name text not null,
  slug text not null,
  color text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, type, slug)
);

-- The common read: a household's items of one type, in display order.
create index if not exists recipe_taxonomy_household_type_idx
  on recipe_taxonomy (household_id, type, sort_order);
