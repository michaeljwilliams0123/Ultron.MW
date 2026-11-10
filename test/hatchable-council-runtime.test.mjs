import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { councilOidcAudience, councilRoomExecutionOidcAudience,
  verifyCouncilOidc, verifyCouncilRoomExecutionOidc } from '../cloud/hatchable/lib/council-oidc.js';
import { validateCouncilPlan } from '../cloud/hatchable/lib/council-plan.js';
import { parseIssueCommentPrRequest, PR_OWNER, PR_REPOSITORY } from '../src/cloud-pr.mjs';

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
    repository: 'Ultron-MW/Ultron.MW',
    repository_id: '1424939667',
    repository_owner: 'Ultron-MW',
    repository_owner_id: '354776009',
    repository_visibility: 'public',
    sub: 'repo:Ultron-MW@354776009/Ultron.MW@1424939667:ref:refs/heads/main',
    actor: 'michaeljwilliams0123',actor_id: '308995719',
    workflow_ref: 'Ultron-MW/Ultron.MW/.github/workflows/council-debate.yml@refs/heads/main',
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
  repository:'Ultron-MW/Ultron.MW',repository_id:'1424939667',
  repository_owner:'Ultron-MW',repository_owner_id:'354776009',
  repository_visibility:'public',
  sub:'repo:Ultron-MW@354776009/Ultron.MW@1424939667:ref:refs/heads/main',
  actor:'michaeljwilliams0123',actor_id:'308995719',
  workflow_ref:'Ultron-MW/Ultron.MW/.github/workflows/owner-comment-router.yml@refs/heads/main',
  job_workflow_ref:'Ultron-MW/Ultron.MW/.github/workflows/cloud-pr.yml@refs/heads/main',
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
  'Ultron-MW/Ultron.MW/.github/workflows/cloud-pr.yml@refs/heads/main'};
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
 globalThis.__executionRouteOidc=async()=>({actor:'michaeljwilliams0123',actor_id:'308995719',event:'issue_comment'});
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
  verification:{runId:'42',url:'https://github.com/Ultron-MW/Ultron.MW/actions/runs/42',
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

test('needs-owner receipt persists exact completed verification beside the proposal hold',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../cloud/hatchable/api/brain/council-room-execution.js',import.meta.url),'utf8');
 const sha='a'.repeat(40);
 const verification={runId:'42',
  url:'https://github.com/Ultron-MW/Ultron.MW/actions/runs/42',
  sha,conclusion:'success'};
 const reason='proposal-only-no-execution';
 const expected={...verification,reason};
 let writes=0;
 const row={id:41,message_id:7,execution_state:'needs-owner',
  idempotency_key:'room:issue:285:'+'b'.repeat(40),request_digest:'b'.repeat(64),
  external_id:'291',external_kind:'pull_request',
  external_url:'https://github.com/Ultron-MW/Ultron.MW/pull/291',
  execution_result:{headSha:sha,...expected}};
 const platform={db:{async query(sql,params){
  assert.match(sql,/UPDATE council_room_jobs SET execution_state=\$3/);
  assert.equal(params[2],'needs-owner');
  assert.deepEqual(JSON.parse(params[3]),expected);
  assert.equal(params[4],sha);
  writes++;
  return {rows:[row]};
 }},scheduler:{},events:{}};
 globalThis.__executionRoutePlatform=platform;
 globalThis.__executionRouteOidc=async()=>({actor:'michaeljwilliams0123',actor_id:'308995719',event:'issue_comment'});
 const converted=source
  .replace("import {db,scheduler,events} from 'hatchable';",
   'const {db,scheduler,events}=globalThis.__executionRoutePlatform;')
  .replace("import {verifyCouncilRoomExecutionOidc} from 'lib/council-oidc.js';",
   'const verifyCouncilRoomExecutionOidc=globalThis.__executionRouteOidc;');
 assert.notEqual(converted,source);
 const route=await import('data:text/javascript;base64,'+
  Buffer.from(converted).toString('base64')+'#needs-owner-verification');
 const body={schema:'ultron.council-room.execution.v1',phase:'needs-owner',
  issueNumber:285,commentId:12345,
  commentBody:'@ultron implement Inspect the latest repository state',
  verification,result:{reason}};
 const res={code:200,setHeader(){},status(n){this.code=n;return this;},
  json(value){return {status:this.code,body:value};}};
 try{
  const result=await route.default({rawBody:JSON.stringify(body),
   headers:{authorization:'Bearer '+'x'.repeat(300)}},res);
  assert.equal(result.status,200);
  assert.equal(result.body.job.state,'needs-owner');
  assert.deepEqual(result.body.job.result,{headSha:sha,...expected});
  assert.equal(writes,1);
 }finally{
  delete globalThis.__executionRoutePlatform;
  delete globalThis.__executionRouteOidc;
 }
});

