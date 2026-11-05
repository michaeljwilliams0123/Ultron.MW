ALTER TABLE council_room_jobs
 ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'not_requested'
  CHECK (execution_state IN (
   'not_requested','planned','dispatching','dispatched','observing',
   'verified','blocked','needs-owner'
  )),
 ADD COLUMN external_id TEXT,
 ADD COLUMN external_kind TEXT,
 ADD COLUMN idempotency_key TEXT,
 ADD COLUMN request_digest TEXT,
 ADD COLUMN execution_result JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(execution_result)='object');

ALTER TABLE council_room_jobs
 ADD CONSTRAINT council_room_external_artifact_pair
  CHECK ((external_id IS NULL) = (external_url IS NULL)),
 ADD CONSTRAINT council_room_external_kind_pair
  CHECK ((external_id IS NULL) = (external_kind IS NULL)),
 ADD CONSTRAINT council_room_execution_request_pair
  CHECK ((idempotency_key IS NULL) = (request_digest IS NULL));

CREATE UNIQUE INDEX council_room_jobs_idempotency
 ON council_room_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX council_room_jobs_execution_state
 ON council_room_jobs(execution_state,updated_at DESC);
