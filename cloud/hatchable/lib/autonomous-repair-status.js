/**
 * Read-only owner repair inventory for Hatchable.
 * Exposes only a safe progress projection of durable PostgreSQL checkpoints.
 * Never includes model prompts, patch contents, failures, tokens, or an
 * operation that can authorize/retry a GitHub mutation.
 */
const ID=/^[a-z][a-z0-9-]{7,79}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const PHASES=Object.freeze({
 ready:{recoveryMode:'authorized-repair',nextAction:'Ready for an authorized bounded repair attempt',progressPercent:10},
 'patch-dispatched':{recoveryMode:'readback-only',nextAction:'Inspect the GitHub patch effect; do not send a second write',progressPercent:30},
 applied:{recoveryMode:'verify',nextAction:'Run or observe the exact-head verification workflow',progressPercent:50},
 verifying:{recoveryMode:'readback-only',nextAction:'Observe the existing exact-head CI run without redispatch',progressPercent:65},
 verified:{recoveryMode:'authorized-publication',nextAction:'Obtain publication authorization and create a reviewable PR',progressPercent:80},
 'publication-dispatched':{recoveryMode:'readback-only',nextAction:'Read back the exact GitHub PR; never repeat an uncertain POST',progressPercent:90},
 complete:{recoveryMode:'none',nextAction:'Review the verified pull request; merge and deploy are separate',progressPercent:100},
 exhausted:{recoveryMode:'manual-review',nextAction:'Three-attempt ceiling reached or plan exhausted; inspect evidence and create a new approved task',progressPercent:100}
});
function timestamp(value){
 if(value==null)return null;
 const input=value instanceof Date?value:new Date(value);
 return Number.isFinite(input.getTime())?input.toISOString():null;
}
function safeRecord(record){
 if(!record||typeof record!=='object'||Array.isArray(record)||
  !ID.test(record.id||'')||!DIGEST.test(record.fingerprint||'')||
  !Object.hasOwn(PHASES,record.phase)||
  !Number.isSafeInteger(record.attempt)||record.attempt<0||record.attempt>3||
  !Number.isSafeInteger(record.maxAttempts)||record.maxAttempts<1||
  record.maxAttempts>3||record.attempt>record.maxAttempts||
  !Number.isSafeInteger(record.version)||record.version<0||
  !SHA.test(record.headSha||'')||
  (record.phase==='complete'&&(!Number.isSafeInteger(record.prNumber)||record.prNumber<1))||
  (record.prNumber!=null&&(!Number.isSafeInteger(record.prNumber)||record.prNumber<1))||
  (record.phase!=='complete'&&record.prNumber!=null))
  throw Error('autonomous-repair-status-record-invalid');
 return record;
}
export function normalizeRepairStatus(record,updatedAt=null){
 const r=safeRecord(record),state=PHASES[r.phase];
 return Object.freeze({
  id:r.id,phase:r.phase,attempt:r.attempt,maxAttempts:r.maxAttempts,
  headSha:r.headSha,version:r.version,updatedAt:timestamp(updatedAt),
  nextAction:state.nextAction,recoveryMode:state.recoveryMode,
  progressPercent:state.progressPercent,
  prUrl:r.phase==='complete'?
   'https://github.com/michaeljwilliams0123/Ultron.MW/pull/'+r.prNumber:null
 });
}
function normalizeRow(row){
 if(!row||typeof row.record_json!=='string'||row.record_json.length>33000)
  throw Error('autonomous-repair-status-record-invalid');
 let value;
 try{value=JSON.parse(row.record_json);}catch{throw Error('autonomous-repair-status-record-invalid');}
 return normalizeRepairStatus(value,row.updated_at);
}
function checkDB(db){
 if(typeof db?.query!=='function')throw Error('autonomous-repair-status-db-required');
}
export async function listRepairStatuses({db,limit=25}={}){
 checkDB(db);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)
  throw Error('autonomous-repair-status-limit-invalid');
 const result=await db.query(`SELECT record_json,updated_at
   FROM brain_autonomous_repairs ORDER BY updated_at DESC,repair_id ASC LIMIT $1`,[limit]);
 if(!Array.isArray(result?.rows)||result.rows.length>limit)
  throw Error('autonomous-repair-status-result-invalid');
 return Object.freeze(result.rows.map(normalizeRow));
}
export async function getRepairStatus({db,id}={}){
 checkDB(db);
 if(typeof id!=='string'||!ID.test(id))
  throw Error('autonomous-repair-status-id-invalid');
 const result=await db.query(`SELECT record_json,updated_at
   FROM brain_autonomous_repairs WHERE repair_id=$1`,[id]);
 if(!Array.isArray(result?.rows)||result.rows.length>1)
  throw Error('autonomous-repair-status-result-invalid');
 return result.rows.length?normalizeRow(result.rows[0]):null;
}
