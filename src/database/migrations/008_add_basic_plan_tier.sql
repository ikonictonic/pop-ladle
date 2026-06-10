-- Add the Basic ($9.99, MVP-only bridge) tier to the plan ladder (Plan-2 §07).
--
-- Standalone migration: Postgres allows ALTER TYPE ... ADD VALUE inside a
-- transaction, but the new value cannot be USED in the same transaction —
-- so the catalog reseed that references 'basic' lives in migration 009.

alter type plan_tier add value if not exists 'basic' before 'solo';
