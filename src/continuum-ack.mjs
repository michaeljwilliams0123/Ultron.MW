/** C03: authenticated bridge ACK admission, not external Work completion.
 * The signing secret must be held by a separately authorized receiver/worker,
 * NOT shared with the GitHub event bridge or the Ultron owner UI.
 * No credential enrollment, provider dispatch or production integration here.
 */
const TRUSTED=new WeakSet();
const ID=/^[a-z0-9][a-z0-9_.:-]{11,127}$/i;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SIG=/^sha256=([a-f0-9]{64})$/;
const SOURCES=new Set(['destiny-work','mahoraga-cloud']);
const encoder=new TextEncoder();
function reject(why){throw Error(why);}
function fromHex(hex){return Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));}
function toHex(bytes){return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}

export async function verifyContinuumAck({
 raw,timestamp,signature,secret,now=Date.now(),subtle=globalThis.crypto?.subtle
}={}){
 if(!subtle||typeof secret!=='string'||encoder.encode(secret).length<32)
   reject('continuum-ack-authentication-unconfigured');
 if(typeof raw!=='string'||raw.length<40||raw.length>20000)
   reject('continuum-ack-invalid');
 if(typeof timestamp!=='string'||!/^[0-9]{10,11}$/.test(timestamp)||
   !Number.isFinite(now)||Math.abs(now-Number(timestamp)*1000)>300000)
   reject('continuum-ack-timestamp-expired');
 const match=typeof signature==='string'?signature.match(SIG):null;
 if(!match)reject('continuum-ack-signature-invalid');
 let ok=false;
 try{
   const key=await subtle.importKey('raw',encoder.encode(secret),
     {name:'HMAC',hash:'SHA-256'},false,['verify']);
   ok=await subtle.verify('HMAC',key,fromHex(match[1]),
     encoder.encode(timestamp+'.'+raw));
 }catch{reject('continuum-ack-signature-invalid');}
 if(!ok)reject('continuum-ack-signature-invalid');
 let item;
 try{item=JSON.parse(raw);}catch{reject('continuum-ack-invalid');}
 if(!item||typeof item!=='object'||Array.isArray(item)||
   item.schema!=='ultron.continuum-ack.v1'||!SOURCES.has(item.source)||
   typeof item.receiptId!=='string'||!ID.test(item.receiptId)||
   typeof item.deliveryId!=='string'||!ID.test(item.deliveryId)||
   !Number.isSafeInteger(item.taskId)||item.taskId<1||
   typeof item.sourceSha!=='string'||!SHA.test(item.sourceSha)||
   typeof item.requestSha!=='string'||!DIGEST.test(item.requestSha)||
   typeof item.authoritySha!=='string'||!DIGEST.test(item.authoritySha)||
   typeof item.routeSha!=='string'||!DIGEST.test(item.routeSha)||
   !Number.isSafeInteger(item.leaseGeneration)||item.leaseGeneration<1||
   item.status!=='acknowledged'||item.maxPaidCents!==0)
   reject('continuum-ack-invalid');
 const payloadSha=toHex(await subtle.digest('SHA-256',encoder.encode(raw)));
 const ack=Object.freeze({
   receiptId:item.receiptId,deliveryId:item.deliveryId,
   source:item.source,taskId:item.taskId,sourceSha:item.sourceSha,
   requestSha:item.requestSha,authoritySha:item.authoritySha,
   routeSha:item.routeSha,leaseGeneration:item.leaseGeneration,
   maxPaidCents:0,status:'acknowledged',payloadSha
 });
 TRUSTED.add(ack);
 return ack;
}

export async function recordContinuumAck({db,ack}={}){
 if(!TRUSTED.has(ack))reject('continuum-ack-unverified');
 if(typeof db?.query!=='function')reject('continuum-ack-db-required');
 // A single SQL statement binds the independently authenticated bridge ACK
 // to an existing immutable C01 outbox intent. No worker execution is inferred.
 const result=await db.query(\`INSERT INTO brain_continuum_receipts
   (receipt_id,delivery_id,source,payload_sha256,route_sha)
   SELECT $1,$2,$3,$4,$9 FROM brain_continuum_outbox o
   WHERE o.delivery_id=$2 AND o.task_id=$5
     AND o.source_sha=$6 AND o.request_sha=$7 AND o.authority_sha=$8
     AND o.lease_generation=$10 AND o.max_paid_cents=$11
     AND o.effect IN ('read','advisory')
     AND o.state IN ('pending','reconcile-required')
   ON CONFLICT DO NOTHING
   RETURNING receipt_id AS "receiptId",delivery_id AS "deliveryId"\`,
   [ack.receiptId,ack.deliveryId,ack.source,ack.payloadSha,ack.taskId,
    ack.sourceSha,ack.requestSha,ack.authoritySha,ack.routeSha,
    ack.leaseGeneration,ack.maxPaidCents]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1)
   reject('continuum-ack-write-uncertain');
 if(result.rows.length===1){
   const row=result.rows[0];
   if(row?.receiptId!==ack.receiptId||row?.deliveryId!==ack.deliveryId)
     reject('continuum-ack-write-uncertain');
 }
 // Explicit post-write observation: never repeat the INSERT on lost ACK.
 const observed=await db.query(\`SELECT receipt_id AS "receiptId",
   delivery_id AS "deliveryId",source,payload_sha256 AS "payloadSha",
   route_sha AS "routeSha" FROM brain_continuum_receipts WHERE delivery_id=$1\`,
   [ack.deliveryId]);
 if(!observed||!Array.isArray(observed.rows)||observed.rows.length!==1)
   reject('continuum-ack-write-uncertain');
 const stored=observed.rows[0];
 if(stored.receiptId!==ack.receiptId||stored.deliveryId!==ack.deliveryId||
   stored.source!==ack.source||stored.payloadSha!==ack.payloadSha||
   stored.routeSha!==ack.routeSha)
   reject('continuum-ack-conflict');
 return Object.freeze({accepted:true,created:result.rows.length===1,
   receiptId:ack.receiptId,verification:'bridge-authenticated-only'});
}
