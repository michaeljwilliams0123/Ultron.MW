ALTER TABLE brain_tasks DROP CONSTRAINT brain_tasks_status_check;
ALTER TABLE brain_tasks ADD CONSTRAINT brain_tasks_status_check CHECK (status IN ('queued','leased','done','blocked','canceled','external'));
CREATE TABLE mahoraga_actions (
 id BIGSERIAL PRIMARY KEY,
 task_id BIGINT NOT NULL UNIQUE REFERENCES brain_tasks(id),
 action_key TEXT NOT NULL UNIQUE,
 operation TEXT NOT NULL CHECK (operation IN ('issue.create','verify.dispatch')),
 request JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','sent','uncertain','observed')),
 attempt_started_at TIMESTAMPTZ,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mahoraga_actions_recent ON mahoraga_actions(updated_at DESC);
