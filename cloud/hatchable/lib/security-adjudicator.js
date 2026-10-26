// Delegated administrator capability verifier. The independent adjudicator
// signs these grants; workers possess ONLY the trusted public verification key.
// This module cannot mint credentials, grant itself privileges, or change policy.
const VERIFIED=new WeakSet();
const OPERATIONS=new Set([
 'repo.inspect','repo.issue.create','repo.verify.dispatch','repo.pr.review',
 'repo.pr.squash','repo.branch.update','cloud.deploy','permissions.change',
 'webhook.configure'
]);
const GRANT_SCHEMA='ultron.security-grant.v1';
const ISSUER='ultron-independent-security';
const AUDIENCE='ultron-cloud-brain';
const SHA256=/^[a-f0-9]{64}$/;
const GRANT_ID=/^[A-Za-z0-9_.:-]{8,128}$/;
const MAX_TTL_MS=15*60*1000;
function refuse(message){throw Error(message);}
function parseTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
  refuse('invalid-grant-time');
 const result=Date.parse(value);
 if(!Number.isFinite(result))refuse('invalid-grant-time');
 return result;
}
function decodeSignature(encoded){
 if(typeof encoded!=='string'||!(/^[a-zA-Z0-9_-]{86}$/).test(encoded))
  refuse('invalid-grant-signature');
 let raw;
 try{raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')+'==');}
 catch{refuse('invalid-grant-signature');}
 if(raw.length!==64)refuse('invalid-grant-signature');
 return Uint8Array.from(raw,x=>x.charCodeAt(0));
}
export async function verifyDelegatedGrant({
 envelope,publicJwk,request,now=new Date().toISOString(),
 subtle=globalThis.crypto?.subtle
}={}){
 if(!subtle||!publicJwk||publicJwk.kty!=='EC'||publicJwk.crv!=='P-256')
  refuse('trusted-adjudicator-key-unavailable');
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>4096||
    !envelope.payload.length)refuse('invalid-grant-payload');
 const signature=decodeSignature(envelope.signature);
 let key,ok=false;
 try{
  key=await subtle.importKey('jwk',publicJwk,{name:'ECDSA',namedCurve:'P-256'},
   false,['verify']);
  ok=await subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,
   new TextEncoder().encode(envelope.payload));
 }catch{refuse('invalid-grant-signature');}
 if(!ok)refuse('invalid-grant-signature');
 let grant;
 try{grant=JSON.parse(envelope.payload);}
 catch{refuse('invalid-grant-payload');}
 if(!grant||typeof grant!=='object'||Array.isArray(grant)||
    grant.schema!==GRANT_SCHEMA||grant.issuer!==ISSUER||
    grant.audience!==AUDIENCE||!GRANT_ID.test(grant.grantId||'')||
    !SHA256.test(grant.policySha||'')||
    typeof grant.administrativeChange!=='boolean')
  refuse('invalid-grant-claims');
 if(!OPERATIONS.has(grant.operation))refuse('unsupported-grant-operation');
 const begin=parseTime(grant.notBefore),end=parseTime(grant.expiresAt);
 if(end<=begin||end-begin>MAX_TTL_MS)refuse('grant-ttl-exceeded');
 const current=parseTime(now);
 if(current<begin)refuse('grant-not-yet-valid');
 if(current>=end)refuse('grant-expired');
 if(!request||!['actor','objectiveId','operation','resource'].every(key=>
    typeof request[key]==='string'&&request[key].length>0)||
    grant.actor!==request.actor||grant.objectiveId!==request.objectiveId||
    grant.operation!==request.operation||grant.resource!==request.resource||
    grant.administrativeChange!==request.administrativeChange)
  refuse('grant-scope-mismatch');
 if(grant.operation==='permissions.change'&&!grant.administrativeChange)
  refuse('administrative-grant-required');
 const verified=Object.freeze({
  authorized:true,grantId:grant.grantId,actor:grant.actor,
  objectiveId:grant.objectiveId,operation:grant.operation,
  resource:grant.resource,policySha:grant.policySha,
  expiresAt:grant.expiresAt,administrativeChange:grant.administrativeChange
 });
 VERIFIED.add(verified);
 return verified;
}
// Consume once through a single SQL command; public API callers cannot forge a
// verifiedGrant by passing {authorized:true} because VERIFIED is module-private.
export async function consumeDelegatedGrant({db,verifiedGrant}={}){
 if(!db?.query||!VERIFIED.has(verifiedGrant))refuse('invalid-verified-grant');
 if(Date.parse(verifiedGrant.expiresAt)<=Date.now())
  return {ok:false,error:'grant-expired'};
 const sql=`WITH admitted AS (
  INSERT INTO brain_authority_grants(
   grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
  VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz)
  ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
 ), receipt AS (
  INSERT INTO brain_events(event_type,details)
  SELECT 'authority-grant-consumed',
   jsonb_build_object('grantId',grant_id,'operation',$4::text,'policySha',$6::text)
  FROM admitted RETURNING id
 )
 SELECT admitted.grant_id,receipt.id AS receipt_id FROM admitted JOIN receipt ON true`;
 const result=await db.query(sql,[verifiedGrant.grantId,verifiedGrant.objectiveId,
  verifiedGrant.actor,verifiedGrant.operation,verifiedGrant.resource,
  verifiedGrant.policySha,verifiedGrant.expiresAt]);
 const row=result?.rows?.[0];
 return row?{ok:true,grantId:row.grant_id,receiptId:row.receipt_id}:
  {ok:false,error:'grant-replayed'};
}
