import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActionGateway, keyIsValid, validateAction } from '../src/action-gateway.mjs';

test('owner-key matching denies missing or incorrect keys', () => {
  assert.equal(keyIsValid('paired-key', 'paired-key'), true);
  assert.equal(keyIsValid('incorrect', 'paired-key'), false);
  assert.equal(keyIsValid(null, 'paired-key'), false);
});

test('bounded local note is written once and checked against independent file bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-action-'));
  const gateway = createActionGateway({ root: dir });
  const job = { id: randomUUID(), kind: 'local-note', title: 'Acceptance note',
    text: 'Completed local action with verified output.' };
  try {
    const receipt = await gateway.localNote(job);
    const bytes = await readFile(join(dir, receipt.file), 'utf8');
    assert.equal(receipt.verified, true);
    assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(bytes, '# Acceptance note\n\n' + job.text + '\n');
    await assert.rejects(() => gateway.localNote(job), /EEXIST/);
    assert.throws(() => validateAction({ ...job, id: '../outside' }), /valid action ID/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
