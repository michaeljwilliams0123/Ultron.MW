import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPostConditionsAndStoreReceipt } from '../scripts/verify-post-conditions.mjs';

function sandbox(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'ultron-task5-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function gitFixture(t) {
  const cwd = sandbox(t);
  git(cwd, 'init', '-q');
  writeFileSync(join(cwd, 'example.txt'), 'first\n');
  git(cwd, 'add', 'example.txt');
  git(cwd, '-c', 'user.name=Task Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'first');
  const baseSha = git(cwd, 'rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'example.txt'), 'second\n');
  git(cwd, 'add', 'example.txt');
  git(cwd, '-c', 'user.name=Task Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'second');
  const headSha = git(cwd, 'rev-parse', 'HEAD');
  return { cwd, baseSha, headSha };
}

test('anchors a local diff to the exact receipt commit pair without claiming remote verification', async t => {
  const { cwd, baseSha, headSha } = gitFixture(t);
  const receipt = { idempotencyKey: 'ultron-task-42', status: 'completed', details: { baseSha, headSha, repository: 'michaeljwilliams0123/Ultron.MW', scopedToken: 'must-not-appear' } };
  const result = await verifyPostConditionsAndStoreReceipt(receipt, { cwd });
  assert.equal(result.status, 'LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED');
  assert.equal(result.remoteReadbackVerified, false);
  assert.deepEqual(result.changedFiles, ['example.txt']);
  assert.match(result.gitDiffSummary, /example\.txt/);
  const text = readFileSync(join(cwd, 'receipts', 'ultron-task-42.json'), 'utf8');
  assert.doesNotMatch(text, /must-not-appear|scopedToken/);
  assert.equal(JSON.parse(text).auditSha256, result.auditSha256);
});

test('without exact SHAs, records pending remote verification rather than invented local success', async t => {
  const cwd = sandbox(t);
  const result = await verifyPostConditionsAndStoreReceipt({idempotencyKey:'task-remote-1',status:'success',details:{remoteDispatch:true}}, {cwd});
  assert.equal(result.status, 'REMOTE_READBACK_REQUIRED');
  assert.equal(result.gitDiffSummary, null);
  assert.equal(result.remoteReadbackVerified, false);
});

test('failed execution is not marked verified', async t => {
  const cwd = sandbox(t);
  const result = await verifyPostConditionsAndStoreReceipt({idempotencyKey:'task-failed-1',status:'failed',details:{}}, {cwd});
  assert.equal(result.status, 'EXECUTION_NOT_SUCCEEDED');
});

test('repeat input returns the original write-once record, not a timestamp-changing overwrite', async t => {
  const cwd = sandbox(t);
  const receipt = {idempotencyKey:'task-repeat-1',status:'success',details:{}};
  const a = await verifyPostConditionsAndStoreReceipt(receipt, {cwd,now:()=>new Date('2026-11-09T10:00:00.000Z')});
  const b = await verifyPostConditionsAndStoreReceipt(receipt, {cwd,now:()=>new Date('2026-11-10T10:00:00.000Z')});
  assert.deepEqual(b,a);
  assert.equal(b.verifiedAt, '2026-11-09T10:00:00.000Z');
});

test('same key with different receipt cannot rewrite the artifact', async t => {
  const cwd = sandbox(t);
  await verifyPostConditionsAndStoreReceipt({idempotencyKey:'task-conflict-1',status:'success',details:{}}, {cwd});
  await assert.rejects(() => verifyPostConditionsAndStoreReceipt({idempotencyKey:'task-conflict-1',status:'failed',details:{}}, {cwd}), /conflicting audit receipt/);
});

test('rejects traversal and malformed ids before filesystem operations', async t => {
  const cwd = sandbox(t);
  await assert.rejects(() => verifyPostConditionsAndStoreReceipt({idempotencyKey:'../escape',status:'success'}, {cwd}), /invalid idempotencyKey/);
  assert.equal(existsSync(join(cwd, 'receipts')), false);
});

test('rejects head mismatch instead of diffing the wrong checkout', async t => {
  const {cwd,baseSha,headSha} = gitFixture(t);
  await assert.rejects(() => verifyPostConditionsAndStoreReceipt({idempotencyKey:'task-wrong-1',status:'success',details:{baseSha:headSha,headSha:baseSha}}, {cwd}), /HEAD mismatch/);
  assert.equal(existsSync(join(cwd,'receipts','task-wrong-1.json')), false);
});

test('detects an altered existing record on replay', async t => {
  const cwd = sandbox(t);
  const receipt = {idempotencyKey:'task-tamper-1',status:'success',details:{}};
  await verifyPostConditionsAndStoreReceipt(receipt, {cwd});
  const path = join(cwd,'receipts','task-tamper-1.json');
  const record = JSON.parse(readFileSync(path,'utf8'));
  record.status = 'LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED';
  writeFileSync(path,JSON.stringify(record));
  await assert.rejects(() => verifyPostConditionsAndStoreReceipt(receipt, {cwd}), /audit integrity mismatch/);
});

test('rejects accessors and functions in receipts before hashing or logging', async t => {
  const cwd = sandbox(t);
  const receipt = {idempotencyKey:'task-getter-1',status:'success',details:{}};
  Object.defineProperty(receipt.details,'token',{enumerable:true,get(){throw new Error('should not run');}});
  await assert.rejects(() => verifyPostConditionsAndStoreReceipt(receipt, {cwd}), /plain JSON data/);
});
