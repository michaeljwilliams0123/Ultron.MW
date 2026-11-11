-- C04: durable ledger for one owner-signed, Coordinator-App-authored pull
-- request comment.
--
-- Additive and idempotent. This migration creates a NEW table instead of
-- altering github_idempotent_executions (0039): the historical branch ledger
-- keeps its columns, NOT NULL target_branch, CHECK constraints, indexes and
-- guard trigger exactly as they are. Nothing is dropped, relaxed, rewritten or
-- backfilled, and it does not depend on 0040 (the canary only writes the
-- canonical michaeljwilliams0123/Ultron.MW repository).
-- Safe to re-run: every object is created with IF NOT EXISTS or CREATE OR
-- REPLACE on names introduced here.
CREATE TABLE IF NOT EXISTS github_pr_comment_executions (
  idempotency_key TEXT PRIMARY KEY
    CHECK (idempotency_key ~ '^ultron-task-c04-pr[1-9][0-9]{0,8}-[a-f0-9]{24}$'),
  operation_digest TEXT NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  repository TEXT NOT NULL CHECK (repository='michaeljwilliams0123/Ultron.MW'),
  target_number BIGINT NOT NULL CHECK (target_number BETWEEN 1 AND 999999999),
  body_sha256 TEXT NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  grant_id TEXT NOT NULL UNIQUE REFERENCES brain_authority_grants(grant_id) ON DELETE RESTRICT,
  persona_role TEXT NOT NULL DEFAULT 'builder' CHECK (persona_role='builder'),
  state TEXT NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','in_flight','reconcile_required','completed')),
  provider_comment_id BIGINT UNIQUE,
  provider_url TEXT,
  provider_actor TEXT,
  provider_app_id BIGINT,
  receipt JSONB CHECK (receipt IS NULL OR jsonb_typeof(receipt)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository,target_number,body_sha256),
  CONSTRAINT github_pr_comment_executions_receipt_presence
    CHECK ((state='completed')=(receipt IS NOT NULL)),
  CONSTRAINT github_pr_comment_executions_provider_shape CHECK (
    (state<>'completed' AND provider_comment_id IS NULL AND provider_url IS NULL AND
      provider_actor IS NULL AND provider_app_id IS NULL) OR
    (state='completed' AND provider_comment_id>0 AND
      provider_url ~ '^https://github.com/michaeljwilliams0123/Ultron[.]MW/(issues|pull)/[1-9][0-9]*/?#issuecomment-[1-9][0-9]*$' AND
      provider_actor='ultron-coordinator[bot]' AND provider_app_id=5633654)
  ),
  CONSTRAINT github_pr_comment_executions_receipt_shape CHECK (receipt IS NULL OR (
    receipt->>'idempotencyKey'=idempotency_key AND
    receipt->>'status' IN ('success','reconciled_success','recovered_success') AND
    receipt->'details'->>'operationDigest'=operation_digest AND
    receipt->'details'->>'repository'=repository AND
    receipt->'details'->>'personaRole'=persona_role AND
    receipt->'details'->>'remoteVerified'='true' AND
    (receipt->'details'->>'pullRequest')::bigint=target_number AND
    receipt->'details'->>'bodySha256'=body_sha256 AND
    (receipt->'details'->>'commentId')::bigint=provider_comment_id AND
    receipt->'details'->>'commentUrl'=provider_url AND
    receipt->'details'->>'actor'=provider_actor AND
    (receipt->'details'->>'appId')::bigint=provider_app_id
  ) IS TRUE)
);

-- Identity, target, grant and provider identity are immutable after
-- reservation; completed rows are final; rows are never deleted.
CREATE OR REPLACE FUNCTION github_pr_comment_executions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'github-pr-comment-immutable'; END IF;
  IF OLD.state='completed' THEN RAISE EXCEPTION 'github-pr-comment-completed-immutable'; END IF;
  IF NEW.idempotency_key<>OLD.idempotency_key OR
     NEW.operation_digest<>OLD.operation_digest OR
     NEW.repository<>OLD.repository OR
     NEW.target_number<>OLD.target_number OR
     NEW.body_sha256<>OLD.body_sha256 OR
     NEW.grant_id<>OLD.grant_id OR
     NEW.persona_role<>OLD.persona_role OR
     NEW.created_at<>OLD.created_at OR
     (OLD.state='reconcile_required' AND NEW.state<>'completed') OR
     (OLD.state='in_flight' AND NEW.state NOT IN ('completed','reconcile_required')) OR
     (OLD.state='reserved' AND NEW.state NOT IN ('in_flight','completed','reconcile_required'))
  THEN RAISE EXCEPTION 'github-pr-comment-transition-denied'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS github_pr_comment_executions_guard_trg ON github_pr_comment_executions;
CREATE TRIGGER github_pr_comment_executions_guard_trg
 BEFORE UPDATE OR DELETE ON github_pr_comment_executions
 FOR EACH ROW EXECUTE FUNCTION github_pr_comment_executions_guard();
