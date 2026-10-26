// Ephemeral PostgreSQL integration: no production Hatchable data or external writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {persistAcceptanceEvidence} from '../cloud/hatchable/lib/acceptance-evidence.js';

const run=promisify(execFile);
const MAIN='a'.repeat(40),HEAD='b'.repeat(40),TREE='c'.repeat(40),BASE='d'.repeat(40);
const OBJECTIVE='issue-68-stage-1';
const REPO='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const REVIEW_BODY='<!-- coderabbit-ai-generated:v1 -->\n\n**Actionable comments posted: 0**';
const IDS=['identity_id','assessment_id','manifest_id','evaluation_id',
 'baseline_task_id','candidate_task_id','baseline_receipt_id','candidate_receipt_id'];

function fixture({freezeId=700,frozenAt='2026-10-25T10:00:00Z',
 reviewerId=136622811,sourceSha=MAIN,setsDisjoint=false}={}){
 const manifest={schema:'ultron.github-review-proxy-manifest.v1',
  objectiveId:OBJECTIVE,baselinePullNumber:103,candidatePullNumber:106,
  candidateHeadSha:HEAD,frozen:true,setsDisjoint,
  evaluator:'github-review-actionable-findings-v1',
  scoring:'1/(1+actionable-comments)'};
 const values={
  '/git/ref/heads/main':{object:{sha:sourceSha}},
  '/pulls/106':{number:106,merged:true,merge_commit_sha:MAIN,
   user:{login:'michaeljwilliams0123'},head:{sha:HEAD}},
  '/issues/106/comments?per_page=100':[{
   id:freezeId,user:{login:'michaeljwilliams0123'},author_association:'OWNER',
   created_at:frozenAt,updated_at:frozenAt,
   body:'<!-- ultron-review-proxy-manifest:v1\n'+JSON.stringify(manifest)+'\n-->'
  }],
  '/pulls/106/reviews?per_page=100':[{
   id:800,user:{login:'coderabbitai[bot]',id:reviewerId,type:'Bot'},
   state:'COMMENTED',commit_id:HEAD,submitted_at:'2026-10-25T10:05:00Z',
   body:REVIEW_BODY
  }],
  ['/commits/'+MAIN]:{commit:{tree:{sha:TREE}}},
  ['/commits/'+HEAD]:{commit:{tree:{sha:TREE}}},
  '/pulls/103':{number:103,merged:true,head:{sha:BASE}},
  '/pulls/103/reviews?per_page=100':[{
   id:600,user:{login:'coderabbitai[bot]',id:136622811,type:'Bot'},
   state:'COMMENTED',commit_id:BASE,submitted_at:'2026-10-24T10:00:00Z',
   body:'<!-- coderabbit-ai-generated:v1 -->\n\n**Actionable comments posted: 1**'
  }]
 };
 return async url=>{
  const key=String(url).replace(REPO,'');
  if(!(key in values))throw Error('unexpected-github-read:'+key);
  return {ok:true,json:async()=>values[key]};
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
   const result=await run('docker',['exec',container,'psql','-U','ultron',
    '-d','ultron','-X','-q','-t','-A','-F','|','-v','ON_ERROR_STOP=1',
    '-v','VERBOSITY=verbose','-c',command],{maxBuffer:1024*1024});
   return result.stdout.trim();
  }catch(error){
   const code=String(error.stderr||'').match(/\b([0-9][0-9A-Z]{4})\s*:/)?.[1]||null;
   throw Object.assign(new Error('postgres-query-failed:'+(code||'unknown')),{code});
  }
 }
 function literal(value){
  return "'"+String(value).replaceAll("'","''")+"'";
 }
 async function query(statement,params){
  assert.equal(params.length,14);
  const types='text,jsonb,text,jsonb,jsonb,text,jsonb,text,text,text,jsonb,text,jsonb,text';
  const command='PREPARE admission ('+types+') AS '+statement+
   '; EXECUTE admission('+params.map(literal).join(',')+');';
  const output=await sql(command);
  const row=output.split('\n').find(line=>/^\d+\|/.test(line));
  assert.ok(row,'PostgreSQL must return the complete projection');
  const values=row.split('|').map(Number);
  assert.equal(values.length,9,'eight receipt IDs and the consistency guard');
  assert.equal(values[8],1);
  return {rows:[Object.fromEntries(IDS.map((key,i)=>[key,values[i]]))]};
 }
 const db={query};
 async function reset(){
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for(const migration of ['0001_tasks.sql','0002_events.sql','0006_acceptance_evidence.sql']){
   await sql(readFileSync(new URL('../cloud/hatchable/migrations/'+migration,
    import.meta.url),'utf8'));
  }
 }
 async function counts(){
  const result=await sql('SELECT (SELECT COUNT(*) FROM brain_tasks),'+
   '(SELECT COUNT(*) FROM brain_events)');
  return result.split('|').map(Number);
 }
 async function admit(overrides={}){
  return persistAcceptanceEvidence({db,objectiveId:OBJECTIVE,
   candidatePullNumber:106,fetchImpl:fixture(overrides)});
 }

 test('real PostgreSQL: first admission and identical replay preserve exact receipt IDs',async()=>{
  await reset();
  const first=await admit();
  const replay=await admit();
  assert.equal(first.ok,true);
  assert.deepEqual(replay.receipts,first.receipts);
  assert.deepEqual(await counts(),[2,6]);
 });

 test('real PostgreSQL: altered frozen timestamp and comment ID fail closed and roll back',async()=>{
  for(const altered of [{frozenAt:'2026-10-25T09:59:00Z'},{freezeId:701}]){
   await reset();
   await admit();
   await assert.rejects(admit(altered),/acceptance-ledger-conflict/);
   assert.deepEqual(await counts(),[2,6],'no partial receipts after conflict');
  }
 });

 test('real PostgreSQL: concurrent identical admissions converge on one ledger projection',async()=>{
  await reset();
  const [first,second]=await Promise.all([admit(),admit()]);
  assert.deepEqual(first.receipts,second.receipts);
  assert.deepEqual(await counts(),[2,6]);
 });

 test('real PostgreSQL: stale main, forged reviewer and false disjointness never write',async()=>{
  await reset();
  for(const overrides of [
   {sourceSha:'e'.repeat(40)},{reviewerId:42},{setsDisjoint:true}
  ]){
   await assert.rejects(admit(overrides),
    /source-sha-mismatch|candidate-not-current-merged-pr|candidate-review-missing|review-proxy-manifest-missing/);
  }
  assert.deepEqual(await counts(),[0,0]);
 });
}
