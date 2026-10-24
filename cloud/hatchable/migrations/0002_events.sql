CREATE TABLE brain_events (
 id BIGSERIAL PRIMARY KEY,
 task_id BIGINT REFERENCES brain_tasks(id),
 event_type TEXT NOT NULL,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brain_events_recent ON brain_events(created_at DESC);