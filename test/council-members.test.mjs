import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {COUNCIL_APP_ROLES,authenticateCouncilAppActor,decideCouncilAction}
  from '../src/council-app-identities.mjs';
import {councilMemberIdentity,assessCouncil,memberCredentials,appJwt,
  executeMemberAction} from '../src/council-members.mjs';

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
test('owner-equivalent members get every owner action; others stay bounded',async()=>{
  const probe=role=>async()=>({source:'github-installations-api',app_id:1,id:2,
    app_slug:'ultron-mw-'+role.toLowerCase(),suspended_at:null,
    repositories:['michaeljwilliams0123/Ultron.MW'],
    permissions:{metadata:'read',administration:'write',actions:'write',contents:'write',
      workflows:'write',issues:'write',pull_requests:'write',checks:'write',statuses:'write'}});
  for(const role of COUNCIL_APP_ROLES){
    const actor=await authenticateCouncilAppActor({role,sourceSha:SHA,
      installationToken:'x'.repeat(20),githubProbe:probe(role),profile:'owner-equivalent'});
    const base={baseSha:SHA,maxPaidCents:0,attempt:1,prAuthor:'someone'};
    for(const operation of ['pr.merge','issue.close','review.approve','file.write'])
      assert.equal(decideCouncilAction(actor,{...base,operation,branch:'feature/x'}).allowed,true,role+operation);
    assert.equal(decideCouncilAction(actor,{...base,operation:'review.approve',
      prAuthor:'ultron-mw-'+role.toLowerCase()+'[bot]'}).reason,'self-review-denied');
  }
});
test('computer.* actions drive the injected cloud browser/desktop and report when unconfigured',async()=>{
  const actor=await authenticateCouncilAppActor({role:'Builder',sourceSha:SHA,
    installationToken:'x'.repeat(20),profile:'owner-equivalent',
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
    installationToken:'x'.repeat(20),profile:'owner-equivalent',
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
});
