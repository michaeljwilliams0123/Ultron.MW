import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createVerifiedGitHubClient} from '../src/auth/identity-factory.mjs';
import {ULTRON_REPOSITORY_ID,ULTRON_REPOSITORY}
 from '../src/github-principal-policy.mjs';

const NOW=Date.parse('2026-11-09T20:00:00Z');
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const env=Object.freeze({
 GITHUB_APP_ID:'12345',
 GITHUB_INSTALLATION_ID:'9123',
 GITHUB_PRIVATE_KEY:privateKey.export({type:'pkcs1',format:'pem'}).toString().replace(/\n/g,'\\n')
});
function harness({repoId=ULTRON_REPOSITORY_ID,repoName=ULTRON_REPOSITORY,
 permissionsOverride}={}){
 const requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push({url,options});
  if(url==='https://api.github.com/app/installations/9123/access_tokens'){
   const body=JSON.parse(options.body);
   return {ok:true,status:201,json:async()=>({
    token:'test-token-'+requests.length,
    expires_at:'2026-11-09T20:45:00Z',
    permissions:permissionsOverride??body.permissions,
    repositories:[{id:ULTRON_REPOSITORY_ID,full_name:ULTRON_REPOSITORY}]
   })};
  }
  if(url==='https://api.github.com/repos/'+ULTRON_REPOSITORY){
   return {ok:true,status:200,json:async()=>({id:repoId,full_name:repoName})};
  }
  throw Error('unplanned external request');
 };
 return {fetchImpl,requests};
}

test('identity factory proves repo and contents write using down-scoped tokens',async()=>{
 const h=harness();
 const client=await createVerifiedGitHubClient({env,fetchImpl:h.fetchImpl,clock:()=>NOW});
 assert.equal(client.installationId,9123);
 assert.equal(typeof client.getTokenForScope,'function');
 assert.equal(typeof client.octokit.repos.get,'function');
 const minted=h.requests.filter(r=>r.url.includes('/access_tokens'));
 assert.equal(minted.length,2);
 assert.deepEqual(minted.map(r=>JSON.parse(r.options.body)),[
  {repository_ids:[ULTRON_REPOSITORY_ID],permissions:{metadata:'read'}},
  {repository_ids:[ULTRON_REPOSITORY_ID],permissions:{metadata:'read',contents:'write'}}
 ]);
 const repoReads=h.requests.filter(r=>r.url.includes('/repos/'));
 assert.equal(repoReads.length,1);
 assert.equal(repoReads[0].options.method,'GET');
 assert.equal(repoReads[0].options.headers.Authorization.startsWith('Bearer test-token-'),true);
 assert.equal(h.requests.some(r=>r.options.method==='PATCH'||r.options.method==='PUT'),false);
 const grant=await client.getTokenForScope('repair.pr.create');
 assert.deepEqual(grant.permissions,{metadata:'read',pull_requests:'write'});
 assert.equal(grant.operation,'repair.pr.create');
 assert.equal(grant.repositoryId,ULTRON_REPOSITORY_ID);
 assert.equal(grant.installationId,9123);
 assert.equal(typeof grant.expiresAt,'string');
 assert.equal(h.requests.filter(r=>r.url.includes('/access_tokens')).length,3);
});

test('scoped client cannot read another repository or expose a generic request interface',async()=>{
 const h=harness();
 const client=await createVerifiedGitHubClient({env,fetchImpl:h.fetchImpl,clock:()=>NOW});
 assert.equal(client.octokit.request,undefined);
 await assert.rejects(client.octokit.repos.get({owner:'other',repo:'Ultron.MW'}),/repository|scope/i);
 await assert.rejects(client.octokit.repos.get({owner:'michaeljwilliams0123',repo:'other'}),/repository|scope/i);
 const {data}=await client.octokit.repos.get({owner:'michaeljwilliams0123',repo:'Ultron.MW'});
 assert.equal(data.id,ULTRON_REPOSITORY_ID);
 assert.equal(data.full_name,ULTRON_REPOSITORY);
 assert.equal(h.requests.filter(r=>r.url.includes('/repos/')).length,2);
});

test('high impact, malformed, and unknown scopes fail before minting a token',async()=>{
 const h=harness();
 const client=await createVerifiedGitHubClient({env,fetchImpl:h.fetchImpl,clock:()=>NOW});
 const before=h.requests.length;
 for(const scope of ['repository.settings.update','actions.enable','webhooks.ping',
  'arbitrary.execute','__proto__',{},null,'']){
  await assert.rejects(client.getTokenForScope(scope),/scope|denied|admitted/i);
 }
 assert.equal(h.requests.length,before);
});

test('missing or malformed trusted environment fails closed without a request',async()=>{
 const h=harness();
 for(const patch of [
  {GITHUB_APP_ID:''},
  {GITHUB_APP_ID:'123foo'},
  {GITHUB_INSTALLATION_ID:'0'},
  {GITHUB_INSTALLATION_ID:'abc'},
  {GITHUB_PRIVATE_KEY:''}
 ]){
  await assert.rejects(createVerifiedGitHubClient({
   env:{...env,...patch},fetchImpl:h.fetchImpl,clock:()=>NOW
  }),/credential|configuration/i);
 }
 assert.equal(h.requests.length,0);
});

test('repository identity mismatch denies activation',async()=>{
 for(const changes of [{repoId:1},{repoName:'another/repo'}]){
  const h=harness(changes);
  await assert.rejects(createVerifiedGitHubClient({
   env,fetchImpl:h.fetchImpl,clock:()=>NOW
  }),/identity|repository/i);
  assert.equal(h.requests.some(r=>r.options.method!=='GET'&&
   !r.url.includes('/access_tokens')),false);
 }
});

test('unverified write permission response denies activation',async()=>{
 const h=harness({permissionsOverride:{metadata:'read'}});
 await assert.rejects(createVerifiedGitHubClient({
  env,fetchImpl:h.fetchImpl,clock:()=>NOW
 }),/scope|profile|permission/i);
});
