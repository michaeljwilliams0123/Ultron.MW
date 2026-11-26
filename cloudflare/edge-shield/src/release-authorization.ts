const REPO="michaeljwilliams0123/Ultron.MW";
const ORIGIN="https://ultron-mw-cloud.hatchable.site";
const PATH="/api/brain/release-authorization-wakeup";
const SHA=/^[a-f0-9]{40}$/;
type Proof={repo:string;commitSha:string|null;verified:boolean;missingGates:string[]};
export function shouldWakeAuthorization(p:Proof,sourceSha?:string):boolean {
 return p.repo===REPO && !p.verified && SHA.test(p.commitSha||"") &&
  (!sourceSha||sourceSha===p.commitSha) &&
  p.missingGates.includes("signed-deployment-receipt") &&
  !p.missingGates.includes("ci") && !p.missingGates.includes("council-7of7");
}
export async function dispatchReleaseAuthorization({origin,secret,sourceSha,now=Date.now(),fetchImpl=fetch}:{
 origin:string;secret?:string;sourceSha:string;now?:number;fetchImpl?:typeof fetch;
}):Promise<{status:string}>{
 if(origin!==ORIGIN||typeof secret!=="string"||secret.length<32||!SHA.test(sourceSha)||!Number.isFinite(now))throw Error("authorization-wakeup-unconfigured");
 const ts=String(Math.floor(now/1000)),nonce=crypto.randomUUID(),enc=new TextEncoder();
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const msg=["ultron.edge.release-authorization.wakeup.v1","POST",PATH,REPO,sourceSha,ts,nonce].join("\n");
 const raw=await crypto.subtle.sign("HMAC",key,enc.encode(msg));
 const mac=Array.from(new Uint8Array(raw),x=>x.toString(16).padStart(2,"0")).join("");
 const r=await fetchImpl(ORIGIN+PATH,{method:"POST",redirect:"error",cache:"no-store",
  headers:{"content-type":"application/json","x-ultron-release-proof-ts":ts,"x-ultron-release-proof-nonce":nonce,"x-ultron-release-proof-mac":mac},
  body:JSON.stringify({sourceSha})});
 if(!r.ok)throw Error("authorization-wakeup-http-"+r.status);
 const body=await r.json() as {status?:string};
 if(!["dispatched","already-admitted","not-eligible"].includes(body.status||""))throw Error("authorization-wakeup-invalid");
 return {status:body.status!};
}
