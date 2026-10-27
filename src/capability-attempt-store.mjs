/** Atomic provider attempt ledger. Receipts contain public digests only.
 * A database UNIQUE key and committed CAS transitions are required. */
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9_.-]{2,79}:[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const STATES=new Set(['approval-pending','reconcile-required','completed']);
function validate(id,fingerprint,receipt){
 if(!ID.test(id||'')||!HASH.test(fingerprint||'')||
    !STATES.has(receipt?.status)||
    JSON.stringify(receipt).length>4000)
   throw Error('Invalid durable capability attempt');
}
export function createPostgresCapabilityAttemptStore({db}={}){
 if(typeof db?.query!=='function')
   throw Error('PostgreSQL capability attempt connection required');
 return Object.freeze({
   async claim({id,fingerprint,receipt}){
     validate(id,fingerprint,receipt);
     if(receipt.status!=='approval-pending')
       throw Error('Attempt admission must precede dispatch');
     const reserved=await db.query(`INSERT INTO capability_attempts
       (attempt_id,fingerprint,status,receipt)
       VALUES($1,$2,$3,$4::jsonb)
       ON CONFLICT(attempt_id) DO NOTHING
       RETURNING attempt_id,fingerprint,receipt`,
       [id,fingerprint,receipt.status,JSON.stringify(receipt)]);
     if(reserved.rows.length===1)
       return {claimed:true,fingerprint,receipt};
     const existing=await db.query(`SELECT fingerprint,receipt
       FROM capability_attempts WHERE attempt_id=$1`,[id]);
     if(existing.rows.length!==1 || !STATES.has(existing.rows[0].receipt?.status))
       throw Error('Durable claim state unavailable');
     return {claimed:false,fingerprint:existing.rows[0].fingerprint,
       receipt:existing.rows[0].receipt};
   },
   async advance({id,fingerprint,expectedStatus,receipt}){
     validate(id,fingerprint,receipt);
     if(!STATES.has(expectedStatus) ||
        !(['approval-pending','reconcile-required'].includes(expectedStatus)) ||
        (expectedStatus==='approval-pending' && receipt.status!=='reconcile-required') ||
        (expectedStatus==='reconcile-required' && receipt.status!=='completed'))
       throw Error('Invalid durable attempt transition');
     const result=await db.query(`UPDATE capability_attempts
       SET status=$4,receipt=$5::jsonb,updated_at=now()
       WHERE attempt_id=$1 AND fingerprint=$2 AND status=$3
       RETURNING attempt_id`,
       [id,fingerprint,expectedStatus,receipt.status,JSON.stringify(receipt)]);
     if(result.rows.length!==1)
       throw Error('Durable attempt transition conflict');
     return true;
   },
   async release({id,fingerprint}){
     if(!ID.test(id||'')||!HASH.test(fingerprint||''))
       throw Error('Invalid durable approval release');
     const removed=await db.query(`DELETE FROM capability_attempts
       WHERE attempt_id=$1 AND fingerprint=$2 AND status='approval-pending'
       RETURNING attempt_id`,[id,fingerprint]);
     if(removed.rows.length!==1)
       throw Error('Durable approval no longer releasable');
     return true;
   }
 });
}
