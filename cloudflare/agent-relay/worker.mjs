const PREFIX='/__ultron/webhooks/';
const AGENTS=new Set(['ChatGPT','Gemini']);
const TYPES=new Set(['coordination','verification','canary','receipt']);
const ID=/^[A-Za-z0-9_.:-]{4,120}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const encoder=new TextEncoder();
const MAX_BODY=4096;
const PAST=300000, FUTURE=60000;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const err=(status,error)=>json({ok:false,error},status);
async function boundedBody(request) {
  if (!request.body) return '';
  const reader=request.body.getReader(); const chunks=[]; let size=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return null}chunks.push(value)}
  } finally {reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength}
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}
async function authenticate(request,env,url,raw,now) {
  const agent=request.headers.get('x-ultron-agent'),ts=request.headers.get('x-ultron-timestamp'),nonce=request.headers.get('x-ultron-nonce'),sig=request.headers.get('x-ultron-signature');
  if(!AGENTS.has(agent)||!/^\d{13}$/.test(ts??'')||now-Number(ts)>PAST||Number(ts)-now>FUTURE||!NONCE.test(nonce??'')||!/^[A-Za-z0-9_-]{86}$/.test(sig??''))return null;
  let keys;try{keys=JSON.parse(env.AGENT_PUBLIC_KEYS)}catch{return null}
  if(!keys||Object.keys(keys).length!==2)return null;
  const a=keys.ChatGPT,b=keys.Gemini;
  const valid=k=>k&&k.kty==='EC'&&k.crv==='P-256'&&!Object.hasOwn(k,'d')&&/^[A-Za-z0-9_-]{43}$/.test(k.x??'')&&/^[A-Za-z0-9_-]{43}$/.test(k.y??'');
  if(!valid(a)||!valid(b)||(a.x===b.x&&a.y===b.y))return null;
  const jwk=agent==='ChatGPT'?a:b;
  let key;try{key=await crypto.subtle.importKey('jwk',{kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y},{name:'ECDSA',namedCurve:'P-256'},false,['verify'])}catch{return null}
  const bytes=Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')+'=='),c=>c.charCodeAt(0));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
  const canonical=['ULTRON-WEBHOOK-v2',request.method,url.pathname+url.search,agent,ts,nonce,hash].join('\n');
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes,encoder.encode(canonical)))return null;
  return {agent,nonce};
}
const parse=raw=>{try{const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}};
const only=(object,keys)=>Object.keys(object).every(k=>keys.includes(k));
async function handle(request,env) {
  const url=new URL(request.url),route=url.pathname,method=request.method;
  if(![PREFIX+'relay',PREFIX+'events',PREFIX+'claim',PREFIX+'ack'].includes(route))return err(404,'not_found');
  if(method!==(route.endsWith('/events')?'GET':'POST'))return err(405,'method_not_allowed');
  let raw;try{raw=await boundedBody(request)}catch{return err(400,'invalid_body')}
  if(raw===null)return err(413,'body_too_large');
  const now=Date.now();
  const identity=await authenticate(request,env,url,raw,now);
  if(!identity)return err(401,'authentication_required');
  const {agent,nonce}=identity;
  if(!env.RELAY_DB)return err(503,'storage_unavailable');
  const db=env.RELAY_DB;
  // The uniqueness constraint is the replay fence; the same nonce cannot win twice.
  const admitted=await db.prepare('INSERT OR IGNORE INTO agent_relay_v2_nonces(agent,nonce,expires_at) VALUES(?,?,?)').bind(agent,nonce,now+PAST+FUTURE+1).run();
  if(admitted.meta.changes!==1)return err(409,'replay');
  // Bounded cleanup; all signatures for deleted nonces have already expired.
  await db.prepare('DELETE FROM agent_relay_v2_nonces WHERE rowid IN (SELECT rowid FROM agent_relay_v2_nonces WHERE expires_at < ? LIMIT 100)').bind(now).run();
  if(route===PREFIX+'events'){
    if([...url.searchParams.keys()].some(k=>!['recipient','status'].includes(k))||url.searchParams.getAll('recipient').length>1||url.searchParams.getAll('status').length>1)return err(400,'invalid_query');
    const recipient=url.searchParams.get('recipient'),status=url.searchParams.get('status');
    if(recipient!==null&&recipient!==agent)return err(403,'recipient_scope');
    if(status!==null&&!['RECEIVED','CLAIMED','ACKNOWLEDGED'].includes(status))return err(400,'invalid_status');
    const rows=await db.prepare('SELECT message_id,correlation_id,sender,recipient,event_type,status,created_at,acknowledged_at FROM agent_relay_v2_events WHERE recipient=? AND (? IS NULL OR status=?) ORDER BY created_at DESC,message_id DESC LIMIT 50').bind(agent,status,status).all();
    return json({ok:true,events:rows.results});
  }
  if(url.search)return err(400,'invalid_query');
  const body=parse(raw);if(!body||typeof body.message_id!=='string'||!ID.test(body.message_id))return err(400,'invalid_message');
  if(route===PREFIX+'relay'){
    if(!only(body,['message_id','correlation_id','recipient','event_type'])||!AGENTS.has(body.recipient)||body.recipient===agent||!TYPES.has(body.event_type)||(body.correlation_id!=null&&(typeof body.correlation_id!=='string'||!ID.test(body.correlation_id))))return err(400,'invalid_envelope');
    const correlation=body.correlation_id??null;
    const result=await db.prepare('INSERT OR IGNORE INTO agent_relay_v2_events(message_id,correlation_id,sender,recipient,event_type,created_at) VALUES(?,?,?,?,?,?)').bind(body.message_id,correlation,agent,body.recipient,body.event_type,now).run();
    if(result.meta.changes===1)return json({ok:true,message_id:body.message_id,status:'RECEIVED'},201);
    const prior=await db.prepare('SELECT correlation_id,sender,recipient,event_type,status FROM agent_relay_v2_events WHERE message_id=?').bind(body.message_id).first();
    if(!prior||prior.sender!==agent||prior.recipient!==body.recipient||prior.event_type!==body.event_type||prior.correlation_id!==correlation)return err(409,'message_conflict');
    return json({ok:true,message_id:body.message_id,deduplicated:true,status:prior.status});
  }
  if(route===PREFIX+'claim'){
    if(!only(body,['message_id','ttl_ms']))return err(400,'invalid_envelope');
    const ttl=Object.hasOwn(body,'ttl_ms')?body.ttl_ms:60000;
    if(!Number.isSafeInteger(ttl)||ttl<5000||ttl>300000)return err(400,'invalid_ttl');
    const token=crypto.randomUUID();
    const claimed=await db.prepare("UPDATE agent_relay_v2_events SET status='CLAIMED',lease_token=?,lease_expires_at=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))+?,fencing_generation=fencing_generation+1 WHERE message_id=? AND recipient=? AND (status='RECEIVED' OR (status='CLAIMED' AND lease_expires_at<=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))) RETURNING message_id,lease_token,lease_expires_at,fencing_generation").bind(token,ttl,body.message_id,agent).first();
    if(claimed)return json({ok:true,...claimed});
    const prior=await db.prepare('SELECT status FROM agent_relay_v2_events WHERE message_id=? AND recipient=?').bind(body.message_id,agent).first();
    return prior?err(409,'claim_conflict'):err(404,'not_found');
  }
  if(!only(body,['message_id','lease_token','fencing_generation'])||typeof body.lease_token!=='string'||!/^[a-f0-9-]{36}$/.test(body.lease_token)||!Number.isSafeInteger(body.fencing_generation)||body.fencing_generation<1)return err(400,'invalid_fence');
  // All authority and expiry predicates are checked in the same atomic UPDATE.
  const updated=await db.prepare("UPDATE agent_relay_v2_events SET status='ACKNOWLEDGED',acknowledged_at=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) WHERE message_id=? AND recipient=? AND status='CLAIMED' AND lease_token=? AND fencing_generation=? AND lease_expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))").bind(body.message_id,agent,body.lease_token,body.fencing_generation).run();
  if(updated.meta.changes===1)return json({ok:true,status:'ACKNOWLEDGED'});
  const prior=await db.prepare('SELECT status,lease_token,fencing_generation FROM agent_relay_v2_events WHERE message_id=? AND recipient=?').bind(body.message_id,agent).first();
  if(!prior)return err(404,'not_found');
  if(prior.status==='ACKNOWLEDGED'&&prior.lease_token===body.lease_token&&prior.fencing_generation===body.fencing_generation)return json({ok:true,status:'ACKNOWLEDGED',deduplicated:true});
  return err(409,'fence_conflict');

}
export default {async fetch(request,env){try{return await handle(request,env)}catch{return err(503,'relay_unavailable')}}};
