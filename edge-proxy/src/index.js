/**
 * UUAM staging ingress + delivery Worker. Source-only until Hatchable exposes
 * the verified /api/brain/uuam-inbox contract and the operator enables routing.
 *
 * Trust boundaries:
 * 1. Signed custom ingress HMAC over timestamp + EXACT request bytes
 * 2. Cloudflare Queue (at-least-once delivery)
 * 3. Distinct HMAC for HTTPS forwarding to Hatchable
 * 4. Hatchable independently verifies signature, nonce, grant and idempotency
 * 5. Only a durable, identity-matched PostgreSQL receipt permits queue ACK.
 *
 * Not a GitHub webhook verifier, standalone authorization service or executor.
 * No node:crypto dependency; Cloudflare Workers WebCrypto only.
 */
const te=new TextEncoder();
const MAX_BODY_BYTES=65536;
const MAX_AGE_SECONDS=300;
const EDGE_SCHEMA='ultron.uuam.edge.v1';
const INGEST_SCHEMA='ultron.uuam.ingress.v1';
const REPOSITORY='michaeljwilliams0123/Ultron.MW';
const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const INBOX_PATH='/api/brain/uuam-inbox';
const HEX64=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{32,64}$/;
const ID=/^[a-zA-Z0-9._:-]{1,128}$/;
const TASK=/^ultron-task-[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/;
const REQUIRED=['schema','source','deliveryId','taskKey','operationDigest',
  'githubIdempotencyKey','nonce','payload'];

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
}
function configured(env){
  return env?.ENVIRONMENT==='staging'&&
    env?.REPOSITORY===REPOSITORY&&
    env?.HATCHABLE_CORE_ORIGIN===ORIGIN&&
    env?.HATCHABLE_INBOX_ENABLED==='true'&&
    typeof env?.ULTRON_INGRESS_HMAC_KEY==='string'&&
    env.ULTRON_INGRESS_HMAC_KEY.length>=32&&
    typeof env?.HATCHABLE_DELIVERY_HMAC_KEY==='string'&&
    env.HATCHABLE_DELIVERY_HMAC_KEY.length>=32&&
    env.HATCHABLE_DELIVERY_HMAC_KEY!==env.ULTRON_INGRESS_HMAC_KEY;
}
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>
  b.toString(16).padStart(2,'0')).join('');
const bytesFromHex=value=>Uint8Array.from(
  value.match(/../g).map(x=>parseInt(x,16)));
function signedBytes(timestamp,rawBytes){
  const prefix=te.encode(timestamp+'.');
  const result=new Uint8Array(prefix.length+rawBytes.length);
  result.set(prefix);
  result.set(rawBytes,prefix.length);
  return result;
}
async function keyFor(secret,usages){
  return crypto.subtle.importKey('raw',te.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,usages);
}
async function checkSignature(rawBytes,headers,secret){
  const timestamp=headers.get('x-ultron-timestamp');
  const signature=headers.get('x-ultron-signature');
  if(!/^[0-9]{10}$/.test(timestamp||'')||
     !/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;
  const issued=Number(timestamp);
  if(!Number.isSafeInteger(issued)||
     Math.abs(Math.floor(Date.now()/1000)-issued)>MAX_AGE_SECONDS)return false;
  try{
    return crypto.subtle.verify('HMAC',await keyFor(secret,['verify']),
      bytesFromHex(signature.slice(7)),signedBytes(timestamp,rawBytes));
  }catch{
    return false;
  }
}
async function signForward(rawBody,secret,timestamp){
  const signed=await crypto.subtle.sign('HMAC',
    await keyFor(secret,['sign']),signedBytes(timestamp,te.encode(rawBody)));
  return 'sha256='+hex(signed);
}
function validEvent(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===REQUIRED.length&&
    REQUIRED.every(k=>Object.hasOwn(value,k))&&
    value.schema===INGEST_SCHEMA&&
    ID.test(value.source||'')&&ID.test(value.deliveryId||'')&&
    ID.test(value.taskKey||'')&&HEX64.test(value.operationDigest||'')&&
    TASK.test(value.githubIdempotencyKey||'')&&
    NONCE.test(value.nonce||'')&&
    value.payload!==null&&typeof value.payload==='object'&&
    !Array.isArray(value.payload);
}
function validQueued(data){
  return data!==null&&typeof data==='object'&&
    data.schema===EDGE_SCHEMA&&
    ID.test(data.source||'')&&ID.test(data.deliveryId||'')&&
    ID.test(data.taskKey||'')&&
    HEX64.test(data.operationDigest||'')&&
    HEX64.test(data.rawSha256||'')&&
    TASK.test(data.githubIdempotencyKey||'')&&
    NONCE.test(data.nonce||'')&&
    typeof data.rawBody==='string'&&
    te.encode(data.rawBody).length<=MAX_BODY_BYTES;
}

/**
 * Only an already-deployed, explicitly accepted receiver enables the ingest
 * endpoint. The Worker is NOT a way to bypass owner/Council authorization.
 */
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/healthz'&&request.method==='GET')
      return json({service:'uuam-edge-staging',status:'available',
        accepting:configured(env)&&
          typeof env?.ULTRON_EVENT_QUEUE?.send==='function'});
    if(url.pathname!=='/ingress')return json({error:'not_found'},404);
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    if(!configured(env)||typeof env.ULTRON_EVENT_QUEUE?.send!=='function')
      return json({error:'receiver_not_ready'},503);
    if(!/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('content-type')||''))
      return json({error:'unsupported_media_type'},415);
    const declared=Number(request.headers.get('content-length')||0);
    if(!Number.isFinite(declared)||declared>MAX_BODY_BYTES)
      return json({error:'payload_too_large'},413);
    let rawBytes,rawBody,body;
    try{
      rawBytes=new Uint8Array(await request.arrayBuffer());
      if(!rawBytes.length)return json({error:'empty_payload'},400);
      if(rawBytes.length>MAX_BODY_BYTES)
        return json({error:'payload_too_large'},413);
      // A fatal decoder preserves the exact UTF-8 content signed by the caller.
      rawBody=new TextDecoder('utf-8',{fatal:true}).decode(rawBytes);
    }catch{
      return json({error:'invalid_encoding'},400);
    }
    if(!await checkSignature(rawBytes,request.headers,
      env.ULTRON_INGRESS_HMAC_KEY))
      return json({error:'signature_invalid'},401);
    try{body=JSON.parse(rawBody);}
    catch{return json({error:'invalid_json'},400);}
    if(!validEvent(body))return json({error:'invalid_event'},400);
    const rawSha256=hex(await crypto.subtle.digest('SHA-256',rawBytes));
    const queued={
      schema:EDGE_SCHEMA,source:body.source,deliveryId:body.deliveryId,
      taskKey:body.taskKey,operationDigest:body.operationDigest,
      githubIdempotencyKey:body.githubIdempotencyKey,nonce:body.nonce,
      rawBody,rawSha256,queuedAt:Date.now()
    };
    try{await env.ULTRON_EVENT_QUEUE.send(queued);}
    catch{return json({error:'queue_unavailable'},503);}
    return json({status:'queued',deliveryId:queued.deliveryId},202);
  },

  async queue(batch,env){
    for(const message of batch.messages){
      await forwardMessage(message,env,fetch);
    }
  }
};

