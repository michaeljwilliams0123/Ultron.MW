/**
 * Cloudflare -> Hatchable UUAM v1 staging inbox.
 * Pure helper: no SDK imports. Authority is limited to signed event admission.
 * It never verifies owner grants, changes authorization state, or executes GitHub writes.
 */
const VERIFIED=new WeakSet();
const encoder=new TextEncoder();
const DIGEST=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{32,64}$/;
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const TASK=/^ultron-task-[A-Za-z0-9][A-Za-z0-9_-]{0,90}$/;
const SIGNATURE=/^sha256=([a-f0-9]{64})$/;
const REPO='michaeljwilliams0123/Ultron.MW';
const EDGE_KEYS=['schema','source','deliveryId','taskKey','operationDigest',
  'githubIdempotencyKey','nonce','rawBody','rawSha256','queuedAt'];
const ORIGINAL_KEYS=['schema','source','deliveryId','taskKey',
  'operationDigest','githubIdempotencyKey','nonce','payload'];
const MAX_BYTES=65536;
function error(message){throw Error('uuam-inbox-'+message);}
function exact(v,fields){
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&
   Object.keys(v).length===fields.length&&
   fields.every(f=>Object.hasOwn(v,f));
}
function toHex(b){return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}
function fromHex(v){return Uint8Array.from(v.match(/../g),x=>parseInt(x,16));}
function validEvent(v){
 return exact(v,ORIGINAL_KEYS)&&v.schema==='ultron.uuam.ingress.v1'&&
   v.source==='ultron-staging'&&ID.test(v.deliveryId||'')&&
   ID.test(v.taskKey||'')&&DIGEST.test(v.operationDigest||'')&&
   TASK.test(v.githubIdempotencyKey||'')&&NONCE.test(v.nonce||'')&&
   v.payload!==null&&typeof v.payload==='object'&&!Array.isArray(v.payload);
}
function validEnvelope(v,now){
 return exact(v,EDGE_KEYS)&&v.schema==='ultron.uuam.edge.v1'&&
   v.source==='ultron-staging'&&ID.test(v.deliveryId||'')&&
   ID.test(v.taskKey||'')&&DIGEST.test(v.operationDigest||'')&&
   TASK.test(v.githubIdempotencyKey||'')&&NONCE.test(v.nonce||'')&&
   DIGEST.test(v.rawSha256||'')&&typeof v.rawBody==='string'&&
   encoder.encode(v.rawBody).length>=1&&encoder.encode(v.rawBody).length<=MAX_BYTES&&
   Number.isSafeInteger(v.queuedAt)&&v.queuedAt>0&&v.queuedAt<=now+60000;
}
export async function verifyUuamDelivery({
 raw,timestamp,signature,secret,subtle=globalThis.crypto?.subtle,now=Date.now()
}={}){
 if(typeof secret!=='string'||encoder.encode(secret).length<32||!subtle)
   error('authentication-unconfigured');
 if(typeof raw!=='string'||encoder.encode(raw).length<20||
    encoder.encode(raw).length>MAX_BYTES+4096)error('invalid');
 if(typeof timestamp!=='string'||!/^[0-9]{10}$/.test(timestamp)||
    !Number.isSafeInteger(now)||Math.abs(now-Number(timestamp)*1000)>300000)
   error('timestamp-invalid');
 const m=typeof signature==='string'?signature.match(SIGNATURE):null;
 if(!m)error('signature-invalid');
 let valid=false;
 try{
   const key=await subtle.importKey('raw',encoder.encode(secret),
     {name:'HMAC',hash:'SHA-256'},false,['verify']);
   valid=await subtle.verify('HMAC',key,fromHex(m[1]),
     encoder.encode(timestamp+'.'+raw));
 }catch{error('signature-invalid');}
 if(!valid)error('signature-invalid');
 let envelope,original;
 try{
   envelope=JSON.parse(raw);
   if(!validEnvelope(envelope,now))error('invalid');
   original=JSON.parse(envelope.rawBody);
   if(!validEvent(original))error('invalid');
 }catch{error('invalid');}
 const actual=toHex(await subtle.digest('SHA-256',encoder.encode(envelope.rawBody)));
 if(actual!==envelope.rawSha256)error('digest-mismatch');
 for(const name of ['source','deliveryId','taskKey','operationDigest',
     'githubIdempotencyKey','nonce']){
   if(envelope[name]!==original[name])error('identity-mismatch');
 }
 const trusted=Object.freeze({
   source:envelope.source,deliveryId:envelope.deliveryId,
   taskKey:envelope.taskKey,payloadSha256:actual,
   operationDigest:envelope.operationDigest,
   githubIdempotencyKey:envelope.githubIdempotencyKey,
   nonce:envelope.nonce,repository:REPO
 });
 VERIFIED.add(trusted);
 return trusted;
}

