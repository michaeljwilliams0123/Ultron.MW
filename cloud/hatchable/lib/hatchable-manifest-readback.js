import {deploymentArtifactDigest} from './deployment-release-receipt/read.js';

const TARGET=/^hatchable-v([1-9][0-9]{0,8})$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const HEX64=/^[a-f0-9]{64}$/;
const PROJECT_ID='proj_A6GCXRSKizko';

export async function verifyLiveHatchableManifest({
 deploymentRow,config,fetchImpl=globalThis.fetch
}={}){
 if(!deploymentRow||!TARGET.test(deploymentRow.target||'')||
  !SHA.test(deploymentRow.source_sha||'')||
  !DIGEST.test(deploymentRow.artifact_digest||'')){
  return {verified:false,state:'unavailable',reason:'receipt-missing-or-invalid'};
 }
 const version=Number(TARGET.exec(deploymentRow.target)[1]);
 let token='',baseUrl='';
 try{
  token=String(await config?.get?.('HATCHABLE_API_TOKEN')||'').trim();
  baseUrl=String(await config?.get?.('HATCHABLE_DEPLOYMENT_API_URL')||'').trim();
 }catch{}
 if(!token){
  return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-reader-unconfigured'};
 }
 const url=baseUrl
  ?baseUrl.replace(/\{version\}/g,String(version))
  :`https://hatchable.com/api/projects/${PROJECT_ID}/deployments/${version}`;
 if(!url.startsWith('https://')){
  return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-url-invalid'};
 }
 try{
  const res=await fetchImpl(url,{
   method:'GET',redirect:'error',cache:'no-store',
   signal:AbortSignal.timeout(8000),
   headers:{Authorization:'Bearer '+token,Accept:'application/json'}
  });
  if(!res?.ok)return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-http-'+Number(res?.status||0)};
  const snap=await res.json();
  if(!snap||snap.status!=='live'||Number(snap.version)!==version||
   !Array.isArray(snap.file_manifest)||!snap.file_manifest.length){
   return {verified:false,state:'manifest-drift-detected',
    reason:'live-deployment-version-or-status-mismatch'};
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
  return {verified:true,state:'live-manifest-verified',
   target:deploymentRow.target,artifactDigest:liveDigest,
   manifestFileCount:files.length};
 }catch{
  return {verified:false,state:'receipt-only-unverified',
   reason:'hatchable-manifest-readback-unavailable'};
 }
}
