import test from 'node:test';
import assert from 'node:assert/strict';
import { admitRepairTask, assertRepairStep } from '../src/repair-admission.mjs';
import {requiredTokenPermissions,ULTRON_GITHUB_PRINCIPAL}
 from '../src/github-principal-policy.mjs';

const REPO = 'michaeljwilliams0123/Ultron.MW';
const BASE = 'a'.repeat(40);
const NOW = '2026-10-31T17:00:00.000Z';
const identity = (operation='identity.read') => ({
  source: 'github-installation-token-readback', verified: true,
  principal: ULTRON_GITHUB_PRINCIPAL, repository: REPO, repositoryId: 1424939667,
  installationId: 12345, actorRef: 'github-app:ultron-operator', operation,
  expiresAt: '2026-10-31T17:50:00Z',
  permissions: requiredTokenPermissions(operation),
});
const plan = () => ({
  schema: 'ultron.repair.plan.v1', owner: 'michaeljwilliams0123',
  objective: 'Repair a seeded failing unit test', repository: REPO,
  baseSha: BASE, branch: 'ultron/repair-seeded-test',
  allowedPaths: ['src/brain.mjs', 'test/brain.test.mjs'],
  idempotencyKey: 'repair:seeded-test-001',
  maxAttempts: 3, maxCostCents: 0, paidFallback: false,
  expiresAt: '2026-10-31T18:00:00Z',
});
const controls = () => ({ paused: false, revoked: false });
const admit = (overrides = {}) => admitRepairTask({
  plan: plan(), identityEvidence: identity(), controls: controls(), now: NOW,
  ...overrides,
});

test('admits only a pinned repository Repair App plan with zero paid budget', () => {
  const admission = admit();
  assert.equal(admission.schema, 'ultron.repair.admission.v1');
  assert.equal(admission.repository, REPO);
  assert.equal(admission.baseSha, BASE);
  assert.equal(admission.maxCostCents, 0);
  assert.equal(admission.paidFallback, false);
  assert.equal(admission.identity.principal, ULTRON_GITHUB_PRINCIPAL);
  assert.equal(Object.isFrozen(admission.allowedPaths), true);
  assert.equal(admission.identity.installationId, 12345);
  assert.equal(JSON.stringify(admission).includes('token'), false);
  assert.throws(() => admission.allowedPaths.push('src/other.mjs'), TypeError);
});

test('denies invented, stale, cross-repository or overprivileged identity', () => {
  for (const patch of [
    { verified: false },
    { source: 'model-claim' },
    { principal: 'repair-app' },
    { repository: 'other/repository' },
    { repositoryId: 123 },
    { installationId: 0 },
    { expiresAt: '2026-10-31T16:59:00Z' },
    { operation: 'repository.settings.update' },
    { permissions: { ...identity().permissions, administration: 'write' } },
    { permissions: { metadata: 'read', contents: 'write' } },
  ]) assert.throws(() => admit({ identityEvidence: { ...identity(), ...patch } }),
    /Unified GitHub App identity/);
});

test('denies invalid path, branch, base, objective, expiry and paid work', () => {
  for (const patch of [
    { repository: 'other/repo' },
    { baseSha: 'main' },
    { branch: 'main' },
    { branch: 'ultron/../../main' },
    { allowedPaths: ['.github/workflows/verify.yml'] },
    { allowedPaths: ['src/%2e%2e/secret.mjs'] },
    { allowedPaths: ['src/../secrets.mjs'] },
    { allowedPaths: ['src/brain.mjs', 'src/brain.mjs'] },
    { objective: 'x' },
    { maxAttempts: 10 },
    { maxCostCents: 1 },
    { paidFallback: true },
    { expiresAt: '2026-10-31T16:59:00Z' },
    { expiresAt: '2026-11-03T17:00:00Z' },
  ]) assert.throws(() => admit({ plan: { ...plan(), ...patch } }),
    /Repair plan/);
});

test('owner pause and revocation reject admission before any dispatch', () => {
  for (const patch of [{ paused: true }, { revoked: true }])
    assert.throws(() => admit({ controls: { ...controls(), ...patch } }),
      /paused or revoked/);
});

test('step verifies exact pinned branch, scope, actor and fresh controls', () => {
  const admission = admit();
  const step = { operation: 'branch.update', repository: REPO,
    branch: plan().branch, baseSha: BASE, path: 'src/brain.mjs',
    idempotencyKey: 'repair:seeded-test-001', attempt: 1 };
  const gate = { now: NOW, controls: controls(),
    identityEvidence: identity('repair.branch.update') };
  assert.equal(assertRepairStep(admission, step, gate).admitted, true);
  for (const patch of [
    { repository: 'other/repo' }, { branch: 'main' },
    { baseSha: 'b'.repeat(40) }, { path: 'src/other.mjs' },
    { attempt: 4 }, { idempotencyKey: 'repair:different-001' },
    { operation: 'main.push' }, { operation: 'pr.merge' },
    { operation: 'deploy' }, { operation: 'admin.update' },
    { operation: 'verify.dispatch' }, { operation: 'app.invoke-admin' },
  ]) assert.throws(() => assertRepairStep(admission, { ...step, ...patch }, gate),
    /Repair step/);
});

test('readback identity, control and expiry must remain valid for each step', () => {
  const a = admit();
  const step = { operation: 'pr.create', repository: REPO,
    branch: plan().branch, baseSha: BASE,
    idempotencyKey: plan().idempotencyKey, attempt: 1 };
  const context = { now: NOW, controls: controls(),
    identityEvidence: identity('repair.pr.create') };
  for (const patch of [
    { now: '2026-10-31T18:00:01Z' },
    { controls: { paused: true, revoked: false } },
    { controls: { paused: false, revoked: true } },
    { identityEvidence: { ...identity('repair.pr.create'), installationId: 54321 } },
    { identityEvidence: { ...identity('repair.pr.create'), expiresAt: '2026-10-31T16:00:00Z' } },
    { identityEvidence: identity('repository.settings.update') },
  ]) assert.throws(() => assertRepairStep(a, step, { ...context, ...patch }),
    /Repair step/);
});

test('a forged object or post-admission caller mutation cannot acquire authority', () => {
  const rawPlan = plan(), evidence = identity();
  const a = admit({ plan: rawPlan, identityEvidence: evidence });
  rawPlan.allowedPaths.push('src/escape.mjs');
  evidence.permissions={metadata:'read',administration:'write'};
  const gate = { now: NOW, controls: controls(),
    identityEvidence: identity('repair.pr.create') };
  assert.throws(() => assertRepairStep({ ...a }, {
    operation: 'pr.create', repository: REPO, branch: a.branch,
    baseSha: BASE, idempotencyKey: a.idempotencyKey, attempt: 1,
  }, gate), /Repair step/);
  assert.throws(() => assertRepairStep(a, {
    operation: 'branch.update', repository: REPO, branch: a.branch,
    baseSha: BASE, idempotencyKey: a.idempotencyKey, attempt: 1,
    path: 'src/escape.mjs',
  }, {...gate,identityEvidence:identity('repair.branch.update')}), /Repair step/);
});
