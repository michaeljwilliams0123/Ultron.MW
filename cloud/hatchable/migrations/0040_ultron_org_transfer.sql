-- Historical org-transfer constraint compatibility; canonical owner remains michaeljwilliams0123.
-- Preserve immutable receipts referencing the retired Ultron-MW/Ultron.MW path.
-- New runtime mutations MUST target michaeljwilliams0123/Ultron.MW (repository ID 1424939667).
-- This migration changes no owner, backfills no receipts, and grants no privileges.
ALTER TABLE brain_continuum_outbox
  DROP CONSTRAINT IF EXISTS brain_continuum_outbox_repository_check;
ALTER TABLE brain_continuum_outbox
  ADD CONSTRAINT brain_continuum_outbox_repository_check
  CHECK (repository IN ('michaeljwilliams0123/Ultron.MW','Ultron-MW/Ultron.MW'));
ALTER TABLE github_idempotent_executions
  DROP CONSTRAINT IF EXISTS github_idempotent_executions_repository_check;
ALTER TABLE github_idempotent_executions
  ADD CONSTRAINT github_idempotent_executions_repository_check
  CHECK (repository IN ('michaeljwilliams0123/Ultron.MW','Ultron-MW/Ultron.MW'));
