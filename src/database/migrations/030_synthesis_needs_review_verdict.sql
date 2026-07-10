-- Allow the Chairwoman synthesis verdict to be 'needs_review'.
--
-- When synthesis fails to produce a valid envelope, the run must not be
-- recorded as approved: the specialists only ever voted on the *source* recipe,
-- and nothing was adapted. rollUpFallback() now yields 'denied' (if any
-- specialist denied) or 'needs_review', which these two check constraints
-- previously rejected — the insert would abort the whole generation.
--
-- 'needs_review' is already a legal recipe_adaptations.clinical_review_status
-- (see 003), so this only brings the two run-level verdict columns in line.

alter table recipe_brain_runs
  drop constraint if exists recipe_brain_runs_verdict_check;

alter table recipe_brain_runs
  add constraint recipe_brain_runs_verdict_check
    check (verdict is null or verdict in ('approved', 'approved_with_caveats', 'denied', 'needs_review'));

alter table chairman_synthesis_runs
  drop constraint if exists chairman_synthesis_runs_verdict_check;

alter table chairman_synthesis_runs
  add constraint chairman_synthesis_runs_verdict_check
    check (verdict is null or verdict in ('approved', 'approved_with_caveats', 'denied', 'needs_review'));
