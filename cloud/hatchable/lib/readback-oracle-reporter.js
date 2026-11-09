import {createHash} from 'node:crypto';
import {canonicalJson} from '../../../src/verification/canonical_json.mjs';

// Use only inside an already authenticated Hatchable runtime. This storage
// adapter is deliberately not an HTTP endpoint and grants no execution rights.
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,127}$/;
const HEX=/^[a-f0-9]{64}$/;
const CHECKS=new Set(['http_status','dom_element_present',
 'github_api_readback','database_readback']);
const STATUSES=new Set(['verified-external','observed-only','not-verified',
 'reconcile-required']);
const keys=(obj)=>Object.keys(obj).sort().join(',');

function validate(event){
 if(!event||typeof event!=='object'||Array.isArray(event)||
  keys(event)!=='attemptId,checks,evidenceDigest,schema,status,verifiedAt'||
  event.schema!=='ultron.readback-oracle.v1'||!ID.test(event.attemptId||'')||
  !STATUSES.has(event.status)||!HEX.test(event.evidenceDigest||'')||
  !Array.isArray(event.checks)||event.checks.length<1||event.checks.length>8||
  typeof event.verifiedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.verifiedAt))
  throw Error('oracle-event-invalid');
 for(const check of event.checks){
  if(!check||typeof check!=='object'||Array.isArray(check)||
   keys(check)!=='checkType,expectedDigest,ok,reason,targetDigest,tier'||
   !CHECKS.has(check.checkType)||typeof check.ok!=='boolean'||
   !HEX.test(check.targetDigest||'')||!HEX.test(check.expectedDigest||'')||
   !['matched','mismatch','unavailable','unsupported'].includes(check.reason)||
   check.tier!==(check.checkType==='http_status'?'transport-only':
    check.checkType==='dom_element_present'?'dom-only':'provider-state'))
   throw Error('oracle-event-invalid');
 }
 const unavailable=event.checks.some(c=>c.reason==='unavailable');
 const passed=event.checks.every(c=>c.ok);
 const durable=event.checks.some(c=>c.tier==='provider-state'&&c.ok);
 const inferred=unavailable?'reconcile-required':!passed?'not-verified':
  durable?'verified-external':'observed-only';
 if(event.status!==inferred)throw Error('oracle-event-invalid');
 const {evidenceDigest,...unsigned}=event;
 if(createHash('sha256').update(canonicalJson(unsigned)).digest('hex')!==evidenceDigest)
  throw Error('oracle-event-invalid');
}
function fromRow(row){
 if(!row)return null;
 const e=row.event;
 validate(e);
 if(row.attemptId!==e.attemptId||row.evidenceDigest!==e.evidenceDigest||
  row.status!==e.status)throw Error('oracle-receipt-conflict');
 return e;
}
export function createHatchableReadbackReporter(db){
 if(typeof db?.query!=='function')throw Error('hatchable-oracle-db-unavailable');
 const read=async attemptId=>{
  if(!ID.test(attemptId||''))throw Error('oracle-attempt-invalid');
  const result=await db.query(`SELECT attempt_id AS "attemptId",
   evidence_digest AS "evidenceDigest",status,event
   FROM brain_readback_oracle_events WHERE attempt_id=$1`,[attemptId]);
  if(!Array.isArray(result?.rows)||result.rows.length>1)
   throw Error('oracle-receipt-read-unavailable');
  return fromRow(result.rows[0]);
 };
 const write=async event=>{
  validate(event);
  await db.query(`INSERT INTO brain_readback_oracle_events
   (attempt_id,evidence_digest,status,event) VALUES($1,$2,$3,$4::jsonb)
   ON CONFLICT (attempt_id) DO NOTHING RETURNING attempt_id AS "attemptId"`,
   [event.attemptId,event.evidenceDigest,event.status,JSON.stringify(event)]);
  const persisted=await read(event.attemptId);
  if(!persisted||persisted.evidenceDigest!==event.evidenceDigest)
   throw Error('oracle-receipt-conflict');
  return {ok:true};
 };
 return Object.freeze({write,read});
}
