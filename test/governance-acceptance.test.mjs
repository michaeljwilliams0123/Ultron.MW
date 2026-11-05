import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recordGovernanceAcceptance} from '../cloud/hatchable/lib/governance-acceptance.js';

const MAIN='831816c8322989d79fa9b1e9c929c60dde8ea49d';
const HEAD='6e907060b95ffecec4b729fc1fbae34774e32581';
function request(extra={}){
 return {key:'gov:acceptance-material-01',scenario:'positive-cost',sourceSha:MAIN,
  operation:'model.paid.invoke',requestedCostCents:1,expectedProfileVersion:3,
  expectedStopVersion:5,taskId:null,fencingGeneration:null,prNumber:null,
  prHeadSha:null,...extra};
}
function database({loseInsertResponse=false}={}){
 const receipts=new Map();
 const calls=[];
 return {calls,receipts,async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('FROM governance_acceptance_receipts')){
   const row=receipts.get(params[0]);return {rows:row?[row]:[]};
  }
  if(sql.includes('FROM brain_owner_autonomy_profile'))return {rows:[{
   owner:'michaeljwilliams0123',profileVersion:3,maxPaidCents:0,
   paused:false,stopVersion:5
  }]};
  if(sql.includes('FROM brain_tasks'))return {rows:[{
   id:907,status:'done',fencingGeneration:1,attempts:1
  }]};
  if(sql.startsWith('INSERT INTO governance_acceptance_receipts')){
   if(!receipts.has(params[0]))receipts.set(params[0],{
    key:params[0],fingerprint:params[1],scenario:params[2],sourceSha:params[3],
    operation:params[4],requestedCostCents:params[5],disposition:'held',
    reason:params[12],providerWrites:0,observed:JSON.parse(params[13]),
    createdAt:'2026-11-05T14:00:00Z'
   });
   if(loseInsertResponse)throw Error('connection lost after commit');
   return {rows:[{receipt_key:params[0]}]};
  }
  throw Error('Unexpected SQL: '+sql);
 }};
}
const observers={observeMain:async()=>({sha:MAIN}),observePullRequest:async()=>({
 number:292,headSha:HEAD,baseRef:'main',state:'open',draft:false,
 url:'https://github.com/michaeljwilliams0123/Ultron.MW/pull/292',
 exactHeadChecksGreen:true,requiredChecks:[{name:'test',conclusion:'success'}],
 eligibleIndependentApproval:false,eligibleApprovalCount:0
})};

test('positive paid cost is durably held with zero provider writes',async()=>{
 const db=database();
 const result=await recordGovernanceAcceptance({db,request:request(),...observers});
 assert.equal(result.status,'held');
 assert.equal(result.reason,'positive-cost-denied');
 assert.equal(result.providerWrites,0);
 assert.equal(result.receipt.observed.maxPaidCents,0);
});

test('stale task fencing generation is bound to a real durable task',async()=>{
 const db=database();
 const result=await recordGovernanceAcceptance({db,...observers,request:request({
  key:'gov:acceptance-material-02',scenario:'stale-fence',operation:'task.complete',
  requestedCostCents:0,taskId:907,fencingGeneration:2
 })});
 assert.equal(result.reason,'stale-fencing-generation');
 assert.deepEqual(result.receipt.observed.task,
  {id:907,status:'done',attempts:1,fencingGeneration:1});
});

test('forbidden GitHub administration is denied without a mutation adapter',async()=>{
 const db=database();
 const result=await recordGovernanceAcceptance({db,...observers,request:request({
  key:'gov:acceptance-material-03',scenario:'forbidden-operation',
  operation:'repo.ruleset.update',requestedCostCents:0
 })});
 assert.equal(result.reason,'forbidden-operation-denied');
 assert.equal(result.receipt.providerWrites,0);
});

test('green exact-head PR without independent approval stays held',async()=>{
 const db=database();
 const result=await recordGovernanceAcceptance({db,...observers,request:request({
  key:'gov:acceptance-material-04',scenario:'ineligible-release',
  operation:'repo.pr.squash',requestedCostCents:0,prNumber:292,prHeadSha:HEAD
 })});
 assert.equal(result.reason,'independent-review-required');
 assert.equal(result.receipt.observed.pullRequest.exactHeadChecksGreen,true);
 assert.equal(result.receipt.observed.pullRequest.eligibleIndependentApproval,false);
});

test('same key reuses one immutable receipt and changed payload conflicts',async()=>{
 const db=database(),first=request();
 assert.equal((await recordGovernanceAcceptance({db,request:first,...observers})).reused,false);
 assert.equal((await recordGovernanceAcceptance({db,request:first,...observers})).reused,true);
 const changed=await recordGovernanceAcceptance({db,...observers,
  request:{...first,requestedCostCents:2}});
 assert.equal(changed.status,'invalid');
 assert.equal(changed.reason,'idempotency-conflict');
 assert.equal([...db.receipts].length,1);
});

test('lost insert response reconciles the committed receipt without replay',async()=>{
 const db=database({loseInsertResponse:true});
 const result=await recordGovernanceAcceptance({db,request:request(),...observers});
 assert.equal(result.status,'held');
 assert.equal(result.reason,'positive-cost-denied');
 assert.equal(result.reused,true);
 assert.equal(db.calls.filter(x=>x.sql.startsWith('INSERT INTO')).length,1);
 assert.equal(db.receipts.size,1);
});

test('current-main and authority drift remain held before scenario evaluation',async()=>{
 const db=database();
 const result=await recordGovernanceAcceptance({db,request:request(),
  ...observers,observeMain:async()=>({sha:'a'.repeat(40)})});
 assert.equal(result.reason,'source-drift');
 assert.equal(result.receipt.providerWrites,0);
});

test('matching fencing generation is not misreported as a stale-fence pass',async()=>{
 const db=database();
 const result=await recordGovernanceAcceptance({db,...observers,request:request({
  key:'gov:acceptance-material-05',scenario:'stale-fence',operation:'task.complete',
  requestedCostCents:0,taskId:907,fencingGeneration:1
 })});
 assert.equal(result.status,'invalid');
 assert.equal(result.reason,'fencing-generation-not-stale');
 assert.equal(db.receipts.size,0);
});

test('deployed route is admin-only, POST-only and has no provider mutation method',async()=>{
 const api=await readFile(new URL('../cloud/hatchable/api/brain/governance-acceptance.js',
  import.meta.url),'utf8');
 const migration=await readFile(new URL('../cloud/hatchable/migrations/0026_governance_acceptance.sql',
  import.meta.url),'utf8');
 assert.match(api,/export const access='admin'/);
 assert.match(api,/export const methods=\['POST'\]/);
 assert.doesNotMatch(api,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
 assert.match(migration,/provider_writes=0/);
 assert.match(migration,/BEFORE UPDATE OR DELETE/);
});
