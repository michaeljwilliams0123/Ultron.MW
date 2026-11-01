/**
 * Crash-durable Repair App branch/PR intent ledger.
 * Requires migration 0012_repair_pr_attempts.sql to have been applied to
 * PostgreSQL. This adapter does not create credentials or deploy migrations.
 */
const KEY=/^repair:[a-z0-9][a-z0-9-]{7,90}$/;
const HASH=/^[a-f0-9]{64}$/;
const PHASES=new Set(['reserved','branch-dispatch','branch-confirmed','pr-dispatch','complete']);
const NEXT=Object.freeze({
 'reserved':'branch-dispatch',
 'branch-dispatch':'branch-confirmed',
 'branch-confirmed':'pr-dispatch',
 'pr-dispatch':'complete',
});
function validateKey(key){
  if(typeof key!=='string'||!KEY.test(key))
    throw Error('Repair idempotency key invalid');
}
function validateFingerprint(fingerprint){
  if(typeof fingerprint!=='string'||!HASH.test(fingerprint))
    throw Error('Repair fingerprint invalid');
}
function normalize(row,expectedKey){
  // SQL WHERE and RETURNING alone cannot attest a trustworthy adapter row.
  // Every readback must bind to the requested immutable attempt identity.
  if(!row||typeof row!=='object'||row.attempt_key!==expectedKey)
    throw Error('Repair durable readback identity mismatch');
  if(!PHASES.has(row.phase)||!HASH.test(row.fingerprint||'')||
    (row.phase==='complete'
      ? !Number.isSafeInteger(row.pr_number)||row.pr_number<1
      : row.pr_number!==null&&row.pr_number!==undefined))
    throw Error('Repair persisted ledger row invalid');
  return Object.freeze({
    key:row.attempt_key,fingerprint:row.fingerprint,
    phase:row.phase,prNumber:row.pr_number??null
  });
}
export function createPostgresRepairLedger({db}={}){
  if(typeof db?.query!=='function')
    throw Error('PostgreSQL repair attempt connection required');
  return Object.freeze({
    async claim({key,fingerprint}={}){
      validateKey(key);validateFingerprint(fingerprint);
      const inserted=await db.query(`INSERT INTO repair_pr_attempts
       (attempt_key,fingerprint,phase)
       VALUES($1,$2,'reserved')
       ON CONFLICT(attempt_key) DO NOTHING
       RETURNING attempt_key,fingerprint,phase,pr_number`,[key,fingerprint]);
      if(!Array.isArray(inserted?.rows)||inserted.rows.length>1)
        throw Error('Repair durable claim reconcile-required');
      const claimed=inserted.rows.length===1;
      if(claimed){
        const acknowledged=normalize(inserted.rows[0],key);
        if(acknowledged.fingerprint!==fingerprint||
           acknowledged.phase!=='reserved'||acknowledged.prNumber!==null)
          throw Error('Repair durable claim readback mismatch');
      }
      // An INSERT acknowledgement cannot certify durable admission. Independently
      // read back the fence before allowing any downstream external dispatch.
      // A competing valid worker may advance the phase before this SELECT.
      let existing;
      try{
        existing=await db.query(`SELECT attempt_key,fingerprint,phase,pr_number
          FROM repair_pr_attempts WHERE attempt_key=$1`,[key]);
      }catch{throw Error('Repair durable claim reconcile-required');}
      if(!Array.isArray(existing?.rows)||existing.rows.length!==1)
        throw Error('Repair durable claim reconcile-required');
      const entry=normalize(existing.rows[0],key);
      if(entry.fingerprint!==fingerprint)
        throw Error('Repair idempotency fingerprint collision');
      return {claimed,entry};
    },
    async get(key){
      validateKey(key);
      const found=await db.query(`SELECT attempt_key,fingerprint,phase,pr_number
        FROM repair_pr_attempts WHERE attempt_key=$1`,[key]);
      if(found.rows.length===0)return null;
      if(found.rows.length!==1)throw Error('Repair durable readback conflict');
      return normalize(found.rows[0],key);
    },
    async advance({key,fingerprint,from,to,prNumber=null}={}){
      validateKey(key);validateFingerprint(fingerprint);
      if(!PHASES.has(from)||NEXT[from]!==to)
        throw Error('Repair durable transition invalid');
      if(to==='complete'
        ? !Number.isSafeInteger(prNumber)||prNumber<1
        : prNumber!==null)
        throw Error('Repair PR number invalid');
      const changed=await db.query(`UPDATE repair_pr_attempts
        SET phase=$4,pr_number=COALESCE($5,pr_number),updated_at=now()
        WHERE attempt_key=$1 AND fingerprint=$2 AND phase=$3
        RETURNING attempt_key`,[key,fingerprint,from,to,prNumber]);
      if(!Array.isArray(changed?.rows)||changed.rows.length>1)
        throw Error('Repair durable CAS conflict');
      if(changed.rows.length===0)return false;
      if(changed.rows[0]?.attempt_key!==key)
        throw Error('Repair durable transition readback identity mismatch');
      // A successful UPDATE acknowledgement is not proof of persisted state.
      // Read-only reconciliation never repeats an uncertain external write.
      let persisted;
      try {persisted=await db.query(`SELECT attempt_key,fingerprint,phase,pr_number
        FROM repair_pr_attempts WHERE attempt_key=$1`,[key]);}
      catch {throw Error('Repair durable transition reconcile-required');}
      if(persisted?.rows?.length!==1)
        throw Error('Repair durable transition readback mismatch');
      const entry=normalize(persisted.rows[0],key);
      if(entry.fingerprint!==fingerprint||entry.phase!==to||
        (to==='complete'&&entry.prNumber!==prNumber))
        throw Error('Repair durable transition readback mismatch');
      return true;
    }
  });
}
