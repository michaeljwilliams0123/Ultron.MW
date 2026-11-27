const PREFIX='/__ultron/webhooks/';
const AGENTS=new Set(['ChatGPT','Gemini']);
const TYPES=new Set(['coordination','verification','canary','receipt']);
const ID=/^[A-Za-z0-9_.:-]{4,120}$/;
const NONCE=/^[A-Za-z0-9_-]{16,128}$/;
const encoder=new TextEncoder();
const MAX_BODY=4096;
const WINDOW=300;
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
  const agent=request.headers.get('x-relay-agent'),ts=request.headers.get('x-relay-timestamp'),nonce=request.headers.get('x-relay-nonce'),sig=request.headers.get('x-relay-signature');
  if(!AGENTS.has(agent)||!/^\d{10}$/.test(ts??'')||Math.abs(now-Number(ts))>WINDOW||!NONCE.test(nonce??'')||!/^[a-f0-9]{64}$/.test(sig??''))return null;
  const a=env.CHATGPT_RELAY_KEY,b=env.GEMINI_RELAY_KEY;
  if(typeof a!=='string'||typeof b!=='string'||a.length<32||b.length<32||a===b)return null;
  const key=await crypto.subtle.importKey('raw',encoder.encode(agent==='ChatGPT'?a:b),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(sig.match(/../g),x=>parseInt(x,16));
  const signed=[request.method,url.pathname+url.search,agent,ts,nonce,raw].join('\n');
  if(!await crypto.subtle.verify('HMAC',key,bytes,encoder.encode(signed)))return null;
  return {agent,nonce};
}
const parse=raw=>{try{const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}};
const only=(object,keys)=>Object.keys(object).every(k=>keys.includes(k));
async function handle(request,env) {
  const url=new URL(request.url),route=url.pathname,method=request.method;
  if(![PREFIX+'relay',PREFIX+'events',PREFIX+'ack'].includes(route))return err(404,'not_found');
  if(method!==(route.endsWith('/events')?'GET':'POST'))return err(405,'method_not_allowed');
  let raw;try{raw=await boundedBody(request)}catch{return err(400,'invalid_body')}
  if(raw===null)return err(413,'body_too_large');
  const now=Math.floor(Date.now()/1000);
  const identity=await authenticate(request,env,url,raw,now);
  if(!identity)return err(401,'authentication_required');
  const {agent,nonce}=identity;
  if(!env.RELAY_DB)return err(503,'storage_unavailable');
  const db=env.RELAY_DB;
  // The uniqueness constraint is the replay fence; the same nonce cannot win twice.
  const admitted=await db.prepare('INSERT OR IGNORE INTO agent_relay_v1_nonces(agent,nonce,expires_at) VALUES(?,?,?)').bind(agent,nonce,now+2*WINDOW+1).run();
  if(admitted.meta.changes!==1)return err(409,'replay');
  // Bounded cleanup; all signatures for deleted nonces have already expired.
  await db.prepare('DELETE FROM agent_relay_v1_nonces WHERE rowid IN (SELECT rowid FROM agent_relay_v1_nonces WHERE expires_at < ? LIMIT 100)').bind(now).run();
  if(route===PREFIX+'events'){
    if([...url.searchParams.keys()].some(k=>!['recipient','status'].includes(k))||url.searchParams.getAll('recipient').length>1||url.searchParams.getAll('status').length>1)return err(400,'invalid_query');
    const recipient=url.searchParams.get('recipient'),status=url.searchParams.get('status');
    if(recipient!==null&&recipient!==agent)return err(403,'recipient_scope');
    if(status!==null&&!['RECEIVED','ACKNOWLEDGED'].includes(status))return err(400,'invalid_status');
    const rows=await db.prepare('SELECT message_id,correlation_id,sender,recipient,event_type,status,created_at,acknowledged_at FROM agent_relay_v1_events WHERE recipient=? AND (? IS NULL OR status=?) ORDER BY created_at DESC,message_id DESC LIMIT 50').bind(agent,status,status).all();
    return json({ok:true,events:rows.results});
  }
  if(url.search)return err(400,'invalid_query');
  const body=parse(raw);if(!body||typeof body.message_id!=='string'||!ID.test(body.message_id))return err(400,'invalid_message');
  if(route===PREFIX+'relay'){
    if(!only(body,['message_id','correlation_id','recipient','event_type'])||!AGENTS.has(body.recipient)||body.recipient===agent||!TYPES.has(body.event_type)||(body.correlation_id!=null&&(typeof body.correlation_id!=='string'||!ID.test(body.correlation_id))))return err(400,'invalid_envelope');
    const correlation=body.correlation_id??null;
    const result=await db.prepare('INSERT OR IGNORE INTO agent_relay_v1_events(message_id,correlation_id,sender,recipient,event_type,created_at) VALUES(?,?,?,?,?,?)').bind(body.message_id,correlation,agent,body.recipient,body.event_type,now).run();
    if(result.meta.changes===1)return json({ok:true,message_id:body.message_id,status:'RECEIVED'},201);
    const prior=await db.prepare('SELECT correlation_id,sender,recipient,event_type,status FROM agent_relay_v1_events WHERE message_id=?').bind(body.message_id).first();
    if(!prior||prior.sender!==agent||prior.recipient!==body.recipient||prior.event_type!==body.event_type||prior.correlation_id!==correlation)return err(409,'message_conflict');
    return json({ok:true,message_id:body.message_id,deduplicated:true,status:prior.status});
  }
  if(!only(body,['message_id']))return err(400,'invalid_envelope');
  const updated=await db.prepare("UPDATE agent_relay_v1_events SET status='ACKNOWLEDGED',acknowledged_at=? WHERE message_id=? AND recipient=? AND status='RECEIVED'").bind(now,body.message_id,agent).run();
  if(updated.meta.changes===1)return json({ok:true,status:'ACKNOWLEDGED'});
  const prior=await db.prepare('SELECT status FROM agent_relay_v1_events WHERE message_id=? AND recipient=?').bind(body.message_id,agent).first();
  return prior?.status==='ACKNOWLEDGED'?json({ok:true,status:'ACKNOWLEDGED',deduplicated:true}):err(404,'not_found');
}
export default {async fetch(request,env){try{return await handle(request,env)}catch{return err(503,'relay_unavailable')}}};
