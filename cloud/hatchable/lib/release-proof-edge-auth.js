const PATH='/api/brain/release-proof-edge';
const REPO='michaeljwilliams0123/Ultron.MW';
const message=ts=>'ultron.edge.release-proof.read.v1\nGET\n'+PATH+'\n'+REPO+'\n'+ts;
const enc=new TextEncoder();
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^sha256:[a-f0-9]{64}$/;
const header=(h,n)=>typeof h?.get==='function'?h.get(n):h?.[n]??null;
export async function authorizeEdgeReleaseReadback({headers,secret,now=Date.now(),method}={}){
 if(method!=='GET'||typeof secret!=='string'||secret.length<32)return false;
 const ts=header(headers,'x-ultron-release-proof-ts'),mac=header(headers,'x-ultron-release-proof-mac');
 if(typeof ts!=='string'||!/^\d{10}$/.test(ts)||typeof mac!=='string'||!/^[a-f0-9]{64}$/.test(mac)||
 !Number.isFinite(now)||Math.abs(now-Number(ts)*1000)>60000)return false;
 try{
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('HMAC',key,Uint8Array.from(mac.match(/../g),x=>parseInt(x,16)),enc.encode(message(ts)));
 }catch{return false;}
}
const gates=['ci','council-7of7','signed-deployment-receipt','independent-manifest-readback'];
export function projectEdgeReleaseProof(p){
 const identity=p?.schema==='ultron.release-proof.v1'&&p.repo===REPO&&SHA.test(p.commitSha||'');
 const details=p?.driftDetails;
 const exact=identity&&p.deployment?.sourceSha===p.commitSha&&
  /^hatchable-v[1-9][0-9]{0,8}$/.test(p.deployment?.target||'')&&DIGEST.test(p.deployment?.artifactDigest||'')&&
  /^deployment:[1-9][0-9]*$/.test(p.deployment?.receiptId||'')&&/^[a-f0-9]{64}$/.test(p.evidenceSha256||'');
 const verified=Boolean(exact&&p.verified===true&&p.status==='verified'&&p.ci?.verified===true&&
  p.council?.verified===true&&p.deployment?.verified===true&&details?.ciVerified===true&&
  details?.councilVerified===true&&details?.deploymentReceiptRecorded===true&&details?.independentManifestReadback===true&&
  Array.isArray(details.missingGates)&&details.missingGates.length===0);
 return {schema:'ultron.edge.release-proof.v1',repo:REPO,verified,status:verified?'verified':'unverified',
  commitSha:identity?p.commitSha:null,target:exact?p.deployment.target:null,
  artifactDigest:exact?p.deployment.artifactDigest:null,receiptId:exact?p.deployment.receiptId:null,
  evidenceSha256:identity&&/^[a-f0-9]{64}$/.test(p.evidenceSha256||'')?p.evidenceSha256:null,
  missingGates:verified?[]:gates.filter(g=>!identity||!Array.isArray(details?.missingGates)||details.missingGates.includes(g)||
   (g==='ci'&&details?.ciVerified!==true)||(g==='council-7of7'&&details?.councilVerified!==true)||
   (g==='signed-deployment-receipt'&&(!exact||details?.deploymentReceiptRecorded!==true))||
   (g==='independent-manifest-readback'&&(!exact||details?.independentManifestReadback!==true)))};
}
