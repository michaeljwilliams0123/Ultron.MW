-- Additive C18 preferences only; no task, credential, GitHub App,
-- permission or provider authorization is changed by this migration.
CREATE TABLE IF NOT EXISTS brain_owner_autonomy_profile(
 id SMALLINT PRIMARY KEY CHECK(id=1),
 owner TEXT NOT NULL CHECK(owner='michaeljwilliams0123'),
 preset TEXT NOT NULL CHECK(preset IN ('observe','build','release')),
 allowed_operations JSONB NOT NULL CHECK(jsonb_typeof(allowed_operations)='array'
   AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 14),
 limits JSONB NOT NULL CHECK(jsonb_typeof(limits)='object'),
 max_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(max_paid_cents=0),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Build is a display/control preference and does not grant execution rights.
-- No existing runtime operation consults this profile until independently
-- tested and reviewed enforcement integration is deployed.
INSERT INTO brain_owner_autonomy_profile
 (id,owner,preset,allowed_operations,limits,max_paid_cents,version)
 VALUES (1,'michaeljwilliams0123','build',
 '["research.public","repo.inspect","plan.create","test.local","evidence.read","branch.create","branch.update","pr.open","pr.comment","verify.dispatch","capability.sandbox.propose","capability.sandbox.test"]'::jsonb,
 '{"maxFiles":12,"maxFileBytes":24000,"maxTotalBytes":96000,"maxConcurrent":4,"maxSteps":32}'::jsonb,
 0,1)
 ON CONFLICT(id) DO NOTHING;
