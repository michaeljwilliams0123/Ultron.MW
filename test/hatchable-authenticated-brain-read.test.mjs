import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAuthenticatedBrainGithubRead } from '../cloud/hatchable/lib/github-operator-brain-read.js';

const HEAD='a'.repeat(40);
const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const captured=()=>{
 const calls=[];
 const provider=async(provider,request)=>{
  calls.push({provider,request});
  return {status:200,body:request.path.endsWith('/git/ref/heads/main')
   ?{object:{sha:HEAD}}:{ok:true,tag_name:'v7.0.1'},headers:{}};
 };
 return {calls,...createAuthenticatedBrainGithubRead({call:provider})};
};

test('authenticated repo reads use only exact GET allowlist and bounded parameters',async()=>{
 const x=captured();
 assert.equal((await x.readRepo('/git/ref/heads/main')).object.sha,HEAD);
 await x.readRepo('/pulls?state=open&per_page=12&sort=updated&direction=desc');
 await x.readRepo('/actions/runs?head_sha='+HEAD+'&per_page=12');
 await x.readRepo('/actions/runs/123/jobs?per_page=100');
 assert.equal(x.calls.length,4);
 assert.ok(x.calls.every(c=>c.provider==='github_operator'&&c.request.method==='GET'));
 assert.equal(x.calls[0].request.path,ROOT+'/git/ref/heads/main');
 assert.deepEqual(x.calls[1].request.query,{state:'open',per_page:'12',sort:'updated',direction:'desc'});
 assert.deepEqual(x.calls[2].request.query,{head_sha:HEAD,per_page:'12'});
 assert.deepEqual(x.calls[3].request.query,{per_page:'100'});
});

test('research proxy is restricted to six fixed upstream GET release URLs',async()=>{
 const x=captured();
 for(const repo of ['actions/checkout','actions/setup-node','actions/upload-artifact',
  'microsoft/playwright','nodejs/node','actions/cache']){
  const r=await x.fetcher('https://api.github.com/repos/'+repo+'/releases/latest',{method:'GET'});
  assert.equal(r.status,200);assert.equal(r.ok,true);
  assert.equal((await r.json()).tag_name,'v7.0.1');
 }
 assert.equal(x.calls.length,6);
 assert.ok(x.calls.every(c=>c.request.path.startsWith('/repos/')&&
  c.request.path.endsWith('/releases/latest')&&c.request.method==='GET'));
});

test('foreign, encoded, mutation and unbounded requests never reach provider',async()=>{
 const x=captured();
 const badRepo=[
  '/issues','/git/ref/heads/develop','/pulls?state=closed&per_page=12&sort=updated&direction=desc',
  '/pulls?state=open&per_page=9999&sort=updated&direction=desc',
  '/actions/runs?head_sha=not-a-sha&per_page=12','/actions/runs/1/jobs?per_page=0',
  '/git/ref/heads/%6dain','//evil.example','/pulls?state=open&state=open',
  '/pulls/../issues'
 ];
 for(const path of badRepo)await assert.rejects(x.readRepo(path),/github-read-out-of-scope/);
 const badResearch=[
  'https://api.github.com/repos/other/owner/releases/latest',
  'https://example.com/repos/actions/checkout/releases/latest',
  'https://api.github.com/repos/actions/checkout/releases/latest?per_page=100',
  'https://api.github.com/repos/actions/checkout/releases/%6catest',
  'https://api.github.com/repos/actions/checkout/../issues'
 ];
 for(const url of badResearch)await assert.rejects(x.fetcher(url),/github-read-out-of-scope/);
 await assert.rejects(x.fetcher('https://api.github.com/repos/actions/checkout/releases/latest',{method:'POST'}),/github-read-out-of-scope/);
 assert.equal(x.calls.length,0);
});

test('missing provider or rejected response fails closed; no anonymous fallback',async()=>{
 const x=createAuthenticatedBrainGithubRead({});
 await assert.rejects(x.readRepo('/git/ref/heads/main'),/authenticated-github-readback-unavailable/);
 const y=createAuthenticatedBrainGithubRead({call:async()=>({status:403,body:{message:'API rate limit'}})});
 await assert.rejects(y.readRepo('/git/ref/heads/main'),/authenticated-github-readback-unavailable/);
 const z=createAuthenticatedBrainGithubRead({call:async()=>{throw Error('OAuth unavailable')}});
 await assert.rejects(z.readRepo('/git/ref/heads/main'),/authenticated-github-readback-unavailable/);
});

test('production scheduler injects OAuth read functions into fenced task runner',()=>{
 const route=readFileSync(new URL('../cloud/hatchable/api/brain/run.js',import.meta.url),'utf8');
 const runner=readFileSync(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
 const core=readFileSync(new URL('../cloud/hatchable/lib/brain-core.js',import.meta.url),'utf8');
 assert.match(route,/createAuthenticatedBrainGithubRead/);
 assert.match(route,/githubRead/);
 assert.match(route,/githubFetch/);
 assert.match(runner,/githubRead/);
 assert.match(runner,/githubFetch/);
 assert.match(core,/collectResearchIntake\(\{fetcher:githubFetch\}\)/);
 assert.match(core,/currentMainSha\(githubRead\)/);
});


test('direct core calls never use an anonymous GitHub fallback when OAuth was not injected',async()=>{
 const source=readFileSync(new URL('../cloud/hatchable/lib/brain-core.js',import.meta.url),'utf8');
 const fixtures={
  'council-evidence.js': 'export const buildCouncilAssessmentReceipts=()=>[];export const evaluateCouncilEvidence=()=>({});',
  'acceptance-evidence.js': 'export const verifyPersistedAcceptanceEvidence=async()=>({reviewer:false});',
  'heldout-evidence.js': 'export const verifyPersistedHeldOutEvidence=async()=>({evaluation:false});',
  'council-room-core.js': 'export const buildCouncilRoomResult=async()=>({});',
  'research-intake.js': 'export const collectResearchIntake=async()=>({objective:"research.intake"});',
  'github-public-read.js': 'export const readGithubPublic=async()=>{globalThis.__ultronAnonymousReads=(globalThis.__ultronAnonymousReads||0)+1;throw Error("anonymous-fallback-reached");};'
 };
 let replaced=0;
 const transformed=source.replace(/from 'lib\/([^']+)'/g,(whole,name)=>{
  const fixture=fixtures[name];
  assert.ok(fixture,'Unexpected dependency '+name);
  replaced++;
  return "from 'data:text/javascript;base64,"+Buffer.from(fixture).toString('base64')+"'";
 });
 assert.equal(replaced,Object.keys(fixtures).length-(source.includes("from 'lib/github-public-read.js'")?0:1));
 globalThis.__ultronAnonymousReads=0;
 try{
  const mod=await import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
  for(const objective of ['repo.inspect','repo.prs','repo.ci','site.render','research.intake','council.review']){
   await assert.rejects(mod.executeObjective(objective,{db:{},browser:{}}),
    /authenticated-github-readback-unavailable/,
    objective+' must fail closed without an authenticated provider');
  }
  assert.equal(globalThis.__ultronAnonymousReads,0,'must never contact anonymous GitHub API');
 }finally{delete globalThis.__ultronAnonymousReads;}
});
