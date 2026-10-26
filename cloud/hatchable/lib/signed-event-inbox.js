// Signed event bridge admission, not a raw GitHub webhook translator.
// The gateway must provide the original signed UTF-8 event string verbatim.
// Untrusted events NEVER gain external write or administrative capabilities.
const TRUSTED=new WeakSet();
const ALLOWED=new Set(['repo.inspect','repo.prs','repo.ci','site.render','council.review']);
const SOURCES=new Set(['github-bridge','hatchable-bridge']);
const IDENTIFIER=/^[a-zA-Z0-9_.:-]{12,128}$/;
const SIGNATURE=/^sha256=([a-f0-9]{64})$/;
const FIVE_MINUTES=300000;
function reject(message){throw Error(message);}
function toHex(bytes){return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
function fromHex(s){return Uint8Array.from(s.match(/../g),x=>parseInt(x,16));}
export async function verifySignedEvent({
 raw,timestamp,signature,secret,now=Date.now(),
 subtle=globalThis.crypto?.subtle
}={}){
 if(!subtle||typeof secret!=='string'||new TextEncoder().encode(secret).length<32)
  reject('event-signing-configuration-unavailable');
 if(typeof raw!=='string'||raw.length<5||raw.length>100000)
  reject('event-payload-invalid');
 if(typeof timestamp!=='string'||!/^[0-9]{10,11}$/.test(timestamp)||
   !Number.isFinite(now)||Math.abs(now-Number(timestamp)*1000)>FIVE_MINUTES)
  reject('event-timestamp-expired');
 const match=typeof signature==='string'?signature.match(SIGNATURE):null;
 if(!match)reject('event-signature-invalid');
 let authenticated=false;
 try{
  const key=await subtle.importKey('raw',new TextEncoder().encode(secret),
   {name:'HMAC',hash:'SHA-256'},false,['verify']);
  authenticated=await subtle.verify('HMAC',key,fromHex(match[1]),
   new TextEncoder().encode(timestamp+'.'+raw));
 }catch{reject('event-signature-invalid');}
 if(!authenticated)reject('event-signature-invalid');
 let data;
 try{data=JSON.parse(raw);}catch{reject('event-payload-invalid');}
 if(!data||typeof data!=='object'||Array.isArray(data)||
  data.schema!=='ultron.signed-event.v1'||
  !SOURCES.has(data.source)||!IDENTIFIER.test(data.deliveryId||''))
  reject('event-payload-invalid');
 if(!ALLOWED.has(data.objective))reject('unsupported-event-objective');
 const digest=await subtle.digest('SHA-256',new TextEncoder().encode(raw));
 const identity=await subtle.digest('SHA-256',new TextEncoder().encode(
  data.source+':'+data.deliveryId));
 const event=Object.freeze({
  verified:true,source:data.source,deliveryId:data.deliveryId,
  objective:data.objective,payloadSha256:toHex(digest),
  taskKey:'webhook-'+toHex(identity).slice(0,40)
 });
 TRUSTED.add(event);
 return event;
}
export async function admitSignedEvent({db,scheduler,event}={}){
 if(!TRUSTED.has(event)||!db?.query||!scheduler?.now)
  reject('unverified-event');
 // Non-atomic capacity preflight: conservative for normal loads but needs a
 // serialized global budget before strict concurrent-queue-cap certification.
 const capacity=await db.query(
  "SELECT count(*)::int AS n FROM brain_tasks WHERE status='queued'");
 if(!Number.isSafeInteger(Number(capacity?.rows?.[0]?.n))||
   Number(capacity.rows[0].n)<0)reject('invalid-queue-state');
 if(Number(capacity.rows[0].n)>=100)return {ok:false,error:'queue-full'};
 const statement=`WITH accepted AS (
  INSERT INTO brain_signed_inbox(source,delivery_id,task_key,payload_sha256)
  VALUES($1,$2,$3,$4)
  ON CONFLICT(source,delivery_id) DO NOTHING RETURNING id,task_key
 ), admitted AS (
  INSERT INTO brain_tasks(task_key,objective)
  SELECT accepted.task_key,$5::text FROM accepted
  ON CONFLICT(task_key) DO NOTHING RETURNING id,task_key
 ), receipt AS (
  INSERT INTO brain_events(task_id,event_type,details)
  SELECT id,'signed-webhook-admitted',
   jsonb_build_object('source',$1::text,'deliveryId',$2::text)
  FROM admitted RETURNING id
 )
 SELECT admitted.id AS task_id,admitted.task_key,accepted.id AS inbox_id
 FROM admitted JOIN accepted ON accepted.task_key=admitted.task_key`;
 const params=[event.source,event.deliveryId,event.taskKey,event.payloadSha256,event.objective];
 const admitted=await db.query(statement,params);
 const row=admitted?.rows?.[0];
 if(!row){
  const previous=await db.query(
   "SELECT payload_sha256 FROM brain_signed_inbox WHERE source=$1 AND delivery_id=$2",
   [event.source,event.deliveryId]);
  const hashes=previous?.rows||[];
  if(hashes.length!==1||hashes[0].payload_sha256!==event.payloadSha256)
   reject('delivery-id-conflict');
  return {ok:true,created:false,reason:'duplicate-delivery'};
 }
 let immediateScheduled=false;
 try{await scheduler.now('/api/brain/run',{via:'signed-event'});immediateScheduled=true;}
 catch{immediateScheduled=false;}
 return {ok:true,created:true,taskId:row.task_id,taskKey:event.taskKey,
  immediateScheduled,fallback:'hourly'};
}
