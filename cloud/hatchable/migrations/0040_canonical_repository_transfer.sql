-- Migration 0040: exact canonical repository owner after the organization transfer.
-- Deliberately leave the already-applied migration 0039 untouched.
-- One ALTER TABLE operation atomically replaces the old repository CHECK:
-- legacy rows fail validation and abort the entire DDL, preserving old rules.
-- This must be applied before enabling Task 4 production write execution.
ALTER TABLE github_idempotent_executions
 DROP CONSTRAINT IF EXISTS github_idempotent_executions_repository_check,
 ADD CONSTRAINT github_idempotent_executions_repository_check
 CHECK (repository='Ultron-MW/Ultron.MW');
