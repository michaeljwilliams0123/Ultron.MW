/** Durable mutation lifecycle: durable reservation -> sent -> provider -> readback.
 * Unlike a DB transaction held across POST, a crash cannot erase the sent marker.
 * Inactive until owner passkey and C04 live canary are proven.
 */
const KEY=/^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const OPERATIONS=new Set(['pr.comment','repair.branch.create']);
const SHA=/^[a-f0-9]{64}$/;
const fail=msg=>{throw Error('durable-mutation-'+msg)};
const digest=async fields=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(JSON.stringify(fields))))).map(n=>n.toString(16).padStart(2,'0')).join('');
async function independentRead(fn,intent){
 try{
  const r=await fn(Object.freeze({...intent}));
  return r?.confirmed===true&&String(r.externalId||'').length>0&&SHA.test(r.hash||'')?r:null;
 }catch{return null}
}
async function complete(db,i,evidence){
 const receipt=Object.freeze({schema:'ultron.github.durable-mutation.v1',idempotencyKey:i.idempotencyKey,
  operationDigest:i.operationDigest,operationType:i.operationType,targetRef:i.targetRef,
  externalId:evidence.externalId,readbackHash:evidence.hash,verified:true});
 const x=await db.query('UPDATE brain_github_deep_mutations SET state=$2, receipt=$3::jsonb, updated_at=now() WHERE idempotency_key=$1 AND operation_digest=$4 AND state IN ($5,$6) RETURNING state',
  [i.idempotencyKey,'verified',JSON.stringify(receipt),i.operationDigest,'sent','reconcile_required']);
 if(x.rows.length!==1){
  // Another concurrent reconciler may have committed the same proven effect.
  const previous=await db.query('SELECT state,operation_digest,receipt FROM brain_github_deep_mutations WHERE idempotency_key=$1',[i.idempotencyKey]);
  const row=previous.rows[0];
  if(row?.state==='verified'&&row.operation_digest===i.operationDigest&&
   row.receipt?.externalId===evidence.externalId&&row.receipt?.readbackHash===evidence.hash)
   return Object.freeze({status:'verified',executed:false,externalId:evidence.externalId,receipt:row.receipt});
  fail('receipt-not-committed');
 }
 return Object.freeze({status:'verified',executed:true,externalId:evidence.externalId,receipt});
}
async function reconcile(db,i,readback){
 const observed=await independentRead(readback,i);
 if(observed)return complete(db,i,observed);
 await db.query('UPDATE brain_github_deep_mutations SET state=$2,updated_at=now() WHERE idempotency_key=$1 AND state=$3',
  [i.idempotencyKey,'reconcile_required','sent']);
 return Object.freeze({status:'reconcile-required',executed:false,idempotencyKey:i.idempotencyKey});
}
/** authorize/policyValidator are trusted adapters for the operation being executed. */
export async function executeDurableMutation({pgClient,idempotencyKey,ownerGrantId,operationType,
 targetRef,authorize,policyValidator,githubMutateFn,githubReadbackFn}={}){
 if(typeof pgClient?.query!=='function'||!KEY.test(idempotencyKey||'')||
  !KEY.test(ownerGrantId||'')||!OPERATIONS.has(operationType)||
  typeof targetRef!=='string'||targetRef.length<10||targetRef.length>512||
  typeof authorize!=='function'||typeof policyValidator!=='function'||
  typeof githubMutateFn!=='function'||typeof githubReadbackFn!=='function')fail('invalid-input');
 const proof=await authorize({ownerGrantId,operationType,targetRef,idempotencyKey});
 if(proof?.valid!==true||proof.grantId!==ownerGrantId||
  proof.operationType!==operationType||proof.targetRef!==targetRef)fail('grant-rejected');
 if(await policyValidator({authorization:proof,operationType,targetRef,idempotencyKey})!==true)
  fail('operation-policy-denied');
 const operationDigest=await digest([idempotencyKey,ownerGrantId,operationType,targetRef]);
 const i=Object.freeze({idempotencyKey,operationDigest,ownerGrantId,operationType,targetRef});
 const claim=await pgClient.query(
  'INSERT INTO brain_github_deep_mutations (idempotency_key,operation_digest,grant_id,operation_type,target_ref,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING RETURNING state',
  [idempotencyKey,operationDigest,ownerGrantId,operationType,targetRef,'reserved']);
 if(claim.rows.length===0){
  const existing=await pgClient.query('SELECT operation_digest,state,receipt FROM brain_github_deep_mutations WHERE idempotency_key=$1',[idempotencyKey]);
  const row=existing.rows[0];
  if(!row||row.operation_digest!==operationDigest)fail('idempotency-conflict');
  if(row.state==='verified')return Object.freeze({status:'verified',executed:false,
   externalId:row.receipt?.externalId||null,receipt:row.receipt});
  if(row.state==='reserved')return Object.freeze({status:'reconcile-required',executed:false,idempotencyKey});
  return reconcile(pgClient,i,githubReadbackFn);
 }
 // A single committed DB statement precedes the remote POST.
 const sent=await pgClient.query(
  'UPDATE brain_github_deep_mutations SET state=$2,updated_at=now() WHERE idempotency_key=$1 AND operation_digest=$3 AND state=$4 RETURNING idempotency_key',
  [idempotencyKey,'sent',operationDigest,'reserved']);
 if(sent.rows.length!==1)fail('reservation-lost');
 try{await githubMutateFn(Object.freeze({...i}));}catch{/* unknown provider outcome */}
 return reconcile(pgClient,i,githubReadbackFn);
}
