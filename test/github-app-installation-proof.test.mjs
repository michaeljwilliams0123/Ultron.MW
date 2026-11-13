import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {probeGithubAppInstallation,APP_PROOF} from '../src/identity/github-app-installation-proof.mjs';

const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW',default_branch:'main',owner:{login:'michaeljwilliams0123'}};
const installation={id:179066535,app_id:5633654,account:{login:'michaeljwilliams0123'},suspended_at:null,permissions:{metadata:'read',contents:'write'}};
const token={token:'NEVER-ECHO-THIS-TOKEN',expires_at:'2026-11-13T23:59:00Z',permissions:{metadata:'read'},repositories:[repo]};
const payload=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
function harness(override={}){
 const calls=[];
 const service=async(url,options)=>{
  calls.push({url,method:options.method||'GET',authorization:options.headers.Authorization,body:options.body});
  if(url.endsWith('/app/installations/179066535'))return payload(200,override.installation??installation);
  if(url.endsWith('/repos/michaeljwilliams0123/Ultron.MW/installation'))return payload(200,override.repoInstallation??installation);
  if(url.endsWith('/app/installations/179066535/access_tokens'))return payload(201,override.token??token);
  if(url.endsWith('/repos/michaeljwilliams0123/Ultron.MW'))return payload(200,override.repo??repo);
  throw Error('unexpected provider call');
 };
 return {calls,service};
}
const config={appId:'5633654',installationId:'179066535',privateKey:'-----BEGIN RSA PRIVATE KEY-----\nFAKE-TEST-ONLY\n-----END RSA PRIVATE KEY-----'};
const sign=async()=> 'FAKE-TEST-JWT';

test('installation identity, repository and down-scoped metadata read establish read-only proof',async()=>{
 const {calls,service}=harness();
 const proof=await probeGithubAppInstallation({credentials:config,fetchImpl:service,signJwt:sign,now:Date.parse('2026-11-13T23:00:00Z')});
 assert.equal(proof.state,'installation-and-scoped-read-verified');
 assert.equal(proof.installationVerified,true);
 assert.equal(proof.repositoryReadVerified,true);
 assert.equal(proof.contentsWritePermissionObserved,true);
 assert.equal(proof.externalMutationVerified,false);
 assert.equal(proof.productionAccepted,false);
 assert.equal(calls.length,4);
 assert.deepEqual(JSON.parse(calls[2].body),{repository_ids:[1424939667],permissions:{metadata:'read'}});
 assert.ok(calls[3].authorization.endsWith('NEVER-ECHO-THIS-TOKEN'));
 assert.doesNotMatch(JSON.stringify(proof),/NEVER-ECHO|FAKE-TEST|PRIVATE KEY/);
 assert.equal(APP_PROOF.repository,'michaeljwilliams0123/Ultron.MW');
});

test('rejects missing credentials without calling GitHub',async()=>{
 const {calls,service}=harness();
 const proof=await probeGithubAppInstallation({credentials:{appId:'',installationId:'',privateKey:''},fetchImpl:service,signJwt:sign});
 assert.equal(proof.installationVerified,false);
 assert.equal(proof.reason,'configuration-unverified');
 assert.equal(calls.length,0);
});

test('refuses wrong App and installation identifiers',async()=>{
 const {calls,service}=harness();
 for(const patch of [{appId:'999'},{installationId:'999'}]){
  const proof=await probeGithubAppInstallation({credentials:{...config,...patch},fetchImpl:service,signJwt:sign});
  assert.equal(proof.reason,'configuration-unverified');
 }
 assert.equal(calls.length,0);
});

test('rejects the wrong App, suspended installation and insufficient write permission',async()=>{
 for(const bad of [{...installation,app_id:77},{...installation,suspended_at:'2026-11-01'},{...installation,permissions:{metadata:'read',contents:'read'}}]){
  const {calls,service}=harness({installation:bad});
  const proof=await probeGithubAppInstallation({credentials:config,fetchImpl:service,signJwt:sign});
  assert.equal(proof.installationVerified,false);
  assert.equal(proof.reason,'installation-mismatch');
  assert.equal(calls.length,1);
 }
});

test('rejects a different repository installation and never mints a token',async()=>{
 const {calls,service}=harness({repoInstallation:{...installation,id:888}});
 const proof=await probeGithubAppInstallation({credentials:config,fetchImpl:service,signJwt:sign});
 assert.equal(proof.reason,'repository-installation-mismatch');
 assert.equal(calls.length,2);
});

test('rejects broadened token permissions and wrong scoped repository',async()=>{
 for(const bad of [{...token,permissions:{contents:'write',metadata:'read'}},{...token,repositories:[{...repo,id:999}]}]){
  const {calls,service}=harness({token:bad});
  const proof=await probeGithubAppInstallation({credentials:config,fetchImpl:service,signJwt:sign,now:Date.parse('2026-11-13T23:00:00Z')});
  assert.equal(proof.reason,'token-scope-mismatch');
  assert.equal(proof.repositoryReadVerified,false);
  assert.equal(calls.length,3);
 }
});

test('rejects an incorrect independent repository readback',async()=>{
 const {service}=harness({repo:{...repo,full_name:'other/Ultron.MW'}});
 const proof=await probeGithubAppInstallation({credentials:config,fetchImpl:service,signJwt:sign,now:Date.parse('2026-11-13T23:00:00Z')});
 assert.equal(proof.reason,'repository-readback-mismatch');
 assert.equal(proof.repositoryReadVerified,false);
});

test('network errors stay fail-closed without provider diagnostics or secret values',async()=>{
 const proof=await probeGithubAppInstallation({credentials:config,fetchImpl:async()=>{throw Error('PRIVATE KEY leaked');},signJwt:sign});
 assert.equal(proof.reason,'provider-unavailable');
 assert.doesNotMatch(JSON.stringify(proof),/PRIVATE KEY|leaked/);
});

test('authored source and deployable Hatchable module are byte-identical',async()=>{
 const src=await readFile(new URL('../src/identity/github-app-installation-proof.mjs',import.meta.url));
 const cloud=await readFile(new URL('../cloud/hatchable/lib/github-app-installation-proof.js',import.meta.url));
 assert.deepEqual(src,cloud);
});