test('planned and reserve receipts return authoritative mutation rows',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const source=await readFile(new URL('../cloud/hatchable/api/brain/council-room-execution.js',import.meta.url),'utf8');
 let current,updates=0,schedules=0,publishes=0;
 const queries=[];
 const platform={
  db:{async query(sql){
   queries.push(sql);
   if(sql.includes('INSERT INTO council_room_messages')){
    assert.match(sql,/ON CONFLICT\(message_key\) DO UPDATE/);
    assert.match(sql,/RETURNING id,body,\(xmax=0\) AS created/);
    assert.match(sql,/FROM message m CROSS JOIN job j/);
    assert.doesNotMatch(sql,/FROM council_room_messages WHERE message_key/);
    return {rows:[current]};
   }
   if(sql.includes('UPDATE council_room_jobs j SET')){
    assert.match(sql,/RETURNING j\.\*/);
    updates++;
    return updates===1?{rows:[current]}:{rows:[]};
   }
   if(sql.includes('SELECT j.* FROM council_room_jobs j')){
    return {rows:[current]};
   }
   throw Error('unexpected database query');
  }},
  scheduler:{async now(){schedules++;}},
  events:{async publish(){publishes++;}}
 };
 globalThis.__executionRoutePlatform=platform;
 globalThis.__executionRouteOidc=async()=>({actor:'michaeljwilliams0123',actor_id:'308995719',event:'issue_comment'});
 const converted=source
  .replace("import {db,scheduler,events} from 'hatchable';",
   'const {db,scheduler,events}=globalThis.__executionRoutePlatform;')
  .replace("import {verifyCouncilRoomExecutionOidc} from 'lib/council-oidc.js';",
   'const verifyCouncilRoomExecutionOidc=globalThis.__executionRouteOidc;');
 assert.notEqual(converted,source);
 const route=await import('data:text/javascript;base64,'+
  Buffer.from(converted).toString('base64')+'#mutation-row-contract');
 const objective='Inspect the latest repository state';
 const requestDigest=createHash('sha256').update(
  JSON.stringify({issueNumber:285,objective})).digest('hex');
 current={job_id:41,id:41,message_id:7,body:'@ultron implement '+objective,
  execution_state:'planned',idempotency_key:'room:issue:285:'+requestDigest.slice(0,40),
  request_digest:requestDigest,external_id:null,external_kind:null,external_url:null,
  execution_result:{},created:true};
 const send=async(phase,commentBody='@ultron implement '+objective)=>{
  const body={schema:'ultron.council-room.execution.v1',phase,
   issueNumber:285,commentId:12345,commentBody};
  const res={code:200,setHeader(){},status(n){this.code=n;return this;},
   json(value){return {status:this.code,body:value};}};
  return route.default({rawBody:JSON.stringify(body),
   headers:{authorization:'Bearer '+'x'.repeat(300)}},res);
 };
 try{
  for(const unsafe of ['password: value','api_key=value','ghp_'+'a'.repeat(30)]){
   const commentBody='@ultron implement '+unsafe;
   const event={action:'created',
    issue:{number:285,state:'open',user:{login:PR_OWNER}},
    comment:{id:12345,body:commentBody,user:{login:PR_OWNER}}};
   assert.throws(()=>parseIssueCommentPrRequest(event,PR_OWNER,PR_REPOSITORY));
   const rejected=await send('planned',commentBody);
   assert.equal(rejected.status,403);
   assert.equal(rejected.body.error,'oidc-invalid');
  }
  assert.equal(queries.length,0,'both parsers reject unsafe objectives before database access');

  const planned=await send('planned');
  assert.equal(planned.status,200);
  assert.equal(planned.body.created,true);
  assert.equal(planned.body.job.id,41);
  assert.equal(schedules,1);
  assert.equal(publishes,1);

  current={...current,execution_state:'dispatching',created:undefined};
  const reserve=await send('reserve');
  assert.equal(reserve.body.job.state,'dispatching');
  assert.equal(reserve.body.job.id,41);
  assert.equal(reserve.body.dispatchAdmitted,true);

  const replay=await send('reserve');
  assert.equal(replay.body.job.state,'dispatching');
  assert.equal(replay.body.dispatchAdmitted,false);
  assert.equal(schedules,1);
  assert.equal(publishes,1);
  assert.equal(queries.length,4);
 }finally{
  delete globalThis.__executionRoutePlatform;
  delete globalThis.__executionRouteOidc;
 }
});
