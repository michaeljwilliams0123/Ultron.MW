-- Source-locked C06 model-origin canary: only read-only GitHub verification
-- and a durable local owner-initiated receipt. No paid inference or PR writes.
CREATE TABLE IF NOT EXISTS c06_live_receipts(
 id BIGSERIAL PRIMARY KEY,
 task_key TEXT NOT NULL UNIQUE CHECK(task_key ~ '^c06-[a-z0-9-]{8,70}$'),
 stop_version INTEGER NOT NULL CHECK(stop_version>0),
 owner TEXT NOT NULL CHECK(owner='michaeljwilliams0123'),
 provider_run_id BIGINT NOT NULL CHECK(provider_run_id=41775191071),
 source_sha TEXT NOT NULL CHECK(source_sha='e2dda037f6d0512abf66d5a9666f98c1d62f2f92'),
 artifact_id BIGINT NOT NULL CHECK(artifact_id=13295973797),
 artifact_digest TEXT NOT NULL CHECK(artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
 model_decision TEXT NOT NULL CHECK(model_decision='verified'),
 paid_cents INTEGER NOT NULL CHECK(paid_cents=0),
 evidence_type TEXT NOT NULL CHECK(evidence_type='independent-github-run-and-artifact-metadata'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS c06_live_receipts_history
 ON c06_live_receipts(created_at DESC);
