import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { VAULT_KEY, createBrowserVault } from '../docs/browser-vault.mjs';

function memoryStorage() {
  const records = new Map();
  let rejectWrites = false;
  return {
    getItem: key => records.has(key) ? records.get(key) : null,
    setItem: (key, value) => {
      if (rejectWrites) throw Error('Simulated browser storage failure');
      records.set(key, String(value));
    },
    removeItem: key => { records.delete(key); },
    failWrites: flag => { rejectWrites = flag; },
  };
}
const create = storage => createBrowserVault({ storage, cryptoApi: webcrypto });
const passphrase = 'a-long-owner-passphrase';
const record = i => ({
  prompt: 'Question ' + i,
  answer: 'Answer ' + i,
  model: 'mock-browser-model',
});

test('memory is disabled by default and does not write or expose plaintext', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  assert.equal(vault.saved(), false);
  assert.equal(vault.unlocked(), false);
  assert.equal(vault.snapshot().exchanges.length, 0);
  assert.equal(storage.getItem(VAULT_KEY), null);
  await assert.rejects(() => vault.record(record(1)), /Unlock memory first/);
  await vault.open(passphrase);
  assert.equal(vault.saved(), true);
  assert.equal(vault.unlocked(), true);
  assert.doesNotMatch(storage.getItem(VAULT_KEY), /Question 1|passphrase/);
});

test('encrypted exchanges survive refresh but require passphrase again', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  const entry = await vault.record(record(1));
  assert.ok(entry.id);
  const sealed = storage.getItem(VAULT_KEY);
  assert.doesNotMatch(sealed, /Question 1|Answer 1|mock-browser-model/);
  vault.lock();
  assert.equal(vault.snapshot().exchanges.length, 0);
  const nextSession = create(storage);
  assert.equal(nextSession.saved(), true);
  await assert.rejects(() => nextSession.open('incorrect-passphrase'), /Could not unlock/);
  assert.equal(nextSession.unlocked(), false);
  await nextSession.open(passphrase);
  assert.equal(nextSession.snapshot().exchanges[0].id, entry.id);
  assert.equal(nextSession.snapshot().exchanges[0].prompt, 'Question 1');
});

test('feedback is persisted without claiming independently verified learning', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  const first = await vault.record(record(1));
  const second = await vault.record(record(2));
  await vault.rate(first.id, 'helpful');
  await vault.rate(second.id, 'not-helpful');
  assert.deepEqual(vault.statistics(), { total: 2, helpful: 1, notHelpful: 1, unrated: 0 });
  const context = vault.context();
  assert.equal(context.filter(x => x.role === 'assistant').length, 2);
  assert.equal(context.some(x => /not helpful/i.test(x.content)), true);
  vault.lock();
  const recovered = create(storage);
  await recovered.open(passphrase);
  assert.equal(recovered.statistics().notHelpful, 1);
  await assert.rejects(() => recovered.rate(first.id, 'not-a-rating'), /Invalid feedback/);
});

test('memory retains only the latest 32 responses and bounds context', async () => {
  const vault = create(memoryStorage());
  await vault.open(passphrase);
  for (let i = 0; i < 36; i++) await vault.record(record(i));
  assert.equal(vault.statistics().total, 32);
  const snapshot = vault.snapshot();
  assert.equal(snapshot.exchanges.at(0).prompt, 'Question 4');
  assert.equal(snapshot.exchanges.at(-1).prompt, 'Question 35');
  assert.equal(vault.context().filter(x => x.role === 'assistant').length, 3);
});

test('concurrent feedback and writes serialize without losing records', async () => {
  const vault = create(memoryStorage());
  await vault.open(passphrase);
  const additions = await Promise.all(Array.from({ length: 8 }, (_, i) => vault.record(record(i))));
  assert.equal(additions.length, 8);
  await Promise.all(additions.slice(0, 3).map(item => vault.rate(item.id, 'helpful')));
  assert.equal(vault.statistics().total, 8);
  assert.equal(vault.statistics().helpful, 3);
});

test('failed encryption persistence never commits an in-memory fake record', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  storage.failWrites(true);
  await assert.rejects(() => vault.record(record(1)), /Simulated browser storage failure/);
  assert.equal(vault.statistics().total, 0);
  storage.failWrites(false);
  await vault.record(record(2));
  assert.equal(vault.statistics().total, 1);
  assert.equal(vault.snapshot().exchanges[0].prompt, 'Question 2');
});

test('encrypted backups remain ciphertext and can be removed by explicit deletion', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  await vault.record(record(1));
  const backup = JSON.parse(vault.encryptedBackup());
  assert.equal(backup.version, 1);
  assert.equal(typeof backup.ciphertext, 'string');
  vault.clear();
  assert.equal(vault.saved(), false);
  assert.equal(vault.unlocked(), false);
  assert.equal(storage.getItem(VAULT_KEY), null);
});

test('corrupted storage and weak passphrases reject before modification', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await assert.rejects(() => vault.open('short'), /at least 10 characters/);
  assert.equal(storage.getItem(VAULT_KEY), null);
  storage.setItem(VAULT_KEY, '{"version":1,"salt":"!!!"}');
  await assert.rejects(() => vault.open(passphrase), /Invalid encrypted/);
  assert.equal(vault.unlocked(), false);
});


