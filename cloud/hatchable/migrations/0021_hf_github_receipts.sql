-- Dedicated GitHub HMAC workflow receipts. No provider credential, code, prompt or
-- raw GitHub body is persisted. All metadata was admitted after HMAC validation.
CREATE TABLE IF NOT EXISTS hf_github_receipts (
 id BIGSERIAL PRIMARY KEY,
 delivery_id TEXT NOT NULL UNIQUE CHECK (delivery_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 run_id BIGINT NOT NULL CHECK (run_id>0),
 run_attempt INTEGER NOT NULL CHECK (run_attempt>0),
 workflow_key TEXT NOT NULL CHECK (workflow_key IN ('heldout','tournament','c06')),
 source_sha TEXT NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
 conclusion TEXT NOT NULL CHECK (conclusion IN
  ('success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure')),
 payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','retry','verified','held')),
 artifact_evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifact_evidence)='array'),
 github_verified_at TIMESTAMPTZ,
 verification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (verification_attempts BETWEEN 0 AND 4),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
 failure_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(run_id,run_attempt)
);
CREATE INDEX IF NOT EXISTS hf_github_receipts_queue
 ON hf_github_receipts(state,next_attempt_at,lease_until);
CREATE INDEX IF NOT EXISTS hf_github_receipts_latest
 ON hf_github_receipts(workflow_key,run_id DESC);
