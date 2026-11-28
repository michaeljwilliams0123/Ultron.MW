import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnerOverrideAdmission} from '../src/council-owner-signing-admission.mjs';
import {councilExactHeadCiReady,exactHeadReadState,selectCouncilTargetNumber} from '../src/council-trusted-gate.mjs';
import {admitRepairTask,assertRepairStep} from '../src/repair-admission.mjs';
import {requiredTokenPermissions,ULTRON_GITHUB_PRINCIPAL} from '../src/github-principal-policy.mjs';
import {classifyTerminalSlotEvidence,reconcileRecentNaturalSlots} from '../cloud/hatchable/lib/scheduler-slot-reconciliation.js';

const REPO='michaeljwilliams0123/Ultron.MW';
const repo={id:1424939667,full_name:REPO};
const owner={login:'michaeljwilliams0123',id:308995719,type:'User'};
const delegate={login:'michaeljwilliams0123ultron',id:354634860,type:'User'};
const head='a'.repeat(40),base='b'.repeat(40),other='c'.repeat(40);
const now='2026-10-31T17:00:00Z';
const checks=()=>({total_count:4,check_runs:['test','fixed-comparison','reef-runtime-probe','attested-receipt'].map(name=>({name,head_sha:head,app:{id:15368},status:'completed',conclusion:'success',started_at:'2026-11-24T11:00:00Z'}))});
const approval=()=>({id:1,user:owner,state:'APPROVED',commit_id:head,submitted_at:'2026-11-24T12:00:00Z'});
const pr=(user=delegate)=>({number:544,state:'open',draft:false,user,head:{sha:head,repo},base:{sha:base,ref:'main',repo}});
const args=user=>({principal:owner,pr:pr(user),expectedHead:head,expectedBase:base,reviews:[approval()],checks:checks()});
const deny=(input,reason)=>assert.throws(()=>assertOwnerOverrideAdmission(input),reason);

// Each prerequisite is corrupted independently; the other three checks stay green.
for(const name of ['test','fixed-comparison','reef-runtime-probe','attested-receipt']){
 const changes=[
  ['failed',{conclusion:'failure'}],['cancelled',{conclusion:'cancelled'}],['neutral',{conclusion:'neutral'}],
  ['skipped',{conclusion:'skipped'}],['timed out',{conclusion:'timed_out'}],['action required',{conclusion:'action_required'}],
  ['queued',{status:'queued'}],['running',{status:'in_progress'}],['wrong head',{head_sha:other}],
  ['foreign publisher',{app:{id:1}}],['missing publisher',{app:null}],['invalid timestamp',{started_at:'not-a-date'}],
 ];
 for(const [label,patch] of changes)test('Council CI '+name+' / '+label,()=>{
  const inv=checks();Object.assign(inv.check_runs.find(c=>c.name===name),patch);
  assert.equal(councilExactHeadCiReady(inv,head),false);
  deny({...args(delegate),checks:inv},/Required exact-head/);
 });
 for(const [label,conclusion,offset,expected] of [['newer failure','failure','12',false],['older failure','failure','10',true],['newer success','success','12',true]]){
  test('Council CI '+name+' / '+label,()=>{
   const inv=checks();const original=inv.check_runs.find(c=>c.name===name);
   inv.check_runs.push({...original,conclusion,started_at:'2026-11-24T'+offset+':00:00Z'});inv.total_count++;
   assert.equal(councilExactHeadCiReady(inv,head),expected);
  });
 }
 test('Council CI '+name+' / absent required check despite four records',()=>{
  const inv=checks();inv.check_runs.find(c=>c.name===name).name='unrelated';
  assert.equal(councilExactHeadCiReady(inv,head),false);
 });
}

