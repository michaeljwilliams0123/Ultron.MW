CREATE TABLE brain_notes (
 id BIGSERIAL PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('goal','observation','decision')),
 body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1200),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brain_notes_recent ON brain_notes(created_at DESC);
ALTER TABLE brain_tasks DROP CONSTRAINT brain_tasks_status_check;
ALTER TABLE brain_tasks ADD CONSTRAINT brain_tasks_status_check CHECK (status IN ('queued','leased','done','blocked','canceled'));