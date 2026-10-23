import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyHatchableParity } from '../scripts/verify-hatchable-parity.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'abcdef0123456789abcdef0123456789abcdef01';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ultron-parity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputs = {
    'api/brain/run.js': 'export const run = 1;\n',
    'lib/brain-runner.js': 'export const worker = 2;\n',
    'mcp/ultron_status.js': 'export const status = 3;\n',
    'migrations/0001.sql': 'SELECT 1;\n',
    'hatchable.toml': '[project]\nname = "ultron"\n'
  };
  for (const [path, content] of Object.entries(inputs)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const file_manifest = Object.entries(inputs).map(([path, content]) => ({
    path,
    hash: createHash('sha256').update(content).digest('hex'),
    size: Buffer.byteLength(content)
  }));
  const snapshot = { version: 2, status: 'live', file_manifest };
  const check = (overrides = {}) => verifyHatchableParity({
    snapshot, sourceRoot: root, expectedVersion: 2,
    expectedHead: HEAD, actualHead: HEAD, ...overrides
  });
  return { root, snapshot, check };
}
test('identical deployed manifest and source pass', async t => {
  const { check } = await fixture(t);
  const result = await check();
  assert.equal(result.parity, true);
  assert.equal(result.filesCompared, 5);
  assert.deepEqual(result.differences, []);
});
test('changed deployed source cannot produce a false parity', async t => {
  const { root, check } = await fixture(t);
  await writeFile(join(root, 'lib/brain-runner.js'), 'changed');
  const result = await check();
  assert.equal(result.parity, false);
  assert.deepEqual(result.differences.map(d => d.type), ['changed-file']);
});
test('missing deployed file fails parity', async t => {
  const { snapshot, check } = await fixture(t);
  snapshot.file_manifest = snapshot.file_manifest.filter(x => x.path !== 'api/brain/run.js');
  const result = await check();
  assert.equal(result.parity, false);
  assert.equal(result.differences[0].type, 'missing-deployment-file');
});
test('extra file in deployed manifest also fails', async t => {
  const { snapshot, check } = await fixture(t);
  snapshot.file_manifest.push({
    path: 'lib/deleted.js',
    hash: 'a'.repeat(64),
    size: 5
  });
  const result = await check();
  assert.equal(result.parity, false);
  assert.equal(result.differences[0].type, 'missing-source-file');
});
test('stale GitHub head invalidates otherwise matching manifest', async t => {
  const { check } = await fixture(t);
  const result = await check({ actualHead: OTHER });
  assert.equal(result.parity, false);
  assert.equal(result.differences[0].type, 'stale-head');
});
test('stale or non-live deployment version is rejected', async t => {
  const { check, snapshot } = await fixture(t);
  await assert.rejects(check({ expectedVersion: 3 }), /Invalid, stale/);
  snapshot.status = 'superseded';
  await assert.rejects(check(), /Invalid, stale/);
});
test('unsafe, invalid-hash and duplicate manifest entries are rejected', async t => {
  const { check, snapshot } = await fixture(t);
  snapshot.file_manifest.push({ ...snapshot.file_manifest[0] });
  await assert.rejects(check(), /Malformed, duplicate/);
  snapshot.file_manifest.pop();
  snapshot.file_manifest[0].path = '../private';
  await assert.rejects(check(), /Malformed, duplicate/);
  snapshot.file_manifest[0].path = 'api/brain/run.js';
  snapshot.file_manifest[0].hash = 'invalid';
  await assert.rejects(check(), /Malformed, duplicate/);
});
test('unexpected additional local source file invalidates parity', async t => {
  const { root, check } = await fixture(t);
  await writeFile(join(root, 'lib/untracked.js'), 'export default true;');
  const result = await check();
  assert.equal(result.parity, false);
  assert.ok(result.differences.some(d => d.path === 'lib/untracked.js'));
});
test('a mismatched declared file size fails parity', async t => {
  const { check, snapshot } = await fixture(t);
  snapshot.file_manifest[0].size++;
  const result = await check();
  assert.equal(result.parity, false);
  assert.equal(result.differences[0].type, 'changed-file');
});

test('repository mode compares immutable Git blobs rather than transformed working-tree bytes', async t => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'ultron-parity-git-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const sourceRoot = join(repoRoot, 'cloud', 'hatchable');
  const inputs = {
    'api/brain/run.js': 'export const run = 1;\n',
    'lib/brain-runner.js': 'export const worker = 2;\n',
    'mcp/ultron_status.js': 'export const status = 3;\n',
    'migrations/0001.sql': 'SELECT 1;\n',
    'hatchable.toml': '[project]\nname = "ultron"\n'
  };
  for (const [path, content] of Object.entries(inputs)) {
    await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
    await writeFile(join(sourceRoot, path), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', [
    '-c', 'user.name=Ultron Test', '-c', 'user.email=ultron@example.invalid',
    'commit', '-q', '-m', 'fixture'
  ], { cwd: repoRoot });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot, encoding: 'utf8'
  }).trim();
  const snapshot = {
    version: 2,
    status: 'live',
    file_manifest: Object.entries(inputs).map(([path, content]) => ({
      path,
      hash: createHash('sha256').update(content).digest('hex'),
      size: Buffer.byteLength(content)
    }))
  };
  await writeFile(join(sourceRoot, 'api/brain/run.js'), 'export const run = 1;\r\n');
  const result = await verifyHatchableParity({
    snapshot, sourceRoot, repoRoot, expectedVersion: 2,
    expectedHead: head, actualHead: head
  });
  assert.equal(result.parity, true);
  assert.deepEqual(result.differences, []);
});