test('encrypted export can be imported to another device with the same passphrase', async () => {
  const source = create(memoryStorage());
  await source.open(passphrase);
  const saved = await source.record(record(1));
  await source.rate(saved.id, 'helpful');
  const encrypted = source.encryptedBackup();
  const destination = create(memoryStorage());
  assert.equal(destination.saved(), false);
  await destination.importBackup(encrypted, passphrase);
  assert.equal(destination.unlocked(), true);
  assert.equal(destination.snapshot().exchanges[0].id, saved.id);
  assert.equal(destination.statistics().helpful, 1);
  assert.equal(destination.encryptedBackup(), encrypted);
});

test('import rejects bad passphrase and refuses overwrite without owner confirmation', async () => {
  const source = create(memoryStorage());
  await source.open(passphrase);
  await source.record(record(1));
  const encrypted = source.encryptedBackup();
  const target = create(memoryStorage());
  await assert.rejects(() => target.importBackup(encrypted, 'wrong-passphrase'), /Could not decrypt/);
  assert.equal(target.saved(), false);
  await target.open(passphrase);
  await target.record(record('original'));
  const original = target.encryptedBackup();
  await assert.rejects(() => target.importBackup(encrypted, passphrase), /explicit replacement approval/);
  assert.equal(target.encryptedBackup(), original);
  const imported = await target.importBackup(encrypted, passphrase, { replace: true });
  assert.equal(imported.exchanges[0].prompt, 'Question 1');
});

test('storage failure during import retains existing encrypted memory', async () => {
  const source = create(memoryStorage());
  await source.open(passphrase);
  await source.record(record(1));
  const encrypted = source.encryptedBackup();
  const storage = memoryStorage();
  const target = create(storage);
  await target.open(passphrase);
  await target.record(record('original'));
  const original = target.encryptedBackup();
  storage.failWrites(true);
  await assert.rejects(() => target.importBackup(encrypted, passphrase, { replace: true }), /storage failure/);
  storage.failWrites(false);
  assert.equal(target.encryptedBackup(), original);
  assert.equal(target.snapshot().exchanges[0].prompt, 'Question original');
});


test('routing evaluations adopt only measured improvements and stay encrypted across refresh', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  assert.equal(vault.evolution().accepted, 'routing-v1');
  const result = await vault.evaluateAndAdopt();
  assert.equal(result.status, 'adopted');
  assert.ok(result.delta > 0);
  assert.equal(result.criticalRegressions, 0);
  assert.equal(result.promotion.kind, 'routing-promotion-receipt');
  assert.equal(result.promotion.authorityUnchanged, true);
  assert.equal(vault.evolution().accepted, 'routing-v2');
  assert.equal((await vault.evaluateAndAdopt()).status, 'already-adopted');
  assert.doesNotMatch(storage.getItem(VAULT_KEY), /routing-v2|benchmark/);
  vault.lock();
  const opened = create(storage);
  assert.equal(opened.evolution().accepted, 'routing-v1');
  await opened.open(passphrase);
  assert.equal(opened.evolution().accepted, 'routing-v2');
  assert.equal(opened.evolution().evaluations.length, 1);
  assert.equal(opened.evolution().evaluations[0].promotion.commitStage, 'commit');
  const restored = await opened.rollbackRouting('owner-request');
  assert.equal(restored.accepted, 'routing-v1');
});

test('legacy version-one encrypted backups upgrade to a versioned learning ledger without losing chats', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  const recorded = await vault.record(record(9));
  const original = vault.encryptedBackup();
  vault.lock();
  const newSession = create(storage);
  await newSession.open(passphrase);
  assert.equal(newSession.snapshot().exchanges[0].id, recorded.id);
  assert.equal(newSession.evolution().accepted, 'routing-v1');
  assert.ok(original.includes('ciphertext'));
});

test('failed persistence cannot silently adopt a routing candidate', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  storage.failWrites(true);
  await assert.rejects(() => vault.evaluateAndAdopt(), /storage failure/);
  assert.equal(vault.evolution().accepted, 'routing-v1');
  storage.failWrites(false);
  assert.equal((await vault.evaluateAndAdopt()).status, 'adopted');
});


test('browser plans are encrypted, restored and remain non-executable on reload', async () => {
  const storage = memoryStorage();
  const vault = create(storage);
  await vault.open(passphrase);
  const plan = {
    objective: 'inspect repository',
    strategy: 'routing-v1', autonomous: false,
    steps: [{ index: 0, description: 'inspect repository', command: null,
      kind: 'needs-capability', status: 'blocked', reason: 'not available' }],
  };
  const saved = await vault.savePlan(plan);
  assert.equal(saved.status, 'draft');
  assert.doesNotMatch(storage.getItem(VAULT_KEY), /inspect repository/);
  vault.lock();
  const reloaded = create(storage);
  await reloaded.open(passphrase);
  assert.equal(reloaded.snapshot().plans[0].objective, 'inspect repository');
  assert.equal(reloaded.snapshot().plans[0].autonomous, false);
});