const identityPatches=[
 ['missing principal',null],['delegate principal',delegate],['wrong login',{...owner,login:'other'}],
 ['wrong numeric identity',{...owner,id:1}],['bot identity',{...owner,type:'Bot'}],['string numeric identity',{...owner,id:String(owner.id)}],
 ['missing ID',{login:owner.login}],['missing login',{id:owner.id}],
];
const prPatches=[
 ['closed',{state:'closed'}],['draft',{draft:true}],['unknown draft',{draft:undefined}],
 ['zero number',{number:0}],['fractional number',{number:1.5}],['unsafe number',{number:Number.MAX_SAFE_INTEGER+1}],
 ['noncanonical base branch',{base:{...pr().base,ref:'release'}}],
 ['foreign head repository',{head:{...pr().head,repo:{...repo,id:1}}}],
 ['foreign base repository',{base:{...pr().base,repo:{...repo,id:1}}}],
 ['wrong head repository name',{head:{...pr().head,repo:{...repo,full_name:'other/repo'}}}],
 ['wrong base repository name',{base:{...pr().base,repo:{...repo,full_name:'other/repo'}}}],
 ['malformed head',{head:{...pr().head,sha:'main'}}],['malformed base',{base:{...pr().base,sha:'main'}}],
 ['head drift',{head:{...pr().head,sha:other}}],['base drift',{base:{...pr().base,sha:other}}],
];
for(const user of [owner,delegate]){
 const kind=user===owner?'owner-authored':'delegated';
 for(const [label,principal] of identityPatches)test('Council '+kind+' / '+label,()=>deny({...args(user),principal},/Primary GitHub owner/));
 for(const [label,patch] of prPatches)test('Council '+kind+' / '+label,()=>deny({...args(user),pr:{...pr(user),...patch}},/Canonical open|Exact reviewed/));
}
for(const state of ['CHANGES_REQUESTED','DISMISSED']){
 for(const [label,time,id,expected] of [['newer','2026-11-24T12:01:00Z',2,false],['older','2026-11-24T11:59:00Z',2,true],['same time higher ID','2026-11-24T12:00:00Z',2,false]]){
  for(const order of ['original','reversed'])test('Council review '+state+' / '+label+' / '+order,()=>{
   const reviews=[approval(),{...approval(),state,id,submitted_at:time}];if(order==='reversed')reviews.reverse();
   const input={...args(delegate),reviews};if(expected)assert.equal(assertOwnerOverrideAdmission(input).via,'owner-approved-exact-head');else deny(input,/current genuine owner approval/);
  });
 }
}
for(const [label,patch] of [['closed',{state:'closed'}],['wrong PR',{number:545}],['changed head',{head:{...pr().head,sha:other}}],['changed base',{base:{...pr().base,sha:other}}]]){
 test('Council recheck rejects '+label,()=>assert.equal(exactHeadReadState(pr(),{...pr(),...patch}),'superseded'));
}
test('Council recheck accepts exact immutable snapshot',()=>assert.equal(exactHeadReadState(pr(),pr()),'current'));
for(const event of ['pull_request_target','issue_comment','workflow_dispatch']){
 for(const value of [0,-1,1.2,Number.MAX_SAFE_INTEGER+1,'0','01','1.0','-1','1e2',' 1','1 ','abc',null,undefined]){
  test('Council event target rejects '+event+' / '+typeof value+' '+String(value),()=>{
   const payload={pull_request:{number:value},issue:{number:value},inputs:{pr_number:value}};
   assert.equal(selectCouncilTargetNumber(event,payload),null);
  });
 }
}

const identity=(operation='identity.read')=>({source:'github-installation-token-readback',verified:true,principal:ULTRON_GITHUB_PRINCIPAL,repository:REPO,repositoryId:repo.id,installationId:12345,actorRef:'github-app:ultron-operator',operation,expiresAt:'2026-10-31T17:50:00Z',permissions:requiredTokenPermissions(operation)});
const plan=()=>({schema:'ultron.repair.plan.v1',owner:owner.login,objective:'Repair a seeded failing unit test',repository:REPO,baseSha:head,branch:'ultron/repair-seeded-test',allowedPaths:['src/brain.mjs','test/brain.test.mjs'],idempotencyKey:'repair:seeded-test-001',maxAttempts:3,maxCostCents:0,paidFallback:false,expiresAt:'2026-10-31T18:00:00Z'});
const controls=()=>({paused:false,revoked:false});
const admit=(overrides={})=>admitRepairTask({plan:plan(),identityEvidence:identity(),controls:controls(),now,...overrides});
const operations=['branch.create','branch.update','pr.create','pr.update','pr.comment'];
function step(operation,attempt=1){const p=plan();return {operation,repository:REPO,branch:p.branch,baseSha:p.baseSha,idempotencyKey:p.idempotencyKey,attempt,...(operation==='branch.update'?{path:p.allowedPaths[0]}:{})};}
const gate=operation=>({now,controls:controls(),identityEvidence:identity('repair.'+operation)});
for(const operation of operations){
 for(const attempt of [1,2,3])test('Repair '+operation+' / valid attempt '+attempt,()=>{
  const result=assertRepairStep(admit(),step(operation,attempt),gate(operation));
  assert.deepEqual(result,{admitted:true,operation,tokenProfile:'repair.'+operation,attempt});
  assert.equal(Object.isFrozen(result),true);
 });
 const scopes=[['wrong repository',{repository:'other/repo'}],['wrong base',{baseSha:other}],['wrong branch',{branch:'main'}],['wrong idempotency key',{idempotencyKey:'repair:unrelated-001'}],['zero attempt',{attempt:0}],['negative attempt',{attempt:-1}],['fractional attempt',{attempt:1.5}],['too many attempts',{attempt:4}],['string attempt',{attempt:'1'}],['extra authority',{admin:true}],['disallowed path',{path:'src/escape.mjs'}]];
 for(const [label,patch] of scopes)test('Repair '+operation+' / '+label,()=>assert.throws(()=>assertRepairStep(admit(),{...step(operation),...patch},gate(operation)),/Repair step/));
 const contexts=[['paused',{controls:{paused:true,revoked:false}}],['revoked',{controls:{paused:false,revoked:true}}],['missing controls',{controls:null}],['invalid time',{now:'invalid'}],['expired admission',{now:plan().expiresAt}],['identity switched',{identityEvidence:{...identity('repair.'+operation),installationId:999}}],['wrong operation identity',{identityEvidence:identity()}],['unverified identity',{identityEvidence:{...identity('repair.'+operation),verified:false}}]];
 for(const [label,patch] of contexts)test('Repair '+operation+' / '+label,()=>assert.throws(()=>assertRepairStep(admit(),step(operation),{...gate(operation),...patch}),/Repair step/));
 test('Repair '+operation+' / cloned admission denied',()=>assert.throws(()=>assertRepairStep({...admit()},step(operation),gate(operation)),/Repair step/));
}

