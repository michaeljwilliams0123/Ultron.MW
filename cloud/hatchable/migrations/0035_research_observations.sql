-- C09: distinct source/version observations, not repeated review tickets.
-- Every research scan is stored in brain_tasks/brain_events. Only newly observed
-- version drift is promoted to one bounded Council review task.
CREATE TABLE IF NOT EXISTS brain_research_observations(
 repository TEXT NOT NULL
  CHECK(length(repository) BETWEEN 3 AND 100 AND repository ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
 version TEXT NOT NULL
  CHECK(length(version) BETWEEN 2 AND 24 AND version ~ '^v[0-9]+(\.[0-9]+){0,2}$'),
 pinned_version TEXT NOT NULL
  CHECK(length(pinned_version) BETWEEN 2 AND 24 AND pinned_version ~ '^v[0-9]+(\.[0-9]+){0,2}$'),
 source_url TEXT NOT NULL
  CHECK(length(source_url) BETWEEN 24 AND 250 AND source_url LIKE 'https://github.com/%'),
 published_at TIMESTAMPTZ NOT NULL,
 priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 100),
 cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(cost_cents=0),
 first_task_id BIGINT NOT NULL REFERENCES brain_tasks(id),
 first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(repository,version,pinned_version)
);
CREATE INDEX IF NOT EXISTS brain_research_observations_first_task_idx
 ON brain_research_observations(first_task_id);
