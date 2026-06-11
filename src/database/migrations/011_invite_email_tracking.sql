-- Invite email delivery tracking.
-- household_invites previously had no record of whether the invite link was
-- ever emailed to the recipient. Add best-effort delivery bookkeeping so the
-- members feature can record sends, surface the last failure, and power a
-- "resend" action without guessing.

alter table household_invites
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_send_count integer not null default 0,
  add column if not exists email_last_error text;