function retry(message){
  // Cloudflare applies max_retries and dead_letter_queue from Wrangler.
  // Do not ACK on network failure, missing receipt or unconfigured secrets.
  message.retry();
}
async function quarantine(message,env,status,reason){
  try{
    if(typeof env?.ULTRON_DEAD_LETTER_QUEUE?.send!=='function')
      throw Error('dlq_unconfigured');
    await env.ULTRON_DEAD_LETTER_QUEUE.send({
      schema:'ultron.uuam.dead-letter.v1',event:message.body,
      sourceMessageId:message.id,reason,httpStatus:status,
      quarantinedAt:Date.now()
    });
    // An ACK is safe only after the separate DLQ admission succeeded.
    message.ack();
  }catch{
    retry(message);
  }
}

/** Exported for deterministic test injection; queue() passes Workers fetch. */
export async function forwardMessage(message,env,fetchImpl=fetch){
  const eventData=message?.body;
  if(!validQueued(eventData)){
    await quarantine(message,env,422,'invalid_queue_envelope');
    return;
  }
  if(!configured(env)){
    retry(message);
    return;
  }
  const rebuiltHash=hex(await crypto.subtle.digest('SHA-256',
    te.encode(eventData.rawBody)));
  if(rebuiltHash!==eventData.rawSha256){
    await quarantine(message,env,422,'queue_payload_digest_mismatch');
    return;
  }
  let original;
  try{original=JSON.parse(eventData.rawBody);}
  catch{
    await quarantine(message,env,422,'invalid_raw_body');
    return;
  }
  if(!validEvent(original)||original.deliveryId!==eventData.deliveryId||
     original.source!==eventData.source||
     original.taskKey!==eventData.taskKey||
     original.nonce!==eventData.nonce||
     original.operationDigest!==eventData.operationDigest||
     original.githubIdempotencyKey!==eventData.githubIdempotencyKey){
    await quarantine(message,env,422,'unbound_queued_event');
    return;
  }

  const serialized=JSON.stringify(eventData);
  const timestamp=String(Math.floor(Date.now()/1000));
  try{
    const signature=await signForward(serialized,
      env.HATCHABLE_DELIVERY_HMAC_KEY,timestamp);
    const response=await fetchImpl(ORIGIN+INBOX_PATH,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Ultron-Environment':'staging',
        'X-Ultron-Timestamp':timestamp,
        'X-Ultron-Signature':signature,
        'X-Ultron-Delivery-Id':eventData.deliveryId
      },
      body:serialized
    });
    if([400,401,403,404,409,410,422].includes(response.status)){
      await quarantine(message,env,response.status,'hatchable_terminal_response');
      return;
    }
    if(response.status!==200&&response.status!==201){
      retry(message);return;
    }
    let receipt;
    try{receipt=await response.json();}
    catch{retry(message);return;}
    if(!receipt||
       !['persisted','already_persisted'].includes(receipt.status)||
       receipt.deliveryId!==eventData.deliveryId||
       receipt.payloadSha256!==eventData.rawSha256){
      retry(message);return;
    }
    // 202 Accepted is deliberately insufficient; only committed DB readback
    // represented by a 200/201 exact-match receipt can acknowledge delivery.
    message.ack();
  }catch{
    retry(message);
  }
}
