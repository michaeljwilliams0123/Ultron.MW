import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {verifyCouncilExecutionReceipt} from '../src/council-app-identities.mjs';
import {COUNCIL_APP_ROLES,authenticateCouncilAppActor,decideCouncilAction}
  from '../src/council-app-identities.mjs';
import {councilMemberIdentity,assessCouncil,memberCredentials,appJwt,
  executeMemberAction,probeCouncilEffect,mintInstallationToken,verifyCouncilActionTarget,memberIdentityState,COUNCIL_ABILITIES,memberAbilityAdmission} from '../src/council-members.mjs';

const SHA='a'.repeat(40);
const ctx=over=>({title:'Fix login',body:'Must add a test. Expected: login works. acceptance below.',
  isPr:false,itemNumber:7,sourceSha:SHA,flags:{},ownerMode:true,governorPositions:[],...over});

test('each member has a distinct identity, credentials and memory namespace',()=>{
  const ids=COUNCIL_APP_ROLES.map(councilMemberIdentity);
  for(const key of ['appSlug','botLogin','memoryNamespace','roleId'])
    assert.equal(new Set(ids.map(i=>i[key])).size,7);
  assert.equal(new Set(ids.map(i=>i.credentialEnv.privateKey)).size,7);
});
test('brains reason differently and each proposes actions',()=>{
  const out=assessCouncil(ctx({flags:{infra:true,multiFile:true}}));
  assert.equal(out.length,7);
  assert.equal(new Set(out.map(m=>m.headline)).size>=6,true);
  assert.ok(out.every(m=>m.reasons.length&&m.mandate));
  assert.ok(out.find(m=>m.identity.role==='Sentinel').actions.some(a=>a.op==='actions.dispatch'));
  assert.ok(out.find(m=>m.identity.role==='Generator').actions.some(a=>a.op==='issue.create'));
});
test('security language makes the guarding brains hold',()=>{
  const out=assessCouncil(ctx({flags:{security:true}}));
  for(const r of ['Skeptic','Steward','Companion'])
    assert.equal(out.find(m=>m.identity.role===r).verdict,'hold');
});
test('missing credentials are null; JWT is RS256 shaped',()=>{
  assert.equal(memberCredentials('Builder',{}),null);
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,
    privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  assert.equal(appJwt({appId:1,privateKey}).split('.').length,3);
});
test('installation tokens are discovered from the App and scoped to Ultron.MW',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,
    privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    calls.push({url,init});
    if(url.endsWith('/repos/'+ 'michaeljwilliams0123/Ultron.MW/installation'))
      return{ok:true,status:200,json:async()=>({id:123,app_id:7})};
    return{ok:true,status:201,json:async()=>({token:'installation-token',
      repositories:[{full_name:'michaeljwilliams0123/Ultron.MW'}]})};
  };
  assert.equal(await mintInstallationToken({appId:7,privateKey},fetchImpl),'installation-token');
  assert.equal(calls.length,2);
  assert.equal(JSON.parse(calls[1].init.body).repositories[0],'Ultron.MW');
  assert.equal(calls[1].url,'https://api.github.com/app/installations/123/access_tokens');
  await assert.rejects(mintInstallationToken({appId:7,privateKey},async url=>
    url.includes('/repos/')?{ok:true,json:async()=>({id:123,app_id:7})}:
      {ok:true,json:async()=>({token:'bad',repositories:[{full_name:'other/repo'}]})}),
  /not-scoped-to-ultron-mw/);
});
test('action target stays open, matches its issue/PR kind and exact PR head',async()=>{
  const fetchImpl=async url=>{
    if(url.endsWith('/issues/7'))return{ok:true,status:200,json:async()=>({state:'open'})};
    return{ok:true,status:200,json:async()=>({head:{sha:SHA}})};
  };
  await verifyCouncilActionTarget('token',{number:7,isPr:false,sourceSha:SHA},fetchImpl);
  await assert.rejects(verifyCouncilActionTarget('token',{number:7,isPr:false,sourceSha:SHA},
    async()=>({ok:true,status:200,json:async()=>({state:'closed'})})),/council-target-changed/);
  await assert.rejects(verifyCouncilActionTarget('token',{number:7,isPr:true,sourceSha:SHA},
    async url=>url.endsWith('/issues/7')
      ?{ok:true,status:200,json:async()=>({state:'open',pull_request:{}})}
      :{ok:true,status:200,json:async()=>({head:{sha:'b'.repeat(40)}})}),/council-pr-head-changed/);
});
test('owner-equivalent members get every owner action; others stay bounded',async()=>{
  const probe=role=>async()=>({source:'github-installations-api',app_id:1,id:2,
    app_slug:'ultron-mw-'+role.toLowerCase(),suspended_at:null,
    repositories:['michaeljwilliams0123/Ultron.MW'],
    permissions:{metadata:'read',administration:'write',actions:'write',contents:'write',
      workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write'}});
  for(const role of COUNCIL_APP_ROLES){
    const actor=await authenticateCouncilAppActor({role,sourceSha:SHA,
      installationToken:'x'.repeat(20),expectedAppId:1,
      githubProbe:probe(role),profile:'owner-equivalent'});
    const base={baseSha:SHA,maxPaidCents:0,attempt:1,prAuthor:'someone'};
    for(const operation of ['pr.merge','issue.close','review.approve','file.write'])
      assert.equal(decideCouncilAction(actor,{...base,operation,branch:'feature/x'}).allowed,true,role+operation);
    assert.equal(decideCouncilAction(actor,{...base,operation:'review.approve',
      prAuthor:'ultron-mw-'+role.toLowerCase()+'[bot]'}).reason,'self-review-denied');
  }
});
test('computer.* actions drive the injected cloud browser/desktop and report when unconfigured',async()=>{
  const actor=await authenticateCouncilAppActor({role:'Builder',sourceSha:SHA,
    installationToken:'x'.repeat(20),profile:'owner-equivalent',expectedAppId:1,
    githubProbe:async()=>({source:'github-installations-api',app_id:1,id:2,app_slug:'ultron-mw-builder',
      repositories:['michaeljwilliams0123/Ultron.MW'],
      permissions:{metadata:'read',administration:'write',actions:'write',contents:'write',
        workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write'}})});
  const log=[];
  const deps={browser:{signIn:async u=>(log.push('signIn '+u),{page:'P'}),goto:async u=>'P',
      act:async(p,s)=>(log.push(s.action),{ok:1})},
    desktop:{click:async(x,y)=>(log.push('click '+x+','+y),{ok:1})}};
  const b=await executeMemberAction(actor,'t',{op:'computer.browser',url:'https://any.site',signIn:true,
    steps:[{action:'click',selector:'#go'}]},{number:1},{deps});
  assert.equal(b.status,'done');
  const d=await executeMemberAction(actor,'t',{op:'computer.desktop',steps:[{verb:'click',args:[5,6]}]},{number:1},{deps});
  assert.equal(d.status,'done');
  assert.deepEqual(log,['signIn https://any.site','click','click 5,6']);
  assert.equal((await executeMemberAction(actor,'t',{op:'computer.browser',url:'https://x'},{number:1})).status,'unconfigured');
});
test('executeMemberAction calls GitHub as the member and denies without policy',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push([init.method,url,init.headers.authorization]);
    return{ok:true,status:200,json:async()=>({})};};
  const actor=await authenticateCouncilAppActor({role:'Skeptic',sourceSha:SHA,
    installationToken:'x'.repeat(20),profile:'owner-equivalent',expectedAppId:1,
    githubProbe:async()=>({source:'github-installations-api',app_id:1,id:2,app_slug:'ultron-mw-skeptic',
      repositories:['michaeljwilliams0123/Ultron.MW'],
      permissions:{metadata:'read',administration:'write',actions:'write',contents:'write',
        workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write'}})});
  const r=await executeMemberAction(actor,'tok',{op:'issue.comment',why:'hi'},{number:3},{fetchImpl});
  assert.equal(r.status,'done');
  assert.match(calls[0][1],/issues\/3\/comments$/);
  assert.equal(calls[0][2],'Bearer tok');
  const bad=await executeMemberAction(actor,'tok',{op:'pr.nuke'},{number:3},{fetchImpl});
  assert.equal(bad.status,'denied');
  const before=calls.length;
  for(const op of ['pr.merge','actions.dispatch','issue.label']){
    const denied=await executeMemberAction(actor,'tok',{op,why:'overreach'},
      {number:3,prAuthor:'someone'},{fetchImpl});
    assert.equal(denied.status,'denied');
    assert.equal(denied.reason,'role-operation-not-declared');
  }
  assert.equal(calls.length,before,'denied actions must not reach GitHub');
});

test('docs-only change gets fitting rationales and no CI/deploy alarm',()=>{
  const out=assessCouncil(ctx({title:'docs: review',body:'Adds docs/REVIEW.md. Expected: doc merges. Mentions CI results.',isPr:true,flags:{infra:false}}));
  const sentinel=out.find(m=>m.identity.role==='Sentinel');
  assert.ok(!sentinel.reasons.join(' ').includes('Touches CI/deploy'));
  assert.ok(!sentinel.actions.some(a=>a.op==='actions.dispatch'));
  assert.ok(out.find(m=>m.identity.role==='Steward').actions[0].labels.includes('council-screened'));
});
test('identity state is honest: independent only with own credentials',()=>{
  assert.equal(memberIdentityState('Builder',{}).independent,false);
  assert.equal(memberIdentityState('Builder',{}).postedAs,'github-actions[bot]');
  const env={COUNCIL_BUILDER_APP_ID:'1',COUNCIL_BUILDER_INSTALLATION_ID:'2',COUNCIL_BUILDER_APP_PRIVATE_KEY:'k'};
  const state=memberIdentityState('Builder',env);
  assert.equal(state.configured,true);
  assert.equal(state.independent,false);
  assert.equal(state.mode,'credentials-configured-unverified');
  assert.equal(state.postedAs,'github-actions[bot]');
});
test('abilities declared per member and external ops are plan-only',async()=>{
  for(const r of COUNCIL_APP_ROLES)assert.ok(COUNCIL_ABILITIES[r].internal.length);
  const actor={role:'Sentinel',sourceSha:SHA};
  const out=await executeMemberAction(actor,'t',{op:'mahoraga.repo.inspect',why:'x'},{number:1},{fetchImpl:async()=>{throw Error('no network')}});
  assert.ok(['planned','denied'].includes(out.status));
});

test('every proposed Council action is role-admitted and abilities stay immutable',()=>{
  for(const member of assessCouncil(ctx({isPr:true,flags:{infra:true,multiFile:true}}))){
    for(const action of member.actions)
      assert.equal(memberAbilityAdmission(member.identity.role,action.op).allowed,true,
        member.identity.role+':'+action.op);
  }
  for(const role of COUNCIL_APP_ROLES){
    const ability=COUNCIL_ABILITIES[role];
    assert.ok(Object.isFrozen(ability.internal));
    assert.ok(Object.isFrozen(ability.external));
    assert.equal(memberAbilityAdmission(role,'pr.merge').allowed,false);
  }
  assert.equal(memberAbilityAdmission('Unknown','issue.comment').allowed,false);
  assert.equal(memberAbilityAdmission('Sentinel','mahoraga.repo.inspect').mode,'planned-external');
  assert.equal(memberAbilityAdmission('Builder','file.write').allowed,false,
    'do not advertise an executor that is not implemented');
});

test('executeMemberAction mints a receipt only from a bot-authored GitHub response',async()=>{
  const actor=await authenticateCouncilAppActor({role:'Skeptic',sourceSha:SHA,
    installationToken:'x'.repeat(20),profile:'owner-equivalent',expectedAppId:1,
    githubProbe:async()=>({source:'github-installations-api',app_id:1,id:2,app_slug:'ultron-mw-skeptic',
      repositories:['michaeljwilliams0123/Ultron.MW'],
      permissions:{metadata:'read',administration:'write',actions:'write',contents:'write',
        workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write'}})});
  const caseSha='d'.repeat(64);
  const mk=login=>async()=>({ok:true,status:200,json:async()=>({id:9,user:{login,type:'Bot'},
    performed_via_github_app:{id:1,slug:'ultron-mw-skeptic'}})});
  const good=await executeMemberAction(actor,'tok',{op:'issue.comment',why:'hi'},{number:3,caseSha},{fetchImpl:mk('ultron-mw-skeptic[bot]')});
  assert.equal(good.status,'done');
  assert.equal(verifyCouncilExecutionReceipt(good.receipt),true);
  const forged=await executeMemberAction(actor,'tok',{op:'issue.comment',why:'hi'},{number:3,caseSha},{fetchImpl:mk('github-actions[bot]')});
  assert.equal(forged.status,'done');
  assert.equal(forged.receipt,undefined);
  assert.match(forged.receiptError,/authorship-unproven/);
});

test('comment writes carry an execution marker that readback finds, minting a receipt',async()=>{
  const actor=await authenticateCouncilAppActor({role:'Builder',sourceSha:SHA,
    installationToken:'x'.repeat(20),profile:'owner-equivalent',expectedAppId:1,
    githubProbe:async()=>({source:'github-installations-api',app_id:1,id:2,app_slug:'ultron-mw-builder',
      repositories:['michaeljwilliams0123/Ultron.MW'],
      permissions:{metadata:'read',administration:'write',actions:'write',contents:'write',
        workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write'}})});
  const caseSha='d'.repeat(64),executionKey='e'.repeat(64);
  const store=[];
  const fetchImpl=async(url,init={})=>{
    if(init.method==='POST'){
      const c={id:40+store.length,body:JSON.parse(init.body).body,user:{login:'ultron-mw-builder[bot]',type:'Bot'},
        performed_via_github_app:{id:1,slug:'ultron-mw-builder'}};
      store.push(c);return{ok:true,status:201,json:async()=>c};
    }
    return{ok:true,status:200,json:async()=>store};
  };
  const target={number:3,caseSha,executionKey};
  assert.equal(await probeCouncilEffect(actor,'tok',{op:'pr.comment',number:3,executionKey,caseSha},fetchImpl),null);
  await executeMemberAction(actor,'tok',{op:'pr.comment',why:'hi'},target,{fetchImpl});
  assert.match(store[0].body,/<!-- council-exec:e{64} -->/);
  const found=await probeCouncilEffect(actor,'tok',{op:'pr.comment',number:3,executionKey,caseSha},fetchImpl);
  assert.equal(verifyCouncilExecutionReceipt(found.receipt),true);
  assert.equal(found.receipt.effect.author,'ultron-mw-builder[bot]');
  store[0].user.login='github-actions[bot]';
  const unattributed=await probeCouncilEffect(actor,'tok',{op:'pr.comment',number:3,executionKey,caseSha},fetchImpl);
  assert.equal(unattributed.receipt,undefined);
  assert.equal(unattributed.executor,'github-actions[bot]');
  assert.equal(await probeCouncilEffect(actor,'tok',{op:'issue.label',number:3,executionKey,caseSha},fetchImpl),null);
});


test('verified exact-head CI never lifts a security hold for any role (Skeptic H1)',()=>{
 const evidence={
  schema:'ultron.council-exact-head-evidence.v1',verified:true,
  sourceSha:SHA,prNumber:397,repositoryId:1424939667,providerAppId:15368,
  checks:['test','fixed-comparison','attested-receipt'],
  baseUpToDate:true
 };
 const out=assessCouncil(ctx({
  title:'Security workflow acceptance tests',body:'Test credential denial and safe owner override',
  itemNumber:397,isPr:true,ownerMode:true,flags:{security:true,multiFile:true,infra:true},
  reviewEvidence:evidence
 }));
 for(const role of ['Builder','Predictor','Sentinel','Companion','Skeptic','Steward'])
  assert.equal(out.find(m=>m.identity.role===role).verdict,'hold',
   role+' must keep the security HOLD despite green CI');
 assert.ok(out.find(m=>m.identity.role==='Sentinel').reasons.some(r=>/advisory only/.test(r)));
});
test('stale or unverified CI evidence cannot soften any security-language hold',()=>{
 for(const evidence of [
  undefined,
  {schema:'ultron.council-exact-head-evidence.v1',verified:false,sourceSha:SHA},
  {schema:'ultron.council-exact-head-evidence.v1',verified:true,
   sourceSha:'b'.repeat(40),prNumber:397,repositoryId:1424939667,providerAppId:15368,
   checks:['test','fixed-comparison','attested-receipt'],baseUpToDate:true},
  {schema:'ultron.council-exact-head-evidence.v1',verified:true,
   sourceSha:SHA,prNumber:397,repositoryId:1424939667,providerAppId:15368,
   checks:['test'],baseUpToDate:true}
 ]){
  const out=assessCouncil(ctx({title:'Security workflow tests',
   body:'Fix token validation and verify negative cases',itemNumber:397,isPr:true,
   ownerMode:true,flags:{security:true,multiFile:true,infra:true},reviewEvidence:evidence}));
  for(const role of ['Builder','Predictor','Sentinel','Companion','Skeptic','Steward'])
   assert.equal(out.find(m=>m.identity.role===role).verdict,'hold',
    role+' must reject unverified evidence');
 }
});
