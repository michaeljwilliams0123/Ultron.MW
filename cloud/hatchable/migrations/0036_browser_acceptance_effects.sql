-- One immutable, harmless browser-origin test effect per owner-approved objective.
-- The Playwright worker holds no persistent SaaS credentials.
CREATE TABLE IF NOT EXISTS browser_acceptance_effects (
 id BIGSERIAL PRIMARY KEY,
 objective_key TEXT NOT NULL UNIQUE,
 source_sha CHAR(40) NOT NULL,
 approval_issue INTEGER NOT NULL,
 request_digest CHAR(64) NOT NULL,
 marker VARCHAR(80) NOT NULL,
 actor TEXT NOT NULL CHECK(actor = 'michaeljwilliams0123'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT browser_acceptance_objective_check CHECK (length(objective_key) BETWEEN 10 AND 80),
 CONSTRAINT browser_acceptance_issue_check CHECK (approval_issue > 0)
);
