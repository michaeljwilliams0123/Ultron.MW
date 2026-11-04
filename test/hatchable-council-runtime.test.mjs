import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { councilOidcAudience, verifyCouncilOidc } from '../cloud/hatchable/lib/council-oidc.js';
import { runCouncilActions, validateCouncilPlan } from '../cloud/hatchable/lib/council-runner.js';

const roles = ['Builder', 'Skeptic', 'Steward', 'Predictor', 'Generator', 'Sentinel', 'Companion'];
const sha = 'a'.repeat(40);
const ownerPlan = (changes = {}) => ({
  itemNumber: 40,
  isPr: false,
  sourceSha: '',
  ownerMode: true,
  hold: false,
  memberAssessments: roles.map(role => ({
    identity: { role },
    actions: role === 'Builder' ? [{ op: 'issue.comment', why: 'Review complete.' }] : []
  })),
  ...changes
});

test('council plan permits only seven unique roles and bounded safe actions', () => {
  assert.equal(validateCouncilPlan(ownerPlan()).memberAssessments.length, 7);
  assert.throws(() => validateCouncilPlan(ownerPlan({
    memberAssessments: [...ownerPlan().memberAssessments, ownerPlan().memberAssessments[0]]
  })));
  const unsafe = ownerPlan();
  unsafe.memberAssessments[0].actions = [{ op: 'pr.merge' }];
  assert.throws(() => validateCouncilPlan(unsafe));
});

test('council runner verifies target and executes each role with its own scoped token', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/issues/40')) return Response.json({ state: 'open' });
    return Response.json({ ok: true });
  };
  const result = await runCouncilActions({
    plan: ownerPlan(),
    installations: Object.fromEntries(roles.map(role => [role, { role }])),
    mintToken: async app => 'token-' + app.role,
    fetchImpl
  });
  assert.equal(result.filter(item => item.status === 'done').length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.authorization, 'Bearer token-Builder');
  assert.equal(calls[1].options.body, JSON.stringify({ body: '**Builder** (`ultron-mw-builder`): Review complete.' }));
});

test('council runner refuses a changed or wrong-kind target before actions', async () => {
  await assert.rejects(runCouncilActions({
    plan: ownerPlan({ isPr: true, sourceSha: sha }),
    installations: {},
    mintToken: async () => 'unused',
    fetchImpl: async () => Response.json({ state: 'open' })
  }), /council-target-changed/);
  await assert.rejects(runCouncilActions({
    plan: ownerPlan({ isPr: true, sourceSha: sha, memberAssessments: roles.map(role => ({ identity: { role }, actions: [] })) }),
    installations: {},
    mintToken: async () => 'unused',
    fetchImpl: async url => url.endsWith('/issues/40')
      ? Response.json({ state: 'open', pull_request: {} })
      : Response.json({ head: { sha: 'b'.repeat(40) } })
  }), /council-pr-head-changed/);
});

test('OIDC accepts only signed owner workflow identity and body on main', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = 1_800_000_000;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const rawBody = JSON.stringify(ownerPlan());
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: councilOidcAudience(rawBody),
    repository: 'michaeljwilliams0123/Ultron.MW',
    repository_id: '1424939667',
    repository_owner: 'michaeljwilliams0123',
    repository_owner_id: '308995719',
    repository_visibility: 'public',
    sub: 'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main',
    actor: 'michaeljwilliams0123',
    workflow_ref: 'michaeljwilliams0123/Ultron.MW/.github/workflows/council-debate.yml@refs/heads/main',
    ref: 'refs/heads/main',
    event_name: 'issues',
    sha,
    iat: now - 20,
    exp: now + 280
  };
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'trusted-key-1' });
  const payload = encode(claims);
  const signer = createSign('RSA-SHA256');
  signer.update(header + '.' + payload);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  const token = header + '.' + payload + '.' + signature;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'trusted-key-1', alg: 'RS256' };
  const fetchJwks = async () => Response.json({ keys: [jwk] });
  assert.deepEqual(await verifyCouncilOidc({ token, rawBody, fetchJwks, now: () => now * 1000 }), {
    actor: 'michaeljwilliams0123',
    sha,
    event: 'issues',
    audience: councilOidcAudience(rawBody)
  });
  const tampered = Buffer.from(token.split('.')[1], 'base64url');
  const badClaims = JSON.parse(tampered.toString());
  badClaims.actor = 'another-user';
  const badPayload = encode(badClaims);
  await assert.rejects(verifyCouncilOidc({
    token: header + '.' + badPayload + '.' + signature, rawBody, fetchJwks, now: () => now * 1000
  }));
  await assert.rejects(verifyCouncilOidc({ token, rawBody: rawBody + ' ', fetchJwks, now: () => now * 1000 }));
});
