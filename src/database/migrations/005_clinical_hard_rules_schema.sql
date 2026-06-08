create table if not exists clinical_hard_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  care_recipient_id uuid references care_recipients(id) on delete cascade,
  rule_text text not null,
  trigger_terms text[] not null default '{}',
  replacement_text text not null default '',
  rule_type text not null default 'replace'
    check (rule_type in ('replace', 'remove', 'avoid', 'require')),
  severity text not null default 'hard'
    check (severity in ('hard', 'soft')),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_hard_rules_rule_text_not_blank check (length(trim(rule_text)) > 0),
  constraint clinical_hard_rules_scope_consistent unique nulls not distinct (
    household_id,
    care_recipient_id,
    rule_text
  )
);

create index if not exists clinical_hard_rules_household_active_idx
  on clinical_hard_rules (household_id, sort_order, created_at)
  where is_active = true;

create index if not exists clinical_hard_rules_care_recipient_active_idx
  on clinical_hard_rules (household_id, care_recipient_id, sort_order, created_at)
  where is_active = true and care_recipient_id is not null;

create index if not exists clinical_hard_rules_trigger_terms_idx
  on clinical_hard_rules using gin (trigger_terms);

drop trigger if exists clinical_hard_rules_set_updated_at on clinical_hard_rules;
create trigger clinical_hard_rules_set_updated_at
before update on clinical_hard_rules
for each row execute function set_updated_at();

alter table recipe_brain_runs
  add column if not exists hard_rules_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists hard_rules_updated_at_used timestamptz;

