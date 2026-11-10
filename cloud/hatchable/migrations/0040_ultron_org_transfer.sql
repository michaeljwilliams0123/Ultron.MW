-- Forward-only transition to organization ownership (issue #370).
-- Preserve historical receipts referencing the former personal repository path.
-- Runtime code must issue new mutations ONLY to Ultron-MW/Ultron.MW.
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
