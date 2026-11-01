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
// PostgreSQL bigint may arrive as a decimal string. Never use Number() on
// arbitrary readback values: false, null, empty strings and arrays can
// otherwise masquerade as the authorized zero-cost or fencing integer.
function persistedInteger(value){
  if(typeof value==='number')
    return Number.isSafeInteger(value)?value:NaN;
  if(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)){
    const parsed=Number(value);
    return Number.isSafeInteger(parsed)?parsed:NaN;
  }
  return NaN;
}
function same(existing,expected){
  return FIELDS.every(key=>{
    const actual=key==='expiresAt'?iso(existing[key]):
      ['taskId','leaseGeneration','maxPaidCents'].includes(key)?
        persistedInteger(existing[key]):existing[key];
    return actual===expected[key];
  });
}
// A malformed adapter readback is a persisted-state mismatch, not invalid
// caller input. Preserve the stable conflict/hold disposition after a write.
function matchesPersisted(row,expected){
  try {return same(row,expected);}
  catch {return false;}
}
// A malformed or missing timestamp from an adapter cannot attest the
// persisted immutable expiry, even when the fencing CAS itself succeeded.
// Accept native PostgreSQL Date values and ordinary ISO/SQL date strings.
function validPersistedExpiry(value){
  if(value instanceof Date)return Number.isFinite(value.getTime());
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}[T ]/.test(value)&&
    Number.isFinite(Date.parse(value));
}
function matchesTransitionReadback(row,{deliveryId,sourceSha,leaseGeneration}){
  return row?.deliveryId===deliveryId&&row.repository===REPO&&
    validPersistedExpiry(row.expiresAt)&&
    persistedInteger(row.taskId)>0&&
    typeof row.objectiveId==='string'&&IDENTIFIER.test(row.objectiveId)&&
    typeof row.idempotencyKey==='string'&&IDENTIFIER.test(row.idempotencyKey)&&
    typeof row.authoritySha==='string'&&DIGEST.test(row.authoritySha)&&
    typeof row.requestSha==='string'&&DIGEST.test(row.requestSha)&&
    row.sourceSha===sourceSha&&
    persistedInteger(row.leaseGeneration)===leaseGeneration&&
    persistedInteger(row.maxPaidCents)===0&&
    ['read','advisory'].includes(row.effect)&&
    row.state==='reconcile-required';
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
  // An acknowledged database write is still uncertain when its subsequent
  // authoritative SELECT cannot be read. Normalize the outcome so callers
  // must reconcile instead of interpreting a transport error as no commit.
  const readbackOrHold=async deliveryId=>{
    try {return await lookup(deliveryId);}
    catch {throw Error('continuum-outbox-reconcile-required');}
  };
  return Object.freeze({
    async reserve(contract){
      const c=validate(contract,iso(now()));
      const params=FIELDS.map(key=>c[key]);
      let result;
      try {
        result=await db.query(`INSERT INTO brain_continuum_outbox
          (task_id,objective_id,delivery_id,idempotency_key,repository,
           source_sha,authority_sha,request_sha,lease_generation,
           expires_at,effect,max_paid_cents)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11,$12)
          ON CONFLICT DO NOTHING
          RETURNING delivery_id AS "deliveryId",state`,params);
      } catch {
        // The INSERT may have committed before its acknowledgement was lost.
        // Repeating the write could create a duplicate or conceal conflict.
        // Verify the complete immutable contract through readback only.
        let confirmed;
        try {
          confirmed=await lookup(c.deliveryId);
          if(confirmed&&matchesPersisted(confirmed,c)&&confirmed.state==='pending')
            return {created:false,deliveryId:c.deliveryId,state:'pending',
              reconciled:true};
        } catch {
          // Readback failure or malformed stored fields remain unresolved.
        }
        throw Error('continuum-outbox-reconcile-required');
      }
      if(result?.rows?.length===1){
        if(result.rows[0].deliveryId!==c.deliveryId||
          result.rows[0].state!=='pending')
          throw Error('continuum-outbox-admission-readback-mismatch');
        // The INSERT result is not enough to attest durable identity or
        // authorization. Read the stored row back before acknowledging a
        // new reservation, just as uncertain transition recovery does.
        const confirmed=await readbackOrHold(c.deliveryId);
        if(!confirmed||confirmed.deliveryId!==c.deliveryId||
          !matchesPersisted(confirmed,c)||confirmed.state!=='pending')
          throw Error('continuum-outbox-admission-readback-mismatch');
        return {created:true,deliveryId:c.deliveryId,state:'pending'};
      }
      if(result?.rows?.length!==0)throw Error('continuum-outbox-admission-unavailable');
      const existing=await readbackOrHold(c.deliveryId);
      if(!existing||!matchesPersisted(existing,c)||
        !['pending','reconcile-required'].includes(existing.state))
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
      let updated;
      try {
        updated=await db.query(`UPDATE brain_continuum_outbox
          SET state='reconcile-required',updated_at=now()
          WHERE delivery_id=$1 AND source_sha=$2 AND lease_generation=$3
            AND state='pending'
          RETURNING delivery_id AS "deliveryId",state`,
        [deliveryId,sourceSha,leaseGeneration]);
      } catch {
        // A lost database response cannot prove that the CAS did not commit.
        // Perform readback ONLY; never repeat the uncertain UPDATE.
        let current;
        try {current=await lookup(deliveryId);}
        catch {throw Error('continuum-outbox-reconcile-required');}
        if(matchesTransitionReadback(current,{deliveryId,sourceSha,leaseGeneration}))
          return {changed:false,deliveryId,state:'reconcile-required',reconciled:true};
        // Pending, missing, or contradictory readback cannot establish the
        // outcome. The caller must reconcile rather than blindly retry.
        throw Error('continuum-outbox-reconcile-required');
      }
      if(updated?.rows?.length===1){
        // A successful SQL response is not an independently reconciled
        // transition until both the returned identity and fresh persisted
        // readback agree with the exact delivery/source/fencing contract.
        const returned=updated.rows[0];
        if(returned?.deliveryId!==deliveryId||
          returned?.state!=='reconcile-required')
          throw Error('continuum-outbox-transition-readback-mismatch');
        const confirmed=await readbackOrHold(deliveryId);
        if(!matchesTransitionReadback(confirmed,{deliveryId,sourceSha,leaseGeneration}))
          throw Error('continuum-outbox-transition-readback-mismatch');
        return {changed:true,deliveryId,state:'reconcile-required'};
      }
      if(updated?.rows?.length!==0)
        throw Error('continuum-outbox-transition-unavailable');
      const current=await readbackOrHold(deliveryId);
      // A no-op CAS still needs the same delivery identity as its SELECT key.
      // An adapter returning a foreign row must not certify reconciliation.
      if(current&&current.deliveryId!==deliveryId)
        throw Error('continuum-outbox-transition-readback-mismatch');
      if(!matchesTransitionReadback(current,{deliveryId,sourceSha,leaseGeneration}))
        throw Error('continuum-outbox-fence-or-source-conflict');
      return {changed:false,deliveryId,state:'reconcile-required'};
    }
  });
}
