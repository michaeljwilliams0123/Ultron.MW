-- Immutable receipts for material operations denied before any provider write.
CREATE TABLE IF NOT EXISTS governance_acceptance_receipts(
 id BIGSERIAL PRIMARY KEY,
 receipt_key TEXT NOT NULL UNIQUE CHECK(receipt_key ~ '^gov:[a-z0-9_.:-]{8,116}$'),
 fingerprint TEXT NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 scenario TEXT NOT NULL CHECK(scenario IN
  ('positive-cost','stale-fence','forbidden-operation','ineligible-release')),
 source_sha TEXT NOT NULL CHECK(source_sha ~ '^[a-f0-9]{40}$'),
 operation TEXT NOT NULL,
 requested_cost_cents INTEGER NOT NULL CHECK(requested_cost_cents>=0),
 expected_profile_version BIGINT NOT NULL CHECK(expected_profile_version>0),
 expected_stop_version BIGINT NOT NULL CHECK(expected_stop_version>0),
 task_id BIGINT,
 provided_fencing_generation BIGINT,
 pr_number BIGINT,
 pr_head_sha TEXT CHECK(pr_head_sha IS NULL OR pr_head_sha ~ '^[a-f0-9]{40}$'),
 disposition TEXT NOT NULL CHECK(disposition='held'),
 reason TEXT NOT NULL CHECK(reason IN
  ('source-drift','authority-version-stale','owner-paused','positive-cost-denied',
   'stale-fencing-generation','forbidden-operation-denied',
   'independent-review-required','release-mutation-not-authorized',
   'exact-head-ci-unverified')),
 provider_writes INTEGER NOT NULL DEFAULT 0 CHECK(provider_writes=0),
 observed JSONB NOT NULL CHECK(jsonb_typeof(observed)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION governance_acceptance_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'governance acceptance receipts are immutable';
END
$$;

DROP TRIGGER IF EXISTS governance_acceptance_immutable_guard
 ON governance_acceptance_receipts;
CREATE TRIGGER governance_acceptance_immutable_guard
 BEFORE UPDATE OR DELETE ON governance_acceptance_receipts
 FOR EACH ROW EXECUTE FUNCTION governance_acceptance_immutable();
