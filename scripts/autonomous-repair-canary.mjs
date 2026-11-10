#!/usr/bin/env node
/**
 * Offline executable acceptance canary.
 * Real PostgreSQL-compatible PGlite checkpoint/trigger storage and real
 * coordinator, but ONLY deterministic simulated GitHub/CI adapters.
 * Does not read credentials, access a network, or modify a repository.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createAutonomousRepairPlan,runAutonomousRepair}
 from '../src/autonomous-repair-loop.mjs';
import {createPostgresAutonomousRepairLedger}
 from '../src/autonomous-repair-postgres-ledger.mjs';

const SCENARIOS=new Set(['success','repair','exhausted','response-loss','pending']);
const args=process.argv.slice(2);
if(args.includes('--help')){
 process.stdout.write('Usage: npm run repair:canary -- --scenario success|repair|exhausted|response-loss|pending [--json]\n');
 process.exit(0);
}
const ix=args.indexOf('--scenario');
const scenario=ix<0?'success':args[ix+1];
if(!SCENARIOS.has(scenario)||args.some((arg,i)=>
 !['--scenario','--json',scenario].includes(arg)||arg==='--scenario'&&i===args.length-1)){
 process.stderr.write('Invalid scenario. Only offline canary scenarios are supported.\n');
 process.exit(2);
}
const JSON_MODE=args.includes('--json');
const clock=()=>Date.parse('2026-11-09T20:00:00.000Z');
const shaFor=attempt=>String.fromCharCode(97+attempt).repeat(40);
const hash=payload=>createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const plan=createAutonomousRepairPlan({
 id:'repair-offline-canary-001',owner:'michaeljwilliams0123',
 repository:'michaeljwilliams0123/Ultron.MW',
 branch:'ultron/repair-offline-canary-001',
 baseSha:shaFor(0),objective:'Demonstrate durable self-healing without external writes',
 allowedPaths:['src/canary.mjs'],maxAttempts:3,maxPaidCents:0,
 paidFallback:false,expiresAt:'2026-11-10T19:00:00.000Z'
},clock());
const dispatches={patch:0,verify:0,publish:0};
const db=new PGlite();
try{
 const migration=readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8');
 await db.exec(migration);
 const ledger=createPostgresAutonomousRepairLedger({db});
 let patchPresent=false,prPresent=false,readbackBlocked=scenario==='response-loss';
 let pending=scenario==='pending',resumeCount=0;
 const repairer={propose:async({headSha,attempt,previousFailure})=>{
  if(attempt>1&&!previousFailure.startsWith('FAIL'))
   throw Error('Canary missing first failure trace');
  return {objective:'Fix canary source',baseSha:headSha,
   changes:[{path:'src/canary.mjs',before:'old-value',after:'fixed-'+attempt}]};
 }};
 const patcher={
  apply:async()=>{dispatches.patch++;patchPresent=true;
   if(scenario==='response-loss')throw Error('Simulated lost GitHub acknowledgement');},
  observe:async({manifest,expectedHeadSha,attempt})=>{
   if(readbackBlocked){readbackBlocked=false;return null;}
   return patchPresent?{verified:true,baseSha:expectedHeadSha,
    headSha:shaFor(attempt),patchDigest:hash(manifest)}:null;
  }
 };
 const verifier={
  start:async()=>{dispatches.verify++;},
  observe:async({attempt,headSha})=>{
   if(pending){pending=false;return {state:'pending',headSha};}
   const failure=scenario==='exhausted'||scenario==='repair'&&attempt===1;
   return {state:'completed',verified:true,runId:attempt+100,
    headSha,conclusion:failure?'failure':'success',
    errorTrace:'FAIL simulated canary assertion on src/canary.mjs'};
  }
 };
 const publisher={
  start:async()=>{dispatches.publish++;prPresent=true;},
  observe:async({plan:current,headSha})=>prPresent?
   {verified:true,branch:current.branch,headSha,prNumber:900}:null
 };
 const deps={plan,ledger,repairer,patcher,verifier,publisher,
  authorize:async()=>true,now:clock};
 let result=await runAutonomousRepair(deps);
 if(['response-loss','pending'].includes(scenario)){
  if(!['reconcile-required','verifying'].includes(result.status))
   throw Error('Canary expected a resumable uncertainty checkpoint');
  resumeCount++;
  result=await runAutonomousRepair({...deps,
   ledger:createPostgresAutonomousRepairLedger({db})});
 }
 const observed=await ledger.read(plan.id);
 const events=await db.query(`SELECT version,from_phase,to_phase
   FROM brain_autonomous_repair_events
   WHERE repair_id=$1 ORDER BY version`,[plan.id]);
 const history=events.rows.map(r=>({
  version:r.version,from:r.from_phase,to:r.to_phase
 }));
 const expected=scenario==='exhausted'?'exhausted':'completed';
 if(result.status!==expected||history.length<3||
   (['response-loss','pending'].includes(scenario)&&
    (dispatches.patch!==1||dispatches.verify!==1||dispatches.publish!==1)))
  throw Error('Canary regression: incorrect bounded recovery outcome');
 const out={schema:'ultron.repair.canary.v1',mode:'offline-local-simulation',
  scenario,status:result.status,attempt:observed.attempt,
  checkpoint:observed.phase,resumeCount,dispatches,history,
  maxPaidCents:0,externalWrites:false,liveAcceptance:false};
 if(JSON_MODE)process.stdout.write(JSON.stringify(out)+'\n');
 else process.stdout.write(
  'Offline repair canary: '+out.status+
  ' · attempts='+out.attempt+
  ' · resumes='+resumeCount+
  ' · patch dispatches='+dispatches.patch+
  ' · checkpoints='+history.length+'\n'+
  'No GitHub writes, deployments, network access or paid inference.\n');
}finally{
 await db.close();
}