/**
 * Transactional two-table admission on Hatchable's own db.transaction API.
 * Never use BEGIN/COMMIT with separate pooled db.query calls.
 * A separate exact-row SELECT independently verifies post-commit state.
 */
export async function persistUuamDelivery({db,delivery}={}){
 if(!VERIFIED.has(delivery))error('unverified');
 if(typeof db?.transaction!=='function'||typeof db?.query!=='function')
   error('database-unavailable');
 const params=[delivery.source,delivery.deliveryId,delivery.taskKey,
   delivery.payloadSha256,delivery.operationDigest,
   delivery.githubIdempotencyKey,delivery.nonce];
 let inserted=false;
 try{
   const result=await db.transaction([
     {
       sql:'INSERT INTO brain_signed_inbox '+
         '(source,delivery_id,task_key,payload_sha256) '+
         'VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
       params:params.slice(0,4)
     },
     {
       sql:'INSERT INTO brain_omni_execution_state '+
         '(inbox_id,operation_digest,github_idempotency_key,ingress_nonce) '+
         'SELECT id,$5,$6,$7 FROM brain_signed_inbox '+
         'WHERE source=$1 AND delivery_id=$2 '+
         'AND task_key=$3 AND payload_sha256=$4 '+
         'ON CONFLICT(inbox_id) DO NOTHING',
       params
     }
   ]);
   inserted=result?.results?.[0]?.rowCount===1;
 }catch(e){
   if(e?.code==='23505'||/duplicate key|unique constraint|unique_violation/i.test(
       String(e?.message||'')))error('conflict');
   error('database-unavailable');
 }
 let observed;
 try{
   const result=await db.query(
     'SELECT i.source,i.delivery_id AS "deliveryId", '+
       'i.task_key AS "taskKey",i.payload_sha256 AS "payloadSha256", '+
       'o.operation_digest AS "operationDigest", '+
       'o.github_idempotency_key AS "githubIdempotencyKey", '+
       'o.ingress_nonce AS nonce,o.state '+
     'FROM brain_signed_inbox i '+
     'LEFT JOIN brain_omni_execution_state o ON o.inbox_id=i.id '+
     'WHERE i.source=$1 AND i.delivery_id=$2',
      [delivery.source,delivery.deliveryId]);
   if(!Array.isArray(result?.rows)||result.rows.length!==1||!result.rows[0])
     error('write-uncertain');
   observed=result.rows[0];
 }catch{error('write-uncertain');}
 if(observed.source!==delivery.source||
    observed.deliveryId!==delivery.deliveryId||
    observed.taskKey!==delivery.taskKey||
    observed.payloadSha256!==delivery.payloadSha256||
    observed.operationDigest!==delivery.operationDigest||
    observed.githubIdempotencyKey!==delivery.githubIdempotencyKey||
    observed.nonce!==delivery.nonce){
   error('conflict');
 }
 if(!['PERSISTED','AUTHORIZED','DISPATCHED','RECONCILE_REQUIRED',
     'VERIFIED','FAILED_TERMINAL'].includes(observed.state))
   error('write-uncertain');
 // "persisted" never means authorized or executed.
 return Object.freeze({
   status:inserted?'persisted':'already_persisted',
   deliveryId:delivery.deliveryId,
   payloadSha256:delivery.payloadSha256
 });
}