const slot=()=>({slot_key:'2026-11-18T03:00Z',classification:'scheduled',repo_status:'done',council_status:'done',repo_source:'github-api',repo_repository:REPO,repo_admissions:1,council_admissions:1,authentic_repo_admissions:1,authentic_council_admissions:1,observed_repo_receipts:1,observed_council_receipts:1,council_assessments:1,free_council_assessments:1});
const countFields=['repo_admissions','council_admissions','authentic_repo_admissions','authentic_council_admissions','observed_repo_receipts','observed_council_receipts','council_assessments','free_council_assessments'];
for(const field of countFields){
 for(const value of [0,2,-1,1.5,null,undefined,'invalid'])test('Scheduler missing/duplicate evidence '+field+' / '+String(value),()=>assert.equal(classifyTerminalSlotEvidence({...slot(),[field]:value}),null));
 test('Scheduler accepts PostgreSQL numeric string '+field,()=>assert.equal(classifyTerminalSlotEvidence({...slot(),[field]:'1'}),'done'));
}
for(const role of ['repo','council']){
 for(const status of ['queued','leased','running','pending','failed',null,undefined]){
  test('Scheduler '+role+' / '+String(status)+' is nonterminal',()=>assert.equal(classifyTerminalSlotEvidence({...slot(),[role+'_status']:status}),null));
 }
 for(const value of [0,1,2,-1,null,undefined,'1','invalid']){
  test('Scheduler '+role+' blocked / terminal receipt '+String(value),()=>assert.equal(classifyTerminalSlotEvidence({...slot(),[role+'_status']:'blocked',['terminal_'+role+'_failure_receipts']:value}),Number(value)===1?'failed':null));
 }
}
for(const classification of ['recovery','manual','recovered','unknown',null,undefined])test('Scheduler cannot promote '+String(classification)+' admission',()=>assert.equal(classifyTerminalSlotEvidence({...slot(),classification}),null));
for(const status of ['queued','leased','blocked','completion-uncertain','running']){
 for(const objective of ['repo.inspect','council.review'])test('Scheduler ignores '+objective+' / '+status,async()=>{
  let queries=0;const db={query:async()=>{queries++;throw Error('unexpected query');}};
  const r=await reconcileRecentNaturalSlots({db,outcomes:[{status,objective,task_id:1}]});
  assert.deepEqual(r,{checked:0,completed:0,failed:0});assert.equal(queries,0);
 });
}
for(const objective of ['repo.inspect','council.review'])for(const status of ['done','failed']){
 test('Scheduler duplicate '+objective+' / '+status+' cannot double-write',async()=>{
  const calls=[];const db={query:async(sql,params)=>{calls.push(params);return {rows:sql.includes('SELECT s.slot_key')?[slot()]:[{slot_key:slot().slot_key}]};}};
  const outcome={objective,status,task_id:1};const result=await reconcileRecentNaturalSlots({db,outcomes:[outcome,{...outcome},{...outcome}]});
  assert.deepEqual(result,{checked:1,completed:1,failed:0});assert.equal(calls.length,2);
 });
}
