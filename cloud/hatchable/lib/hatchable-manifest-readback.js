import {deploymentArtifactDigest} from './deployment-release-receipt/read.js';
import {verifyIndependentSourceInventory} from './independent-source-inventory.js';

const TARGET=/^hatchable-v([1-9][0-9]{0,8})$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const HEX64=/^[a-f0-9]{64}$/;
const PROJECT_ID='proj_A6GCXRSKizko';

export async function verifyLiveHatchableManifest({
 deploymentRow,config,fetchImpl=globalThis.fetch,fetchGithub
}={}){
 if(!deploymentRow||!TARGET.test(deploymentRow.target||'')||
  !SHA.test(deploymentRow.source_sha||'')||
  !DIGEST.test(deploymentRow.artifact_digest||'')){
  return {verified:false,state:'unavailable',reason:'receipt-missing-or-invalid'};
 }
 const version=Number(TARGET.exec(deploymentRow.target)[1]);
 let token='',baseUrl='';
 try{
  token=String(await config?.get?.('ULTRON_HATCHABLE_API_TOKEN')||'').trim();
  baseUrl=String(await config?.get?.('HATCHABLE_DEPLOYMENT_API_URL')||'').trim();
 }catch{}
 if(!token){
  return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-reader-unconfigured'};
 }
 const url=baseUrl
  ?baseUrl.replace(/\{version\}/g,String(version))
  :'https://hatchable.com/mcp';
 let parsed=null;
 try{parsed=new URL(url);}catch{}
 // Never forward deployment-read credentials to arbitrary URLs or hosts.
 if(!parsed||parsed.protocol!=='https:'||
  parsed.hostname!=='hatchable.com'||parsed.port||
  parsed.username||parsed.password||parsed.search||parsed.hash){
  return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-url-invalid'};
 }
 try{
  const isMcp=url.endsWith('/mcp');
  const res=await fetchImpl(url,isMcp?{
   method:'POST',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(8000),
   headers:{
    Authorization:'Bearer '+token,
    'Content-Type':'application/json',
    Accept:'application/json, text/event-stream'
   },
   body:JSON.stringify({
    jsonrpc:'2.0',id:1,method:'tools/call',
    params:{name:'get_deployment',arguments:{project_id:PROJECT_ID,version}}
   })
  }:{
   method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(8000),
   headers:{Authorization:'Bearer '+token,Accept:'application/json'}
  });
  if(!res?.ok)return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-http-'+Number(res?.status||0)};
  let snap;
  if(isMcp){
   const raw=await res.text();
   let rpc=null;
   try{rpc=JSON.parse(raw);}catch{
    const line=raw.split('\n').map(l=>l.trim()).find(l=>l.startsWith('data:'));
    if(line)try{rpc=JSON.parse(line.slice(5).trim());}catch{}
   }
   if(rpc?.error||rpc?.result?.isError){
    return {verified:false,state:'receipt-only-unverified',
     reason:'hatchable-mcp-tool-error'};
   }
   const text=rpc?.result?.content?.find?.(c=>c?.type==='text')?.text;
   snap=rpc?.result?.structuredContent||(text?JSON.parse(text):null);
  }else{
   snap=await res.json();
  }
  if(!snap||snap.status!=='live'||Number(snap.version)!==version||
   !Array.isArray(snap.file_manifest)||!snap.file_manifest.length){
   return {verified:false,state:'manifest-drift-detected',
    reason:'live-deployment-version-or-status-mismatch'};
  }
  // Explicit conflicting or malformed provider attribution always denies.
  const liveSourceSha=snap.source_sha??snap.sourceSha;
  if((snap.source_sha!=null&&snap.sourceSha!=null&&snap.source_sha!==snap.sourceSha)||
   (liveSourceSha!=null&&(!SHA.test(liveSourceSha)||liveSourceSha!==deploymentRow.source_sha))){
   return {verified:false,state:'receipt-only-unverified',
    reason:'live-deployment-source-unverified'};
  }
  const files=snap.file_manifest.map(item=>({
   path:String(item?.path||''),
   hash:String(item?.hash||'').toLowerCase()
  }));
  if(files.some(f=>!f.path||!HEX64.test(f.hash))){
   return {verified:false,state:'manifest-drift-detected',
    reason:'live-manifest-malformed'};
  }
  const liveDigest=deploymentArtifactDigest(files);
  if(liveDigest!==deploymentRow.artifact_digest||
   files.length!==Number(deploymentRow.manifest_file_count)){
   return {verified:false,state:'manifest-drift-detected',
    reason:'live-artifact-digest-mismatch',liveDigest,
    liveFileCount:files.length};
  }
  // Missing provider lineage may use independently authenticated GitHub
  // source-inventory evidence, never a caller assertion or stale receipt.
  const independent=liveSourceSha==null?await verifyIndependentSourceInventory({
   sourceSha:deploymentRow.source_sha,files,fetchGithub}):null;
  if(liveSourceSha==null&&!independent)return {verified:false,state:'receipt-only-unverified',
   reason:'live-deployment-source-unverified'};
  return {verified:true,state:'live-manifest-verified',
   target:deploymentRow.target,sourceSha:liveSourceSha??independent.sourceSha,artifactDigest:liveDigest,
   manifestFileCount:files.length,sourceAttribution:independent?'independent-content-equivalence':'provider-source-sha',
   ...(independent?{attestorRunId:independent.runId,attestorArtifactId:independent.artifactId,sourceDigest:independent.sourceDigest}: {})};
 }catch{
  return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-readback-unavailable'};
 }
}
