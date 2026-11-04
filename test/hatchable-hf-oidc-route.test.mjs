import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync,createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {oidcAudience} from '../cloud/hatchable/lib/github-oidc-bridge.js';
const REPO='michaeljwilliams0123/Ultron.MW',ID=41775191071,SHA='a'.repeat(40);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'test-oidc-runner-signing-key',alg:'RS256'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const rawPayload=(deliveryId=randomUUID())=>JSON.stringify({
 schema:'ultron.hf-oidc-run.v1',runId:ID,runAttempt:1,deliveryId
});
async function token(raw,other={}){
 const time=Math.floor(Date.now()/1000);
 const head=b64({alg:'RS256',typ:'JWT',kid:key.kid});
 const payload=b64({
  iss:'https://token.actions.githubusercontent.com',
  aud:await oidcAudience(raw),
  sub:'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:refs/heads/main',
  repository:REPO,repository_id:'1424939667',
  repository_owner:'michaeljwilliams0123',repository_visibility:'public',
  actor:'michaeljwilliams0123',
  ref:'refs/heads/main',sha:SHA,
  workflow_ref:REPO+'/.github/workflows/hf-oidc-bridge.yml@refs/heads/main',
  event_name:'workflow_dispatch',iat:time,exp:time+180,
  ...other
 });
 const signed=head+'.'+payload,signer=createSign('RSA-SHA256');
 signer.update(signed);signer.end();
 return signed+'.'+signer.sign(privateKey).toString('base64url');
}
const expectedRun={
 id:ID,run_attempt:1,
 event:'workflow_dispatch',status:'completed',conclusion:'success',
 path:'.github/workflows/c06-owner-model-release.yml',
 head_sha:SHA,head_branch:'main',actor:{login:'michaeljwilliams0123'},
 repository:{full_name:REPO,private:false}
};
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
let counter=0;
async function endpoint(){
 const code=readFileSync('cloud/hatchable/api/brain/hf-oidc-event.js','utf8');
 const platform=moduleUrl(`export const db=globalThis.__oidcHarness.db;
 export const scheduler=globalThis.__oidcHarness.scheduler;
 export const events=globalThis.__oidcHarness.events;`);
 const dep=(p)=>new URL('../cloud/hatchable/lib/'+p,import.meta.url).href;
 const replaced=code.replace("from 'hatchable'","from '"+platform+"'")
  .replace("from 'lib/github-oidc-bridge.js'","from '"+dep('github-oidc-bridge.js')+"'")
  .replace("from 'lib/hf-github-receipts.js'","from '"+dep('hf-github-receipts.js')+"'")
  .replace("from 'lib/owner-live-events.js'","from '"+dep('owner-live-events.js')+"'");
 return (await import(moduleUrl(replaced)+'#'+(++counter))).default;
}
function fakeDB(){
 let row=null;
 return {receipts:()=>row?[row]:[],async query(sql,args){
  if(sql.includes('INSERT INTO hf_github_receipts')){
   if(row)return {rows:[]};
   row={id:50,delivery_id:args[0],run_id:args[1],run_attempt:args[2],
    workflow_key:args[3],source_sha:args[4],conclusion:args[5],
    payload_sha256:args[6],state:'pending'};
   return {rows:[row]};
  }
  if(sql.includes('SELECT id,delivery_id,run_id')){
   return {rows:row?[row]:[]};
  }
  throw Error('unexpected-receipt-sql');
 }};
}
function res(){
 return {code:200,status(code){this.code=code;return this;},
  json(body){return {status:this.code,body}}};
}
test('OIDC-E2E-01: signed GitHub source creates one durable receipt and only one scheduled worker',async()=>{
 const initialFetch=globalThis.fetch;
 const db=fakeDB(),scheduled=[],published=[];
 globalThis.__oidcHarness={db,scheduler:{async now(...args){scheduled.push(args)}},
  events:{async publish(...args){published.push(args)}}};
 globalThis.fetch=async url=>{
  if(String(url).includes('.well-known/jwks'))return {ok:true,json:async()=>({keys:[key]})};
  if(String(url).includes('/actions/runs/'+ID))return {ok:true,json:async()=>expectedRun};
  throw Error('unexpected-api');
 };
 try{
  const route=await endpoint();
  const raw=rawPayload(),authorization='Bearer '+await token(raw);
  const first=await route({rawBody:raw,headers:{authorization}},res());
  assert.equal(first.status,202);
  assert.equal(first.body.ok,true);
  assert.equal(first.body.status,'committed-awaiting-independent-reconciliation');
  const second=await route({rawBody:new TextEncoder().encode(raw),headers:{authorization}},res());
  assert.equal(second.status,200);
  assert.equal(second.body.status,'duplicate');
  assert.equal(db.receipts().length,1);
  assert.equal(scheduled.length,1);
  assert.equal(published.length,1);
  assert.equal(db.receipts()[0].payload_sha256,createHash('sha256').update(raw).digest('hex'));
 }finally{globalThis.fetch=initialFetch;delete globalThis.__oidcHarness}
});
test('OIDC-E2E-02: missing signature and valid identity with different body cannot reach provider or database',async()=>{
 const initialFetch=globalThis.fetch,db=fakeDB();
 let apiCalls=0;
 globalThis.__oidcHarness={db,scheduler:{async now(){}},events:{async publish(){}}};
 globalThis.fetch=async url=>{apiCalls++;if(String(url).includes('jwks'))return{ok:true,json:async()=>({keys:[key]})};return{ok:true,json:async()=>expectedRun}};
 try{
  const route=await endpoint();
  const raw=rawPayload(),bearer=await token(raw);
  const missing=await route({rawBody:raw,headers:{}},res());
  assert.equal(missing.status,403);
  const modified=await route({rawBody:raw+' ',headers:{authorization:'Bearer '+bearer}},res());
  assert.equal(modified.status,403);
  assert.equal(db.receipts().length,0);
  assert.equal(apiCalls,0,'body mismatch is rejected before any GitHub API lookup');
 }finally{globalThis.fetch=initialFetch;delete globalThis.__oidcHarness}
});
test('OIDC-E2E-03: a signed GitHub runner cannot admit an unrelated completed run',async()=>{
 const initialFetch=globalThis.fetch,db=fakeDB();
 globalThis.__oidcHarness={db,scheduler:{async now(){}},events:{async publish(){}}};
 globalThis.fetch=async url=>{
  if(String(url).includes('jwks'))return{ok:true,json:async()=>({keys:[key]})};
  return{ok:true,json:async()=>({...expectedRun,actor:{login:'attacker'}})};
 };
 try{
  const route=await endpoint();
  const raw=rawPayload(),authorization='Bearer '+await token(raw);
  const outcome=await route({rawBody:raw,headers:{authorization}},res());
  assert.equal(outcome.status,422);
  assert.equal(db.receipts().length,0);
 }finally{globalThis.fetch=initialFetch;delete globalThis.__oidcHarness}
});
