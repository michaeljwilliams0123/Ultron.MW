import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { councilOidcAudience, councilRoomExecutionOidcAudience,
  verifyCouncilOidc, verifyCouncilRoomExecutionOidc } from '../cloud/hatchable/lib/council-oidc.js';
import { validateCouncilPlan } from '../cloud/hatchable/lib/council-plan.js';

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

test('execution receipt OIDC accepts only the issue-comment router and reusable workflow',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const now=1_800_000_000;
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const rawBody=JSON.stringify({schema:'ultron.council-room.execution.v1',
  phase:'planned',issueNumber:285,commentId:12345,
  commentBody:'@ultron implement Inspect the latest repository state'});
 const claims={
  iss:'https://token.actions.githubusercontent.com',
  aud:councilRoomExecutionOidcAudience(rawBody),
  repository:'michaeljwilliams0123/Ultron.MW',repository_id:'1424939667',
  repository_owner:'michaeljwilliams0123',repository_owner_id:'308995719',
  repository_visibility:'public',
  sub:'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main',
  actor:'michaeljwilliams0123',
  workflow_ref:'michaeljwilliams0123/Ultron.MW/.github/workflows/owner-comment-router.yml@refs/heads/main',
  job_workflow_ref:'michaeljwilliams0123/Ultron.MW/.github/workflows/cloud-pr.yml@refs/heads/main',
  ref:'refs/heads/main',event_name:'issue_comment',sha,iat:now-20,exp:now+280
 };
 const header=encode({alg:'RS256',typ:'JWT',kid:'execution-key'});
 const payload=encode(claims);
 const signer=createSign('RSA-SHA256');
 signer.update(header+'.'+payload);
 signer.end();
 const signature=signer.sign(privateKey).toString('base64url');
 const token=header+'.'+payload+'.'+signature;
 const jwk={...publicKey.export({format:'jwk'}),kid:'execution-key',alg:'RS256'};
 const fetchJwks=async()=>Response.json({keys:[jwk]});
 assert.equal((await verifyCouncilRoomExecutionOidc({token,rawBody,fetchJwks,
  now:()=>now*1000})).event,'issue_comment');
 const wrongWorkflow={...claims,workflow_ref:
  'michaeljwilliams0123/Ultron.MW/.github/workflows/cloud-pr.yml@refs/heads/main'};
 const wrongPayload=encode(wrongWorkflow);
 const wrongSigner=createSign('RSA-SHA256');
 wrongSigner.update(header+'.'+wrongPayload);
 wrongSigner.end();
 const wrongToken=header+'.'+wrongPayload+'.'+wrongSigner.sign(privateKey).toString('base64url');
 await assert.rejects(verifyCouncilRoomExecutionOidc({token:wrongToken,rawBody,
  fetchJwks,now:()=>now*1000}));
});


test('proposal-only execution endpoint cannot accept an authenticated verified receipt',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../cloud/hatchable/api/brain/council-room-execution.js',import.meta.url),'utf8');
 const platform={db:{async query(){throw Error('proposal-only verification must not write database');}},
  scheduler:{},events:{}};
 globalThis.__executionRoutePlatform=platform;
 globalThis.__executionRouteOidc=async()=>({actor:'michaeljwilliams0123',event:'issue_comment'});
 const converted=source
  .replace("import {db,scheduler,events} from 'hatchable';",
   'const {db,scheduler,events}=globalThis.__executionRoutePlatform;')
  .replace("import {verifyCouncilRoomExecutionOidc} from 'lib/council-oidc.js';",
   'const verifyCouncilRoomExecutionOidc=globalThis.__executionRouteOidc;');
 assert.notEqual(converted,source,'the runtime module must use local testing dependencies');
 const module=await import('data:text/javascript;base64,'+Buffer.from(converted).toString('base64'));
 const body={
  schema:'ultron.council-room.execution.v1',phase:'verified',
  issueNumber:285,commentId:12345,
  commentBody:'@ultron implement Inspect the latest repository state',
  verification:{runId:'42',url:'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42',
   sha:'a'.repeat(40),conclusion:'success'}
 };
 const res={code:200,setHeader(){},status(n){this.code=n;return this;},
  json(v){return {status:this.code,body:v};}};
 try{
  const result=await module.default({rawBody:JSON.stringify(body),
   headers:{authorization:'Bearer '+'x'.repeat(300)}},res);
  assert.equal(result.status,422);
  assert.equal(result.body.error,'proposal-only-not-execution');
 }finally{
  delete globalThis.__executionRoutePlatform;
  delete globalThis.__executionRouteOidc;
 }
});
