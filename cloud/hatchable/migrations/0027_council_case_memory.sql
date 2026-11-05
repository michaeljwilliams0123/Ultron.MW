-- C04 advisory memory: durable, content-addressed Council Room cases and role outputs.
-- This migration does not create GitHub identities, approve releases or enable providers.
CREATE TABLE IF NOT EXISTS brain_council_cases (
 id BIGSERIAL PRIMARY KEY,
 case_digest TEXT NOT NULL UNIQUE CHECK (case_digest ~ '^[a-f0-9]{64}$'),
 first_task_id BIGINT NOT NULL UNIQUE REFERENCES brain_tasks(id) ON DELETE RESTRICT,
 objective TEXT NOT NULL CHECK (objective='council.room'),
 policy_version TEXT NOT NULL DEFAULT 'c04-advisory-v1'
  CHECK (policy_version='c04-advisory-v1'),
 evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 status TEXT NOT NULL DEFAULT 'advisory' CHECK (status='advisory'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_council_cases_recent
 ON brain_council_cases(created_at DESC,id DESC);

-- Only deterministic, unverified role opinions may enter this source milestone.
-- Independent authentication requires a separately evidenced future migration.
CREATE TABLE IF NOT EXISTS brain_council_assessments (
 case_id BIGINT NOT NULL REFERENCES brain_council_cases(id) ON DELETE RESTRICT,
 role_id TEXT NOT NULL CHECK(role_id IN (
  'builder','skeptic','steward','predictor','generator','sentinel','companion'
 )),
 kind TEXT NOT NULL CHECK(kind IN ('action','inference','fact','question','result')),
 status TEXT NOT NULL CHECK(char_length(status) BETWEEN 1 AND 40),
 body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1200),
 identity_state TEXT NOT NULL DEFAULT 'unverified'
  CHECK (identity_state='unverified'),
 independence_verified BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT independence_verified),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (case_id,role_id)
);
CREATE INDEX IF NOT EXISTS brain_council_assessments_by_role
 ON brain_council_assessments(role_id,recorded_at DESC);
