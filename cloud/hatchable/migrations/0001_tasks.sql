CREATE TABLE brain_tasks (
 id BIGSERIAL PRIMARY KEY,
 task_key TEXT NOT NULL UNIQUE,
 objective TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','done','blocked')),
 attempts INTEGER NOT NULL DEFAULT 0,
 max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
 lease_until TIMESTAMPTZ,
 owner_token TEXT,
 last_result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brain_tasks_ready ON brain_tasks(status, lease_until, created_at);