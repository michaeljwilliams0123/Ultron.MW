import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID}
 from '../src/github-principal-policy.mjs';
import {diagnoseCouncilAppInstallation}
 from '../src/security/council-app-installation-diagnostic.mjs';
import {verifyCouncilFleet}
 from '../src/security/council-fleet-verification.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const OWNER='michaeljwilliams0123';
const OWNER_ID=308995719;
const OLD='Ultron-MW/Ultron.MW';
const APP_ID=5633654;
const now=()=>Date.parse('2026-11-10T20:00:00Z');
const pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey
 .export({type:'pkcs1',format:'pem'});
const repo={id:REPO_ID,full_name:REPO,owner:{login:OWNER,id:OWNER_ID}};
const env={GITHUB_APP_ID:String(APP_ID),GITHUB_INSTALLATION_ID:'778899',
 GITHUB_PRIVATE_KEY:pem};
function response(status,body){return {ok:status===200,status,json:async()=>body,
 headers:{get:()=>null}};}
test('single immutable GitHub repo ID is bound to the current primary human owner',()=>{
 assert.equal(ULTRON_REPOSITORY,REPO);
 assert.equal(ULTRON_REPOSITORY_ID,REPO_ID);
});
test('protected Council workflow is callable only by primary human owner on canonical main',()=>{
 const y=readFileSync(new URL('../.github/workflows/council-principal-proof.yml',
  import.meta.url),'utf8');
 assert.match(y,/github\.repository == 'michaeljwilliams0123\/Ultron\.MW'/);
 assert.match(y,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(y,/github\.triggering_actor == 'michaeljwilliams0123'/);
 assert.match(y,/github\.ref == 'refs\/heads\/main'/);
 assert.match(y,/workflow_dispatch:/);
 assert.match(y,/contents: read/);
 assert.doesNotMatch(y,/github\.repository == 'Ultron-MW\/Ultron\.MW'/);
 assert.doesNotMatch(y,/pull_request_target:|skip-token-revoke: true|contents: write|id-token: write/);
});
test('signed Coordinator JWT reads back installation for exact current owner identity',async()=>{
 const calls=[];
 const request=async(url,opts)=>{
  calls.push(url);
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  if(url==='https://api.github.com/app')
   return response(200,{id:APP_ID,slug:'ultron-coordinator'});
  if(url==='https://api.github.com/repos/'+REPO+'/installation')
   return response(200,{id:778899,app_id:APP_ID,
    account:{login:OWNER,id:OWNER_ID}});
  throw Error('untrusted repo URL');
 };
 const observed=await diagnoseCouncilAppInstallation({appId:APP_ID,privateKey:pem,
  request,now});
 assert.equal(observed.status,'installation-observed');
 assert.equal(observed.repository,REPO);
 assert.deepEqual(calls,['https://api.github.com/app',
  'https://api.github.com/repos/'+REPO+'/installation']);
 assert.equal(observed.verifiedPrincipalCount,0,
  'App JWT metadata lookup is not a minted installation identity');
 assert.equal(JSON.stringify(observed).includes('PRIVATE KEY'),false);
});
test('installation from prior organization or automation user cannot impersonate current owner',async()=>{
 for(const owner of [
  {login:'Ultron-MW',id:354776009},
  {login:'michaeljwilliams0123ultron',id:354634860},
  {login:OWNER,id:354634860},
  {login:OWNER},
 ]){
  const seen=[];
  const verdict=await diagnoseCouncilAppInstallation({appId:APP_ID,
   privateKey:pem,now,request:async(url)=>{
    seen.push(url);
    if(url.endsWith('/app'))return response(200,{id:APP_ID,slug:'ultron-coordinator'});
    return response(200,{id:778899,app_id:APP_ID,account:owner});
   }});
  assert.equal(verdict.status,'held');
  assert.equal(verdict.verifiedPrincipalCount,0);
 }
});
test('minted metadata-only installation token verifies exactly one principal and seven logical roles',async()=>{
 const token='NEVER_LOG_TEST_TOKEN';
 const mintScopedToken=async scope=>{
  assert.deepEqual(scope,{operation:'identity.read',repositoryId:REPO_ID,
   permissions:{metadata:'read'}});
  return {token,installationId:778899,repositoryId:REPO_ID,
   permissions:{metadata:'read'},expiresAt:'2026-11-10T20:20:00Z'};
 };
 const observed=await verifyCouncilFleet({env,mintScopedToken,now,
  request:async(_url,opts)=>{
   assert.equal(opts.method,'GET');
   assert.equal(opts.headers.Authorization,'Bearer '+token);
   return response(200,{total_count:1,repositories:[repo]});
  }});
 assert.equal(observed.status,'verified');
 assert.equal(observed.repository,REPO);
 assert.equal(observed.verifiedPrincipalCount,1);
 assert.equal(observed.verifiedIndependentRoleCount,0);
 assert.equal(observed.roleBindings.length,7);
 assert.equal(JSON.stringify(observed).includes(token),false);
 assert.equal(JSON.stringify(observed).includes('PRIVATE KEY'),false);
});
test('former organization alias with same immutable repository ID is rejected',async()=>{
 const token='NEVER_LOG_TEST_TOKEN';
 const mint=async()=>({token,installationId:778899,repositoryId:REPO_ID,
  permissions:{metadata:'read'},expiresAt:'2026-11-10T20:20:00Z'});
 const observed=await verifyCouncilFleet({env,mintScopedToken:mint,now,
  request:async()=>response(200,{total_count:1,repositories:[{
   id:REPO_ID,full_name:OLD,owner:{login:'Ultron-MW',id:354776009}
  }]})});
 assert.equal(observed.status,'held');
 assert.equal(observed.reason,'github-repository-scope-invalid');
 assert.equal(observed.verifiedPrincipalCount,0);
});
test('suspended Coordinator installation is held despite valid signer and matching primary owner',async()=>{
 const got=await diagnoseCouncilAppInstallation({appId:APP_ID,privateKey:pem,now,
  request:async url=>url.endsWith('/app')?
   response(200,{id:APP_ID,slug:'ultron-coordinator'}):
   response(200,{id:778899,app_id:APP_ID,
    account:{login:OWNER,id:OWNER_ID},
    suspended_at:'2026-11-10T19:01:00Z'})});
 assert.equal(got.status,'held');
 assert.equal(got.installationVisible,false);
});
test('missing key, expired installation token, or unavailable provider never fabricates role authentication',async()=>{
 const result=await verifyCouncilFleet({env:{},now,request:async()=>{
  throw Error('never hit provider');
 }});
 assert.equal(result.status,'held');
 assert.equal(result.verifiedPrincipalCount,0);
 assert.equal(result.verifiedIndependentRoleCount,0);
});


test('role proof URLs reject foreign hosts, arbitrary paths and conflicting comment IDs',async()=>{
 const {judgeIdentityProof}=await import('../scripts/council-identity-proof.mjs');
 const marker='council-identity-proof:builder:abc123';
 const good={id:7,body:'<!-- '+marker+' -->',created_at:'2026-11-10T19:00:00Z',
  user:{login:'ultron-coordinator[bot]',type:'Bot',id:353078104},
  performed_via_github_app:{slug:'ultron-coordinator',id:APP_ID},
  html_url:'https://github.com/'+REPO+'/issues/186#issuecomment-7'};
 const posted={id:7};
 assert.equal(judgeIdentityProof({role:'Builder',posted,readback:good,marker}).authenticated,true);
 for(const badUrl of [
  'https://evil.example/'+REPO+'/issues/186#issuecomment-7',
  'https://github.com.attacker.example/'+REPO+'/issues/186#issuecomment-7',
  'https://github.com/'+REPO+'/issues/186#issuecomment-999',
  'https://github.com/'+REPO+'/commit/123#issuecomment-7',
  'http://github.com/'+REPO+'/issues/186#issuecomment-7',
  'https://github.com/'+REPO+'/issues/186?redirect=evil#issuecomment-7'
 ]){
  assert.equal(judgeIdentityProof({role:'Builder',posted,readback:{
   ...good,html_url:badUrl
  },marker}).authenticated,false,'invalid proof URL: '+badUrl);
 }
});
test('owner-only role proof blocks reruns triggered by bot or another GitHub user',()=>{
 const y=readFileSync(new URL('../.github/workflows/council-identity-proof.yml',
  import.meta.url),'utf8');
 assert.match(y,/github\.triggering_actor == 'michaeljwilliams0123'/);
 assert.match(y,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(y,/github\.ref == 'refs\/heads\/main'/);
 assert.doesNotMatch(y,/pull_request_target:|permissions:\s*[\s\S]*contents: write/);
});
