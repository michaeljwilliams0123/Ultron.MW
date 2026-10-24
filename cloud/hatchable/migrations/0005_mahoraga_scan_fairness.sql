-- Scheduling metadata only. Never modify an action's side-effect checkpoint.
ALTER TABLE mahoraga_actions ADD COLUMN last_scanned_at TIMESTAMPTZ;
CREATE INDEX mahoraga_actions_pending_scans
 ON mahoraga_actions(last_scanned_at ASC NULLS FIRST,id ASC)
 WHERE state IN ('prepared','sent','uncertain');
