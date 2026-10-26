// Ephemeral PostgreSQL integration: no production data or external writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';

const run=promisify(execFile);
const MAIN='a'.repeat(40),HEAD='b'.repeat(40),BASE='c'.repeat(40),TREE='d'.repeat(40);
const GENERATOR='e'.repeat(40),WORKFLOW_BLOB='f'.repeat(40),OBJECTIVE='issue-68-stage-1';
const REPO='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const casesSource=await readFile(new URL('../cloud/hatchable/lib/heldout-cases.js',
 import.meta.url),'utf8');
const casesUrl='data:text/javascript;base64,'+Buffer.from(casesSource).toString('base64');
const heldoutSource=(await readFile(new URL('../cloud/hatchable/lib/heldout-evidence.js',
 import.meta.url),'utf8')).replace("from 'lib/heldout-cases.js'","from '"+casesUrl+"'");
const {persistHeldOutEvidence}=await import('data:text/javascript;base64,'+
 Buffer.from(heldoutSource).toString('base64'));
const adapterSource=await readFile(new URL('../cloud/hatchable/lib/acceptance-evidence.js',
 import.meta.url),'utf8');
const encoded=value=>({encoding:'base64',content:Buffer.from(value).toString('base64')});
const caseIds=['valid-source-bound-review','edited-manifest-rejected',
 'forged-reviewer-login-rejected','forged-reviewer-id-rejected',
 'forged-reviewer-type-rejected','string-pull-number-rejected',
 'stale-source-rejected','duplicate-review-rejected','requested-changes-held',
 'tampered-assessment-rejected'];
function fixture({freezeId=700,frozenAt='2026-10-26T10:00:00Z',titleBase=BASE}={}){
 const manifest={schema:'ultron.seeded-held-out-manifest.v1',objectiveId:OBJECTIVE,
  candidatePullNumber:106,candidateHeadSha:HEAD,baselineSha:BASE,
  generatorBlobSha:GENERATOR,workflowBlobSha:WORKFLOW_BLOB,frozen:true,
  setsDisjoint:true,evaluator:'github-actions-seeded-property-v1',
  seedSource:'github.run_id',caseIds};
 const values={
  '/git/ref/heads/main':{object:{sha:MAIN}},
  '/pulls/106':{number:106,merged:true,merge_commit_sha:MAIN,
   user:{login:'michaeljwilliams0123'},head:{sha:HEAD},base:{sha:BASE}},
  '/issues/106/comments?per_page=100':[{id:freezeId,
   user:{login:'michaeljwilliams0123'},author_association:'OWNER',
   created_at:frozenAt,updated_at:frozenAt,
   body:'<!-- ultron-seeded-held-out-manifest:v1\n'+JSON.stringify(manifest)+'\n-->'}],
  ['/commits/'+MAIN]:{commit:{tree:{sha:TREE}}},
  ['/commits/'+HEAD]:{commit:{tree:{sha:TREE}}},
  ['/contents/cloud/hatchable/lib/heldout-cases.js?ref='+HEAD]:
   {sha:GENERATOR,...encoded(casesSource)},
  ['/contents/.github/workflows/held-out-acceptance.yml?ref='+HEAD]:
   {sha:WORKFLOW_BLOB,...encoded('workflow')},
  ['/contents/cloud/hatchable/lib/acceptance-evidence.js?ref='+BASE]:null,
  ['/contents/cloud/hatchable/lib/acceptance-evidence.js?ref='+HEAD]:encoded(adapterSource),
  ['/actions/runs?head_sha='+MAIN+'&event=workflow_dispatch&per_page=100']:{
   total_count:1,workflow_runs:[{id:40310000001,name:'Ultron held-out acceptance',
    display_title:'Ultron held-out acceptance '+titleBase+'..'+HEAD,
    event:'workflow_dispatch',head_sha:MAIN,status:'completed',conclusion:'success',
    created_at:'2026-10-26T10:10:00Z'}]},
  '/actions/runs/40310000001/jobs?per_page=100':{total_count:1,jobs:[{
   name:'held-out',status:'completed',conclusion:'success',steps:[{
    name:'Evaluate post-freeze seeded cases',status:'completed',conclusion:'success'}]}]}
 };
 return async url=>{
  const path=String(url).replace(REPO,'');
  if(!Object.hasOwn(values,path))throw Error('unexpected-github-read:'+path);
  if(values[path]===null)return {ok:false,status:404,json:async()=>({})};
  return {ok:true,status:200,json:async()=>values[path]};
 };
}

