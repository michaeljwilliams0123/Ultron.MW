/** Continuum C01: durable intent admission and uncertain-outcome fencing.
 * This module deliberately has NO external dispatch or privileged write verbs.
 * An authenticated receiver and independently verified receipt will be
 * introduced by separately reviewed C03/C06 work.
 */
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const IDENTIFIER=/^[a-z0-9][a-z0-9_.:-]{11,127}$/i;
const REPO='michaeljwilliams0123/Ultron.MW';
const FIELDS=['taskId','objectiveId','deliveryId','idempotencyKey','repository',
  'sourceSha','authoritySha','requestSha','leaseGeneration','expiresAt',
  'effect','maxPaidCents'];

function iso(value){
  const timestamp=new Date(value);
  if(!Number.isFinite(timestamp.getTime()))throw Error('continuum-outbox-time-invalid');
  return timestamp.toISOString();
}
function validate(contract,now){
  const c=contract;
  if(!c||typeof c!=='object'||Array.isArray(c)||
    !Number.isSafeInteger(c.taskId)||c.taskId<1||
    typeof c.objectiveId!=='string'||!IDENTIFIER.test(c.objectiveId)||
    typeof c.deliveryId!=='string'||!IDENTIFIER.test(c.deliveryId)||
    typeof c.idempotencyKey!=='string'||!IDENTIFIER.test(c.idempotencyKey)||
    c.repository!==REPO||
    !SHA.test(c.sourceSha||'')||
    !DIGEST.test(c.authoritySha||'')||
    !DIGEST.test(c.requestSha||'')||
    !Number.isSafeInteger(c.leaseGeneration)||c.leaseGeneration<1||
    !['read','advisory'].includes(c.effect)||
    c.maxPaidCents!==0)
    throw Error('continuum-outbox-admission-denied-invalid-or-metered');
  const expiresAt=iso(c.expiresAt);
  const remaining=Date.parse(expiresAt)-Date.parse(now);
  if(remaining<=0)throw Error('continuum-outbox-expired');
  if(remaining>30*24*60*60*1000)
    throw Error('continuum-outbox-admission-denied-invalid-expiry');
  return Object.freeze({...Object.fromEntries(FIELDS.map(k=>[k,c[k]])),expiresAt});
}
function same(existing,expected){
  return FIELDS.every(key=>{
    const actual=key==='expiresAt'?iso(existing[key]):
      ['taskId','leaseGeneration','maxPaidCents'].includes(key)?
        Number(existing[key]):existing[key];
    return actual===expected[key];
  });
}
function requireDb(db){
  if(typeof db?.query!=='function')throw Error('continuum-outbox-db-required');
}

export function createContinuumOutbox({db,now=()=>new Date().toISOString()}={}){
  requireDb(db);
  if(typeof now!=='function')throw Error('continuum-outbox-clock-invalid');
  const lookup=async deliveryId=>{
    const result=await db.query(`SELECT
      task_id AS "taskId",objective_id AS "objectiveId",
      delivery_id AS "deliveryId",idempotency_key AS "idempotencyKey",
      repository,source_sha AS "sourceSha",authority_sha AS "authoritySha",
      request_sha AS "requestSha",lease_generation AS "leaseGeneration",
      expires_at AS "expiresAt",effect,max_paid_cents AS "maxPaidCents",state
      FROM brain_continuum_outbox WHERE delivery_id=$1`,[deliveryId]);
    if(!result||!Array.isArray(result.rows)||result.rows.length>1)
      throw Error('continuum-outbox-readback-unavailable');
    return result.rows[0]??null;
  };
  return Object.freeze({
    async reserve(contract){
      const c=validate(contract,iso(now()));
      const params=FIELDS.map(key=>c[key]);
      const result=await db.query(`INSERT INTO brain_continuum_outbox
        (task_id,objective_id,delivery_id,idempotency_key,repository,
         source_sha,authority_sha,request_sha,lease_generation,
         expires_at,effect,max_paid_cents)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11,$12)
        ON CONFLICT DO NOTHING
        RETURNING delivery_id AS "deliveryId",state`,params);
      if(result?.rows?.length===1){
        if(result.rows[0].deliveryId!==c.deliveryId||
          result.rows[0].state!=='pending')
          throw Error('continuum-outbox-admission-readback-mismatch');
        // The INSERT result is not enough to attest durable identity or
        // authorization. Read the stored row back before acknowledging a
        // new reservation, just as uncertain transition recovery does.
        const confirmed=await lookup(c.deliveryId);
        if(!confirmed||confirmed.deliveryId!==c.deliveryId||
          !same(confirmed,c)||confirmed.state!=='pending')
          throw Error('continuum-outbox-admission-readback-mismatch');
        return {created:true,deliveryId:c.deliveryId,state:'pending'};
      }
      if(result?.rows?.length!==0)throw Error('continuum-outbox-admission-unavailable');
      const existing=await lookup(c.deliveryId);
      if(!existing||!same(existing,c))
        throw Error('continuum-outbox-delivery-conflict');
      return {created:false,deliveryId:c.deliveryId,state:existing.state};
    },
    async observe({deliveryId}={}){
      if(typeof deliveryId!=='string'||!IDENTIFIER.test(deliveryId))
        throw Error('continuum-outbox-delivery-invalid');
      return lookup(deliveryId);
    },
    async markUnknown({deliveryId,sourceSha,leaseGeneration}={}){
      if(typeof deliveryId!=='string'||!IDENTIFIER.test(deliveryId)||
        !SHA.test(sourceSha||'')||
        !Number.isSafeInteger(leaseGeneration)||leaseGeneration<1)
        throw Error('continuum-outbox-fence-or-source-conflict');
      const updated=await db.query(`UPDATE brain_continuum_outbox
        SET state='reconcile-required',updated_at=now()
        WHERE delivery_id=$1 AND source_sha=$2 AND lease_generation=$3
          AND state='pending'
        RETURNING delivery_id AS "deliveryId",state`,
      [deliveryId,sourceSha,leaseGeneration]);
      if(updated?.rows?.length===1){
        // A successful SQL response is not an independently reconciled
        // transition until both the returned identity and fresh persisted
        // readback agree with the exact delivery/source/fencing contract.
        const returned=updated.rows[0];
        if(returned?.deliveryId!==deliveryId||
          returned?.state!=='reconcile-required')
          throw Error('continuum-outbox-transition-readback-mismatch');
        const confirmed=await lookup(deliveryId);
        if(!confirmed||confirmed.deliveryId!==deliveryId||
          confirmed.sourceSha!==sourceSha||
          Number(confirmed.leaseGeneration)!==leaseGeneration||
          confirmed.state!=='reconcile-required')
          throw Error('continuum-outbox-transition-readback-mismatch');
        return {changed:true,deliveryId,state:'reconcile-required'};
      }
      if(updated?.rows?.length!==0)
        throw Error('continuum-outbox-transition-unavailable');
      const current=await lookup(deliveryId);
      // A no-op CAS still needs the same delivery identity as its SELECT key.
      // An adapter returning a foreign row must not certify reconciliation.
      if(current&&current.deliveryId!==deliveryId)
        throw Error('continuum-outbox-transition-readback-mismatch');
      if(!current||current.sourceSha!==sourceSha||
        Number(current.leaseGeneration)!==leaseGeneration||
        current.state!=='reconcile-required')
        throw Error('continuum-outbox-fence-or-source-conflict');
      return {changed:false,deliveryId,state:'reconcile-required'};
    }
  });
}
