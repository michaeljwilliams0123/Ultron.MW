import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalNativeConsent, canonicalNativeProposal, createNativeHost, nativeHostCapabilities,
} from '../src/computer/native-host.mjs';

const now = 1800000000000;
const publicPem = key => key.export({ type: 'spki', format: 'pem' });
const signature = (key, text) => sign(null, Buffer.from(text), key).toString('base64url');

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-native-contract-'));
  const proposer = generateKeyPairSync('ed25519');
  const owner = generateKeyPairSync('ed25519');
  const config = {
    hostId: 'owner-host', proposalPublicKey: publicPem(proposer.publicKey),
    ownerPublicKey: publicPem(owner.publicKey),
    targets: ['window-one'], workbooks: ['workbook-one'], maxPaidCents: 0,
  };
  let time = now;
  const clock = () => time;
  let sessionActive = true;
  const ownerSession = {
    canContinue: async () => sessionActive,
    verifyOwner: async context => context.sessionId === 'owner-session',
  };
  const host = await createNativeHost({ config, directory, clock, ownerSession });
  const makeProposal = (changes = {}) => ({
    purpose: 'ultron.native.proposal.v1', hostId: config.hostId, requestId: 'request-one',
    action: 'excel.write-cell',
    parameters: { workbook: 'workbook-one', sheet: 1, cell: 'B2', value: 'sample' },
    nonce: 'a'.repeat(64), expiresAt: now + 60000, ...changes,
  });
  const signProposal = p => signature(proposer.privateKey, canonicalNativeProposal(p, config, clock()));
  const makeConsent = (receipt, changes = {}) => ({
    purpose: 'ultron.native.consent.v1', hostId: config.hostId, requestId: receipt.requestId,
    action: 'excel.write-cell', proposalDigest: receipt.proposalDigest, decision: 'approve',
    sessionId: 'owner-session', nonce: 'b'.repeat(64), expiresAt: now + 60000, ...changes,
  });
  const signConsent = c => signature(owner.privateKey, canonicalNativeConsent(c, config, clock()));
  return { directory, config, host, clock, ownerSession, makeProposal, signProposal, makeConsent, signConsent,
    setTime: value => { time = value; }, revokeSession: () => { sessionActive = false; }, proposer, owner };
}

