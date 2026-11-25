import {db,config,api} from 'hatchable';
import {readAppCredentials,mintActionsToken} from 'lib/council-deep-dispatch.js';
import {readCanonicalReleaseProof} from 'lib/release-proof-readback.js';
import {projectEdgeReleaseProof} from 'lib/release-proof-edge-auth.js';
export const access='public';
export const methods=['POST'];
const PATH='/api/brain/release-authorization-wakeup';
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const header=(h,n)=>typeof h?.get==='function'?h.get(n):h?.[n];
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({status:'denied'});
 const sourceSha=req.body?.sourceSha,ts=header(req.headers,'x-ultron-release-proof-ts'),
 nonce=header(req.headers,'x-ultron-release-proof-nonce'),mac=header(req.headers,'x-ultron-release-proof-mac');
 if(!SHA.test(sourceSha||'')||typeof ts!=='string'||!/^\d{10}$/.test(ts)||Math.abs(Date.now()-Number(ts)*1000)>60000||
  typeof nonce!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(nonce)||typeof mac!=='string'||!/^[a-f0-9]{64}$/.test(mac))
  return res.status(403).json({status:'denied'});
 try{
  const secret=await config.get('ORIGIN_LOCK_SECRET');
  if(typeof secret!=='string'||secret.length<32)return res.status(403).json({status:'denied'});
  const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const msg=['ultron.edge.release-authorization.wakeup.v1','POST',PATH,REPO,sourceSha,ts,nonce].join('\n');
  if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(mac.match(/../g),x=>parseInt(x,16)),enc.encode(msg)))
   return res.status(403).json({status:'denied'});
  const seen=await db.query('INSERT INTO brain_release_dispatch_nonces(nonce) VALUES($1) ON CONFLICT DO NOTHING RETURNING nonce',[nonce]);
  if(seen?.rows?.length!==1)return res.status(403).json({status:'denied'});
  const proof=projectEdgeReleaseProof(await readCanonicalReleaseProof({db,config,api}));
  if(proof.verified||proof.commitSha!==sourceSha||!proof.missingGates.includes('signed-deployment-receipt')||
   proof.missingGates.includes('ci')||proof.missingGates.includes('council-7of7'))return res.json({status:'not-eligible'});
  const claim=await db.query('INSERT INTO brain_release_dispatch_windows(source_sha,window_id) VALUES($1,floor(extract(epoch from clock_timestamp())/900)::bigint) ON CONFLICT DO NOTHING RETURNING window_id',[sourceSha]);
  if(claim?.rows?.length!==1)return res.json({status:'already-admitted'});
  const credentials=await readAppCredentials(config);
  const token=await mintActionsToken({credentials});
  const upstream=await fetch('https://api.github.com/repos/'+REPO+'/actions/workflows/release-authorize.yml/dispatches',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'Ultron-Release-Wakeup'},
   body:JSON.stringify({ref:'main',inputs:{mode:'auto'}})
  });
  if(upstream.status!==204&&upstream.status!==200)return res.status(503).json({status:'dispatch-unavailable'});
  return res.json({status:'dispatched'});
 }catch{return res.status(503).json({status:'dispatch-unavailable'});}
}
