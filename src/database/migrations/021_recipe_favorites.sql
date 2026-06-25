-- Per-user recipe favorites (Favorites feature).
--
-- Replaces the Supabase recipe_user_flags table. One row per
-- (recipe_adaptation_id, user_id): a personal bookmark, decoupled from
-- recipe_adaptations.is_favorite so ANY household role (including viewer, who
-- has no write access to recipes) can keep favorites, and so favorites work
-- uniformly for a household's own recipes AND shared master/platform recipes.
-- household_id records the context the favorite was set in (a user may belong to
-- more than one household); uniqueness is on (recipe, user).

create table if not exists recipe_favorites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  recipe_adaptation_id uuid not null references recipe_adaptations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  is_favorite boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_adaptation_id, user_id)
);

-- List a user's favorites within a household (the common read).
create index if not exists recipe_favorites_user_household_idx
  on recipe_favorites (user_id, household_id)
  where is_favorite = true;

-- Reverse lookup (cascade / "who favorited this recipe").
create index if not exists recipe_favorites_recipe_idx
  on recipe_favorites (recipe_adaptation_id);