test('discovery is inert and registration requires explicitly configured separate keys', async () => {
  const capabilities = nativeHostCapabilities();
  assert.equal(capabilities.listener, false);
  assert.equal(capabilities.runtime, 'unavailable');
  assert.ok(capabilities.actions.every(item => !item.available));
  await assert.rejects(createNativeHost(), /fields/);
  const f = await fixture();
  try {
    await assert.rejects(createNativeHost({ config: { ...f.config,
      ownerPublicKey: f.config.proposalPublicKey }, directory: f.directory }), /registration-invalid/);
    await assert.rejects(createNativeHost({ config: { ...f.config,
      targets: ['different'] }, directory: f.directory, ownerSession: f.ownerSession }), /registration-conflict/);
    await assert.rejects(createNativeHost({ config: f.config, directory: f.directory }), /owner-session-required/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('signed proposal and exact owner consent persist; dispatch remains unavailable and one-use', async () => {
  const f = await fixture();
  try {
    const p = f.makeProposal();
    const receipt = await f.host.propose(p, f.signProposal(p));
    const c = f.makeConsent(receipt);
    assert.deepEqual(await f.host.recordConsent(c, f.signConsent(c), p),
      { requestId: 'request-one', status: 'approved' });
    const rebuilt = await createNativeHost({ config: f.config, directory: f.directory, clock: f.clock,
      ownerSession: f.ownerSession });
    assert.equal((await rebuilt.readback('request-one')).status, 'approved');
    assert.equal((await rebuilt.dispatch('request-one')).status, 'unavailable');
    assert.equal((await rebuilt.readback('request-one')).status, 'dispatch-unavailable');
    await assert.rejects(rebuilt.dispatch('request-one'), /consent-required/);
    await assert.rejects(rebuilt.recordConsent(c, f.signConsent(c), p), /replay/);
    assert.equal(JSON.stringify(await rebuilt.readback('request-one')).includes('sample'), false);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('tampering, unknown targets, paths, formulas, and unsupported operations fail closed', async () => {
  const f = await fixture();
  try {
    const p = f.makeProposal();
    const signed = f.signProposal(p);
    await assert.rejects(f.host.propose({ ...p,
      parameters: { ...p.parameters, cell: 'B3' } }, signed), /signature-invalid/);
    for (const bad of [
      f.makeProposal({ action: 'shell', parameters: { target: 'window-one' } }),
      f.makeProposal({ action: 'screen.observe', parameters: { target: 'unknown' } }),
      f.makeProposal({ parameters: { ...p.parameters, workbook: 'C:\\private.xlsx' } }),
      f.makeProposal({ parameters: { ...p.parameters, cell: 'XFE1' } }),
      f.makeProposal({ parameters: { ...p.parameters, value: ' =1+1' } }),
      f.makeProposal({ parameters: { ...p.parameters, command: 'credentials' } }),
    ]) await assert.rejects(f.host.propose(bad, signed));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('consent binds exact proposal and host, expires, and cannot be replayed across requests', async () => {
  const f = await fixture();
  try {
    const p = f.makeProposal();
    const receipt = await f.host.propose(p, f.signProposal(p));
    const wrong = f.makeConsent(receipt, { proposalDigest: 'f'.repeat(64) });
    await assert.rejects(f.host.recordConsent(wrong, f.signConsent(wrong), p), /mismatch/);
    const c = f.makeConsent(receipt);
    await assert.rejects(f.host.recordConsent(c, f.signConsent(c), {
      ...p, parameters: { ...p.parameters, cell: 'B3' },
    }), /mismatch/);
    await f.host.recordConsent(c, f.signConsent(c), p);
    const next = f.makeProposal({ requestId: 'request-two', nonce: 'c'.repeat(64) });
    const second = await f.host.propose(next, f.signProposal(next));
    const replay = f.makeConsent(second);
    await assert.rejects(f.host.recordConsent(replay, f.signConsent(replay), next), /replay/);
    f.setTime(now + 60000);
    await assert.rejects(f.host.dispatch('request-one'), /expired/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('denial and local revocation persist across host reconstruction', async () => {
  const f = await fixture();
  try {
    const p = f.makeProposal({ action: 'screen.observe', parameters: { target: 'window-one' } });
    const receipt = await f.host.propose(p, f.signProposal(p));
    const c = f.makeConsent(receipt, { action: 'screen.observe', decision: 'deny' });
    await f.host.recordConsent(c, f.signConsent(c), p);
    await assert.rejects(f.host.dispatch('request-one'), /consent-required/);
    await f.host.revoke();
    const rebuilt = await createNativeHost({ config: f.config, directory: f.directory, clock: f.clock,
      ownerSession: f.ownerSession });
    assert.equal((await rebuilt.readback('request-one')).status, 'denied');
    const next = f.makeProposal({ requestId: 'request-two', nonce: 'c'.repeat(64) });
    await assert.rejects(rebuilt.propose(next, f.signProposal(next)), /revoked/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('revoked or mismatched owner sessions cannot grant or consume consent', async () => {
  const f = await fixture();
  try {
    const p = f.makeProposal();
    const receipt = await f.host.propose(p, f.signProposal(p));
    const wrong = f.makeConsent(receipt, { sessionId: 'different-session' });
    await assert.rejects(f.host.recordConsent(wrong, f.signConsent(wrong), p), /owner-session-required/);
    const c = f.makeConsent(receipt);
    await f.host.recordConsent(c, f.signConsent(c), p);
    f.revokeSession();
    await assert.rejects(f.host.dispatch('request-one'), /owner-session-required/);
    assert.equal((await f.host.readback('request-one')).status, 'approved');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('owner-session verifier receives the exact normalized action parameters', async () => {
  const f = await fixture();
  try {
    let disclosure;
    f.ownerSession.verifyOwner = async context => {
      disclosure = context;
      return true;
    };
    const p = f.makeProposal();
    const receipt = await f.host.propose(p, f.signProposal(p));
    const c = f.makeConsent(receipt);
    await f.host.recordConsent(c, f.signConsent(c), p);
    assert.deepEqual(disclosure.parameters, {
      workbook: 'workbook-one', sheet: 1, cell: 'B2', value: 'sample',
    });
    assert.equal(disclosure.proposalDigest, receipt.proposalDigest);
    assert.equal(disclosure.hostId, 'owner-host');
    assert.equal(disclosure.action, 'excel.write-cell');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
