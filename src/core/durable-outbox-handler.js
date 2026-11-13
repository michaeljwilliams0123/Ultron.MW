/**
 * UUAM state projection for a verified signed inbox + existing GitHub write ledger.
 * No Cloudflare Queue is provisioned here; its consumer must authenticate ingress.
 * This class never issues a GitHub token or performs provider writes.
 */
import {createHash} from 'node:crypto';

const HEX=/^[a-f0-9]{64}$/;
const TASK=/^ultron-task-[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/;
const ID=/^[a-zA-Z0-9._:-]{1,128}$/;

function fail(message){throw Error('UUAM: '+message);}
function rows(result){return result?.rows||[];}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}

export class DurableOutboxHandler {
  #db;
  #council;
  #verifyIngress;
  #verifyOwnerGrant;
  #verifyRemote;

  constructor({db,councilVerifier,verifyIngress,verifyOwnerGrant,verifyRemote}={}){
    if(typeof db?.query!=='function'&&typeof db?.connect!=='function')
      fail('database required');
    if(typeof councilVerifier?.verifyConsensus!=='function'||
       typeof verifyIngress!=='function'||
       typeof verifyOwnerGrant!=='function'||
       typeof verifyRemote!=='function')
      fail('trusted verification adapters required');
    this.#db=db;
    this.#council=councilVerifier;
    this.#verifyIngress=verifyIngress;
    this.#verifyOwnerGrant=verifyOwnerGrant;
    this.#verifyRemote=verifyRemote;
  }
  async #tx(fn){
    const client=typeof this.#db.connect==='function'?
      await this.#db.connect():this.#db;
    await client.query('BEGIN');
    try{
      const value=await fn(client);
      await client.query('COMMIT');
      return value;
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }finally{
      if(typeof client.release==='function')client.release();
    }
  }

  /** Verify raw ingress before persisting; bind duplicate IDs to exact bytes. */
  async ingestEvent({source,deliveryId,taskKey,rawBody,operationDigest,
    githubIdempotencyKey,nonce,signatureHeaders}={}){
    if(!ID.test(source||'')||!ID.test(deliveryId||'')||
       !ID.test(taskKey||'')||!HEX.test(operationDigest||'')||
       !TASK.test(githubIdempotencyKey||'')||
       !/^[a-f0-9]{32,64}$/.test(nonce||'')||
       !Buffer.isBuffer(rawBody)||rawBody.length<1||
       rawBody.length>1048576)
      fail('invalid event envelope');
    // This callback MUST validate the signature against original rawBody.
    if(await this.#verifyIngress({source,deliveryId,taskKey,
      rawBody,signatureHeaders})!==true)
      fail('ingress signature rejected');
    const payloadHash=digest(rawBody);
    return this.#tx(async db=>{
      const inserted=await db.query(
        'INSERT INTO brain_signed_inbox(source,delivery_id,task_key,payload_sha256) '+
        'VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
        [source,deliveryId,taskKey,payloadHash]);
      const inbox=await db.query(
        'SELECT id,task_key,payload_sha256 FROM brain_signed_inbox '+
        'WHERE source=$1 AND delivery_id=$2 FOR UPDATE',
        [source,deliveryId]);
      const row=rows(inbox)[0];
      if(!row||row.task_key!==taskKey||row.payload_sha256!==payloadHash)
        fail('conflicting delivery identity or payload');
      await db.query(
        'INSERT INTO brain_omni_execution_state'+
        '(inbox_id,operation_digest,github_idempotency_key,ingress_nonce) '+
        'VALUES($1,$2,$3,$4) ON CONFLICT(inbox_id) DO NOTHING',
        [row.id,operationDigest,githubIdempotencyKey,nonce]);
      const projection=rows(await db.query(
        'SELECT inbox_id,operation_digest,github_idempotency_key,ingress_nonce,state '+
        'FROM brain_omni_execution_state WHERE inbox_id=$1 FOR UPDATE',
        [row.id]))[0];
      if(!projection||projection.operation_digest!==operationDigest||
         projection.github_idempotency_key!==githubIdempotencyKey||
         projection.ingress_nonce!==nonce)
        fail('conflicting idempotency, nonce or operation digest');
      return Object.freeze({inboxId:Number(row.id),
        state:projection.state,reused:rows(inserted).length===0});
    });
  }

  /**
   * Record approval evidence ONLY after the external owner-grant verifier
   * and all seven registered Council attestations independently pass.
   */
  async authorizeEvent({inboxId,intent,signatures,ownerGrantEnvelope}={}){
    if(!Number.isSafeInteger(inboxId)||inboxId<1||
       !this.#council.verifyConsensus(intent,signatures))
      fail('Council attestation rejected');
    const grant=await this.#verifyOwnerGrant({inboxId,intent,
      ownerGrantEnvelope});
    if(!grant||grant.authorized!==true||
       typeof grant.grantId!=='string'||
       grant.grantHash!==intent.ownerGrantHash)
      fail('owner grant not independently verified');
    const signaturesHash=digest(Buffer.from(JSON.stringify({
      intent,signatures:[...signatures].sort((a,b)=>
        String(a.signerId).localeCompare(String(b.signerId)))
    })));
    return this.#tx(async db=>{
      const item=rows(await db.query(
        'SELECT operation_digest,state FROM brain_omni_execution_state '+
        'WHERE inbox_id=$1 FOR UPDATE',[inboxId]))[0];
      if(!item||item.state!=='PERSISTED'||
         item.operation_digest!==intent.planDigest)
        fail('authorization state or plan mismatch');
      const changed=await db.query(
        "UPDATE brain_omni_execution_state SET state='AUTHORIZED',"+
        'owner_grant_id=$2,council_attestation_sha256=$3 '+
        "WHERE inbox_id=$1 AND state='PERSISTED' RETURNING inbox_id",
        [inboxId,grant.grantId,signaturesHash]);
      if(rows(changed).length!==1)fail('authorization transition lost');
      return Object.freeze({inboxId,state:'AUTHORIZED'});
    });
  }

  /** Reserve a leased dispatch; actual GitHub writes use the existing executor. */
  async markDispatched(inboxId,{leaseOwner,leaseExpiresAt}={}){
    if(!Number.isSafeInteger(inboxId)||inboxId<1||
       !ID.test(leaseOwner||'')||leaseOwner.length<8||
       !(leaseExpiresAt instanceof Date)||leaseExpiresAt<=new Date())
      fail('invalid dispatch lease');
    const result=await this.#db.query(
      "UPDATE brain_omni_execution_state SET state='DISPATCHED',"+
      'lease_owner=$2,lease_expires_at=$3 '+
      "WHERE inbox_id=$1 AND state='AUTHORIZED' RETURNING inbox_id",
      [inboxId,leaseOwner,leaseExpiresAt]);
    if(rows(result).length!==1)fail('dispatch state denied');
    return {inboxId,state:'DISPATCHED'};
  }

  /** Ambiguous provider outcomes are reconciled, never blind-retried. */
  async markReconcileRequired(inboxId){
    const result=await this.#db.query(
      "UPDATE brain_omni_execution_state SET state='RECONCILE_REQUIRED',"+
      'retry_count=retry_count+1 '+
      "WHERE inbox_id=$1 AND state='DISPATCHED' AND retry_count<20 "+
      'RETURNING inbox_id',[inboxId]);
    if(rows(result).length!==1)fail('reconciliation transition denied');
    return {inboxId,state:'RECONCILE_REQUIRED'};
  }

  /** Require trusted remote readback AND completed existing ledger receipt. */
  async markVerified(inboxId){
    if(!Number.isSafeInteger(inboxId)||inboxId<1)
      fail('invalid inbox id');
    if(await this.#verifyRemote({inboxId})!==true)
      fail('independent remote readback missing');
    const changed=await this.#db.query(
      "UPDATE brain_omni_execution_state SET state='VERIFIED',"+
      'verified_at=clock_timestamp() '+
      "WHERE inbox_id=$1 AND state IN ('DISPATCHED','RECONCILE_REQUIRED') "+
      'RETURNING inbox_id',[inboxId]);
    if(rows(changed).length!==1)fail('verification transition denied');
    return {inboxId,state:'VERIFIED'};
  }
}
