import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (file) => readFileSync(new URL('../cloud/hatchable/' + file, import.meta.url), 'utf8');
const CANONICAL = 'Ultron-MW/Ultron.MW';
const ORIGINAL = 'michaeljwilliams0123/Ultron.MW';
const SUBJECT = 'repo:Ultron-MW@354776009/Ultron.MW@1424939667:ref:refs/heads/main';

test('Hatchable issue and Council integrations point only at transferred repository', () => {
  for (const file of [
    'lib/github-issue-read.js',
    'lib/github-issue-write.js',
    'lib/council-issues.js',
    'lib/issue-council-plan.js',
    'lib/council-room-core.js',
    'lib/github-public-read.js',
    'lib/connectivity-view.js'
  ]) {
    const body = source(file);
    assert.ok(body.includes(CANONICAL), file + ' does not reference canonical repository');
    assert.ok(!body.includes(ORIGINAL), file + ' still trusts the former owner/repository path');
  }
});

test('OIDC bridge pins transferred immutable owner/repository identity', () => {
  for (const file of ['lib/council-oidc.js', 'lib/github-oidc-bridge.js']) {
    const body = source(file);
    assert.ok(body.includes(CANONICAL), file + ' missing canonical repository');
    assert.ok(body.includes(SUBJECT) || (body.includes('repo:Ultron-MW@354776009/Ultron.MW@1424939667:ref:') && body.includes("const REF='refs/heads/main'")), file + ' missing immutable subject');
    assert.ok(body.includes('354776009'), file + ' missing organization ID');
    assert.ok(body.includes('1424939667'), file + ' missing preserved repository ID');
    assert.ok(!body.includes('repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667'), file + ' still accepts old OIDC subject');
  }
});

test('OIDC actor checks bind GitHub login to immutable ID rather than login alone', () => {
  for (const file of ['lib/council-oidc.js', 'lib/github-oidc-bridge.js']) {
    const body = source(file);
    assert.match(body, /claims\.actor_id/);
    assert.match(body, /354634860/);
    assert.match(body, /308995719/);
  }
});

test('forward migration admits new identity while preserving historical rows', () => {
  assert.match(source('migrations/0013_continuum_outbox.sql'), /michaeljwilliams0123\/Ultron\.MW/);
  assert.match(source('migrations/0039_github_idempotent_executions.sql'), /michaeljwilliams0123\/Ultron\.MW/);
  const forward = source('migrations/0040_ultron_org_transfer.sql');
  assert.match(forward, /Ultron-MW\/Ultron\.MW/);
  assert.match(forward, /michaeljwilliams0123\/Ultron\.MW/);
  assert.match(forward, /CHECK/);
});

test('public read and execution URLs do not reference old repository path', () => {
  for (const file of ['lib/brain-core.js', 'lib/connectivity-view.js']) {
    const body = source(file);
    assert.ok(!body.includes('michaeljwilliams0123.github.io/Ultron.MW/'), file + ' old Pages URL');
    if (file === 'lib/brain-core.js') assert.ok(body.includes('https://ultron-mw.github.io/Ultron.MW/'), file + ' missing new Pages URL');
  }
});