if(process.env.ULTRON_POSTGRES_TEST==='1'){
 const containers=execFileSync('docker',
  ['ps','--filter','ancestor=postgres:16-alpine','--format','{{.ID}}'],
  {encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.equal(containers.length,1,'exactly one ephemeral PostgreSQL CI service');
 const container=containers[0];
 async function sql(command){
  try{
   const result=await run('docker',['exec',container,'psql','-U','ultron','-d','ultron',
    '-X','-q','-t','-A','-F','|','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
    '-c',command],{maxBuffer:2*1024*1024});
   return result.stdout.trim();
  }catch(error){
   const code=String(error.stderr||'').match(/\b([0-9][0-9A-Z]{4})\s*:/)?.[1]||null;
   throw Object.assign(new Error('postgres-query-failed:'+(code||'unknown')),{code});
  }
 }
 const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
 const db={query:async(statement,params)=>{
  assert.equal(params.length,7);
  const command='PREPARE heldout (text,jsonb,jsonb,integer,text,jsonb,text) AS '+
   statement+'; EXECUTE heldout('+params.map(literal).join(',')+');';
  const output=await sql(command),line=output.split('\n').find(row=>/^\d+\|/.test(row));
  assert.ok(line,'PostgreSQL must return the complete held-out projection');
  const [manifest,evaluation,tasks,outcomes,guard]=line.split('|');
  assert.equal(Number(guard),1);
  return {rows:[{manifest_id:Number(manifest),evaluation_id:Number(evaluation),
   task_ids:JSON.parse(tasks),outcome_receipt_ids:JSON.parse(outcomes),
   consistency_guard:Number(guard)}]};
 }};
 async function reset(){
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for(const migration of ['0001_tasks.sql','0002_events.sql','0006_acceptance_evidence.sql'])
   await sql(readFileSync(new URL('../cloud/hatchable/migrations/'+migration,
    import.meta.url),'utf8'));
 }
 async function counts(){return (await sql('SELECT (SELECT COUNT(*) FROM brain_tasks),'+
  '(SELECT COUNT(*) FROM brain_events)')).split('|').map(Number);}
 const admit=overrides=>persistHeldOutEvidence({db,objectiveId:OBJECTIVE,
  candidatePullNumber:106,fetchImpl:fixture(overrides)});

 test('real PostgreSQL: seeded held-out admission replays exact twenty-case lineage',async()=>{
  await reset();
  const first=await admit(),replay=await admit();
  assert.deepEqual(replay.receipts,first.receipts);
  assert.deepEqual(await counts(),[20,22]);
 });
 test('real PostgreSQL: changed freeze evidence conflicts and rolls back',async()=>{
  await reset();await admit();
  await assert.rejects(admit({freezeId:701}),/heldout-ledger-conflict/);
  assert.deepEqual(await counts(),[20,22]);
 });
 test('real PostgreSQL: concurrent seeded admissions converge',async()=>{
  await reset();
  const [first,second]=await Promise.all([admit(),admit()]);
  assert.deepEqual(first.receipts,second.receipts);
  assert.deepEqual(await counts(),[20,22]);
 });
 test('real PostgreSQL: wrong run inputs never write',async()=>{
  await reset();
  await assert.rejects(admit({titleBase:HEAD}),/heldout-run-missing/);
  assert.deepEqual(await counts(),[0,0]);
 });
}
