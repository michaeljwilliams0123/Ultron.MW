
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileComputerStore } from '../src/computer/file-store.mjs';

const sharingError = () => Object.assign(new Error('Windows sharing violation'), { code: 'EPERM' });
// Deterministic stand-in for successful replacement. Actual OS renames are
// exercised by browser smoke tests; fault injection must not depend on AV locks.
const completeReplacement = async (source, dest) => {
  await writeFile(dest, await readFile(source));
  await unlink(source);
};

test('transient checkpoint rename denial retries without losing the newest state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-checkpoint-retry-'));
  let renameCalls = 0;
  const renameFile = async (source, dest) => {
    renameCalls++;
    if (renameCalls === 2) throw sharingError();
    await completeReplacement(source, dest);
  };
  try {
    const store = createFileComputerStore(dir, { renameFile, pause: async () => {} });
    await store.write('objective-1', { id: 'objective-1', status: 'running', sequence: 1 });
    await store.write('objective-1', { id: 'objective-1', status: 'completed', sequence: 2 });
    assert.equal(renameCalls, 3, 'the transient failure must be observed and retried');
    const checkpoint = await store.read('objective-1');
    assert.equal(checkpoint.sequence, 2);
    assert.equal(checkpoint.status, 'completed');
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.pending')).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('persistent checkpoint rename denial preserves previous state and pending file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-checkpoint-retry-'));
  let renameCalls = 0;
  const renameFile = async (source, dest) => {
    renameCalls++;
    if (renameCalls >= 2) throw sharingError();
    await completeReplacement(source, dest);
  };
  try {
    const store = createFileComputerStore(dir, { renameFile, pause: async () => {} });
    await store.write('objective-2', { id: 'objective-2', status: 'running', sequence: 1 });
    await assert.rejects(
      store.write('objective-2', { id: 'objective-2', status: 'completed', sequence: 2 }),
      error => error.code === 'EPERM'
    );
    assert.equal(renameCalls, 5, 'only three retries are allowed');
    assert.equal((await store.read('objective-2')).sequence, 1);
    const pending = (await readdir(dir)).find(name => name.endsWith('.pending'));
    assert.ok(pending, 'failure retains uncertainty evidence for reconciliation');
    assert.equal(JSON.parse(await readFile(join(dir, pending), 'utf8')).sequence, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkpoint rename denial stops when the pending file disappears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-checkpoint-retry-'));
  let renameCalls = 0;
  const renameFile = async (source, dest) => {
    renameCalls++;
    if (renameCalls === 2) {
      await unlink(source);
      throw sharingError();
    }
    await completeReplacement(source, dest);
  };
  try {
    const store = createFileComputerStore(dir, { renameFile, pause: async () => {} });
    await store.write('objective-3', { id: 'objective-3', status: 'running', sequence: 1 });
    await assert.rejects(
      store.write('objective-3', { id: 'objective-3', status: 'completed', sequence: 2 }),
      error => error.code === 'EPERM'
    );
    assert.equal(renameCalls, 2, 'must not retry after the pending file disappears');
    assert.equal((await store.read('objective-3')).sequence, 1,
      'preserve last independently confirmed checkpoint');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
