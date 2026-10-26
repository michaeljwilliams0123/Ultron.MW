-- Fenced task ownership. Applied after migration 0006 from PR #106.
-- Existing task/event receipts are deliberately preserved.
ALTER TABLE brain_tasks ADD COLUMN IF NOT EXISTS fencing_generation BIGINT NOT NULL DEFAULT 0;

-- Separate constraint validation prevents an ACCESS EXCLUSIVE lock over a table scan.
ALTER TABLE brain_tasks ADD CONSTRAINT brain_tasks_fencing_generation_nonnegative
 CHECK (fencing_generation >= 0) NOT VALID;
ALTER TABLE brain_tasks VALIDATE CONSTRAINT brain_tasks_fencing_generation_nonnegative;
