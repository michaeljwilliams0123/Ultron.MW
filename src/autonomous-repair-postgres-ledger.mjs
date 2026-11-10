/**
 * PostgreSQL adapter for the autonomous repair state machine.
 * Requires migration 0039; never used as an in-memory production substitute.
 * Compare-and-swap transition and history event commit in one SQL statement.
 */
const ID=/^[a-z][a-z0-9-]{7,79}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const NEXT=Object.freeze({
 ready:['patch-dispatched'],'patch-dispatched':['applied'],
 applied:['verifying'],verifying:['ready','verified','exhausted'],
 verified:['publication-dispatched'],'publication-dispatched':['complete']
});
const CHANGE_KEYS=new Set(['attempt','manifest','patchDigest','headSha','errorTrace','prNumber']);
function decode(rows,id){
 if(!Array.isArray(rows)||rows.length!==1)throw Error('autonomous-repair-readback-unavailable');
 const item=rows[0];
 if(item?.repair_id!==id||!DIGEST.test(item.fingerprint||'')||
    !Number.isSafeInteger(Number(item.version)))
  throw Error('autonomous-repair-identity-conflict');
 let record;
 try{record=JSON.parse(item.record_json);}catch{
  throw Error('autonomous-repair-record-invalid');
 }
 if(!record||Array.isArray(record)||record.id!==id||
   record.fingerprint!==item.fingerprint||record.phase!==item.phase||
   record.version!==Number(item.version)||!SHA.test(record.headSha||''))
  throw Error('autonomous-repair-record-mismatch');
 return record;
}
export function createPostgresAutonomousRepairLedger({db}={}){
 if(typeof db?.query!=='function')throw Error('autonomous-repair-PostgreSQL-required');
 const read=async id=>{
  if(typeof id!=='string'||!ID.test(id))throw Error('autonomous-repair-id-invalid');
  const result=await db.query(`SELECT repair_id,fingerprint,phase,version,record_json
   FROM brain_autonomous_repairs WHERE repair_id=$1`,[id]);
  if(!Array.isArray(result?.rows)||result.rows.length>1)
   throw Error('autonomous-repair-readback-unavailable');
  if(result.rows.length===0)return null;
  return decode(result.rows,id);
 };
 const claim=async plan=>{
  if(!ID.test(plan?.id||'')||!DIGEST.test(plan?.fingerprint||'')||
     !SHA.test(plan?.baseSha||'')||plan?.schema!=='ultron.autonomous-repair.v1')
   throw Error('autonomous-repair-claim-invalid');
  const record={id:plan.id,fingerprint:plan.fingerprint,phase:'ready',
   attempt:0,headSha:plan.baseSha,manifest:null,patchDigest:null,
   errorTrace:'',prNumber:null,version:0};
  const inserted=await db.query(`INSERT INTO brain_autonomous_repairs
   (repair_id,fingerprint,phase,version,record_json)
   VALUES($1,$2,'ready',0,$3)
   ON CONFLICT(repair_id) DO NOTHING RETURNING repair_id`,
   [plan.id,plan.fingerprint,JSON.stringify(record)]);
  if(!Array.isArray(inserted?.rows)||inserted.rows.length>1)
   throw Error('autonomous-repair-claim-uncertain');
  const observed=await read(plan.id);
  if(observed?.fingerprint!==plan.fingerprint)
   throw Error('autonomous-repair-idempotency-conflict');
  return observed;
 };
 const transition=async({id,fingerprint,from,to,changes={},expectedVersion}={})=>{
  if(!ID.test(id||'')||!DIGEST.test(fingerprint||'')||
     !NEXT[from]?.includes(to)||!Number.isSafeInteger(expectedVersion)||
     expectedVersion<0||!changes||typeof changes!=='object'||
     Array.isArray(changes)||Object.keys(changes).some(x=>!CHANGE_KEYS.has(x)))
   throw Error('autonomous-repair-transition-invalid');
  const original=await read(id);
  if(!original||original.fingerprint!==fingerprint)throw Error('autonomous-repair-idempotency-conflict');
  if(original.phase!==from||original.version!==expectedVersion)return null;
  const next={...original,...changes,phase:to,version:expectedVersion+1};
  if(next.id!==original.id||next.fingerprint!==original.fingerprint||
     !SHA.test(next.headSha||'')||!Number.isInteger(next.attempt)||
     next.attempt<0||next.attempt>3||
     (from==='ready'&&next.attempt!==original.attempt+1)||
     (from!=='ready'&&next.attempt!==original.attempt)||
     (to==='patch-dispatched'&&(!next.manifest||
       !DIGEST.test(next.patchDigest||'')))||
     (to==='complete'&&(!Number.isSafeInteger(next.prNumber)||
       next.prNumber<1))||
     typeof next.errorTrace!=='string'||next.errorTrace.length>1500||
     JSON.stringify(next).length>32000)
   throw Error('autonomous-repair-transition-content-invalid');
  const result=await db.query(`WITH changed AS (
    UPDATE brain_autonomous_repairs
    SET phase=$4,version=version+1,record_json=$5,updated_at=now()
    WHERE repair_id=$1 AND fingerprint=$2 AND phase=$3 AND version=$6
    RETURNING repair_id,version
   ), event AS (
    INSERT INTO brain_autonomous_repair_events(repair_id,version,from_phase,to_phase)
    SELECT repair_id,version,$3,$4 FROM changed RETURNING repair_id
   ) SELECT changed.repair_id FROM changed JOIN event USING(repair_id)`,
    [id,fingerprint,from,to,JSON.stringify(next),expectedVersion]);
  if(!Array.isArray(result?.rows)||result.rows.length>1)
   throw Error('autonomous-repair-CAS-uncertain');
  if(!result.rows.length)return null;
  if(result.rows[0].repair_id!==id)throw Error('autonomous-repair-CAS-identity-mismatch');
  const observed=await read(id);
  if(JSON.stringify(observed)!==JSON.stringify(next))
   throw Error('autonomous-repair-CAS-readback-mismatch');
  return observed;
 };
 return Object.freeze({claim,read,transition});
}
