-- Fenced task ownership. Applied after migration 0006 from PR #106.
-- Existing task/event receipts are deliberately preserved.
ALTER TABLE brain_tasks ADD COLUMN IF NOT EXISTS fencing_generation BIGINT NOT NULL DEFAULT 0
 CHECK (fencing_generation >= 0);
