CREATE TABLE council_room_messages (
 id BIGSERIAL PRIMARY KEY,
 message_key TEXT NOT NULL UNIQUE,
 room_key TEXT NOT NULL DEFAULT 'owner-main',
 author_type TEXT NOT NULL CHECK (author_type IN ('owner','member','system')),
 author_id TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message','fact','inference','action','question','result')),
 body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 6000),
 mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
 context JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX council_room_messages_feed ON council_room_messages(room_key,id DESC);

CREATE TABLE council_room_jobs (
 id BIGSERIAL PRIMARY KEY,
 message_id BIGINT NOT NULL UNIQUE REFERENCES council_room_messages(id) ON DELETE CASCADE,
 task_id BIGINT NOT NULL UNIQUE REFERENCES brain_tasks(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','blocked')),
 external_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX council_room_jobs_state ON council_room_jobs(state,updated_at DESC);