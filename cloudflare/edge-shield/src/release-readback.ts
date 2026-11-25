const ORIGIN='https://ultron-mw-cloud.hatchable.site';
const PATH='/api/brain/release-proof-edge';
const REPO='michaeljwilliams0123/Ultron.MW';
const MAX_FUTURE_SKEW_MS=60000;
const MAX_STALE_AGE_MS=300000;
type Proof={schema:'ultron.edge.release-proof.v1';repo:string;verified:boolean;status:string;observedAt:string;
 commitSha:string|null;target:string|null;artifactDigest:string|null;receiptId:string|null;evidenceSha256:string|null;missingGates:string[]};
export async function readCanonicalReleaseProof({origin,secret,now=Date.now(),nonce=crypto.randomUUID(),fetchImpl=fetch}:{
 origin:string;secret?:string;now?:number;nonce?:string;fetchImpl?:typeof fetch;
}):Promise<Proof>{
 if(origin!==ORIGIN||typeof secret!=='string'||secret.length<32||!Number.isFinite(now)||!/^[a-zA-Z0-9_-]{16,64}$/.test(nonce))throw Error('edge-readback-not-configured');
 const ts=String(Math.floor(now/1000));
 const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const raw=await crypto.subtle.sign('HMAC',key,enc.encode('ultron.edge.release-proof.read.v1\nGET\n'+PATH+'\n'+REPO+'\n'+ts+'\n'+nonce));
 const mac=Array.from(new Uint8Array(raw),x=>x.toString(16).padStart(2,'0')).join('');
 const r=await fetchImpl(ORIGIN+PATH,{method:'GET',redirect:'error',cache:'no-store',
  headers:{'x-ultron-release-proof-ts':ts,'x-ultron-release-proof-nonce':nonce,'x-ultron-release-proof-mac':mac,Accept:'application/json'}});
 if(!r.ok)throw Error('canonical-proof-unavailable');
 const p=await r.json() as Proof;
 const observedMs=Date.parse(p?.observedAt||'');
 if(p?.schema!=='ultron.edge.release-proof.v1'||p.repo!==REPO||typeof p.verified!=='boolean'||
 !Number.isFinite(observedMs)||observedMs>now+MAX_FUTURE_SKEW_MS||observedMs<now-MAX_STALE_AGE_MS||
 !Array.isArray(p.missingGates)||p.status!==(p.verified?'verified':'unverified'))throw Error('canonical-proof-invalid');
 if(p.verified&&(!/^[a-f0-9]{40}$/.test(p.commitSha||'')||!/^hatchable-v[1-9][0-9]{0,8}$/.test(p.target||'')||
 !/^sha256:[a-f0-9]{64}$/.test(p.artifactDigest||'')||!/^deployment:[1-9][0-9]*$/.test(p.receiptId||'')||
 !/^[a-f0-9]{64}$/.test(p.evidenceSha256||'')||p.missingGates.length!==0))throw Error('canonical-proof-invalid');
 // Never retain extra provider response fields in a durable Workflow result.
 return {schema:p.schema,repo:p.repo,verified:p.verified,status:p.status,observedAt:p.observedAt,commitSha:p.commitSha,
  target:p.target,artifactDigest:p.artifactDigest,receiptId:p.receiptId,evidenceSha256:p.evidenceSha256,missingGates:p.missingGates};
}
