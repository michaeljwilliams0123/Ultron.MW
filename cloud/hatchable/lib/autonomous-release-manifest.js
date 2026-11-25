import {deploymentArtifactDigest} from './deployment-release-receipt/read.js';
import {verifyIndependentSourceInventory} from './independent-source-inventory.js';
const PROJECT='proj_A6GCXRSKizko';
const SHA=/^[a-f0-9]{40}$/;
export async function discoverAutonomousReleaseManifest({config,sourceSha,fetchGithub,fetchImpl=fetch,verifyInventory=verifyIndependentSourceInventory}={}){
 if(!SHA.test(sourceSha||''))return null;
 try{
  const token=String(await config.get('ULTRON_HATCHABLE_API_TOKEN')||'').trim();
  if(!token)return null;
  async function call(name,args){
   const r=await fetchImpl('https://hatchable.com/mcp',{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{project_id:PROJECT,...args}}})});
   if(!r.ok)throw Error('manifest-read-unavailable');
   const raw=await r.text();let rpc;
   try{rpc=JSON.parse(raw);}catch{rpc=JSON.parse(raw.split('\n').map(x=>x.trim()).find(x=>x.startsWith('data:')).slice(5).trim());}
   if(rpc?.error||rpc?.result?.isError)throw Error('manifest-read-unavailable');
   return rpc.result.structuredContent||JSON.parse(rpc.result.content.find(x=>x.type==='text').text);
  }
  const list=await call('list_deployments',{limit:5});
  const live=list?.deployments?.filter(x=>x.status==='live');
  if(live?.length!==1||!Number.isSafeInteger(live[0].version)||live[0].version<1||Number(list.current_version)!==live[0].version)return null;
  const version=live[0].version;
  const snap=await call('get_deployment',{version});
  if(snap?.status!=='live'||Number(snap.version)!==version||!Array.isArray(snap.file_manifest)||!snap.file_manifest.length)return null;
  if([snap.source_sha,snap.sourceSha].some(x=>x!=null&&x!==sourceSha))return null;
  const files=snap.file_manifest.map(x=>({path:x.path,hash:x.hash}));
  const artifactDigest=deploymentArtifactDigest(files);
  const independent=await verifyInventory({sourceSha,files,fetchGithub});
  if(!independent||independent.sourceSha!==sourceSha)return null;
  // Re-read live version after verifying attribution to reject observed drift.
  const after=await call('list_deployments',{limit:5});
  if(Number(after?.current_version)!==version||after.deployments?.filter(x=>x.status==='live').length!==1||!after.deployments.some(x=>x.status==='live'&&x.version===version))return null;
  return {verified:true,target:'hatchable-v'+version,sourceSha,artifactDigest,manifestFileCount:files.length,attestorRunId:independent.runId,attestorArtifactId:independent.artifactId};
 }catch{return null;}
}
