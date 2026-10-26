-- Fenced task ownership. Applied after migration 0006 from PR #106.
-- Existing task/event receipts are deliberately preserved.
ALTER TABLE brain_tasks ADD COLUMN IF NOT EXISTS fencing_generation BIGINT NOT NULL DEFAULT 0
 CHECK (fencing_generation >= 0);

-- The existing ready-work index remains valid; this index speeds fenced owner
-- transitions without changing the uniqueness of task_key.
CREATE INDEX IF NOT EXISTS brain_tasks_lease_fencing
 ON brain_tasks(id,fencing_generation) WHERE status='leased';
