/** Compare pinned GitHub source bytes with a separately obtained Hatchable deployment manifest.
 * Parity evidence is NOT an independent deployment signature or release authorization.
 */
import {createHash} from 'node:crypto';
const SHA40=/^[0-9a-f]{40}$/, SHA256=/^[0-9a-f]{64}$/;
const hash=v=>createHash('sha256').update(v).digest('hex');
function filePath(v){
 return typeof v==='string'&&v.length>0&&v.length<=240&&
 !v.startsWith('/')&&!v.includes('\\')&&!/[\x00-\x1f\x7f]/.test(v)&&
 v.split('/').every(s=>s.length>0&&s!=='.'&&s!=='..');
}
function inventory(rows,kind){
 if(!Array.isArray(rows)||rows.length>1000)throw Error(kind+'-inventory-invalid');
 const map=new Map();
 for(const row of rows){
  const digest=kind==='source'?row.sha256:row.hash;
  if(!filePath(row.path)||!SHA256.test(digest??'')||map.has(row.path))
   throw Error(kind+'-inventory-invalid');
  if(kind==='source'&&row.withoutFinalLfSha256!==undefined&&
    !SHA256.test(row.withoutFinalLfSha256))throw Error(kind+'-inventory-invalid');
  map.set(row.path,row);
 }
 return map;
}
function digestInventory(map,kind){
 return 'sha256:'+hash(JSON.stringify([...map.values()].map(row=>({
  path:row.path,hash:kind==='source'?row.sha256:row.hash
 })).sort((a,b)=>a.path.localeCompare(b.path))));
}
export function compareHatchableDeployment({sourceSha,version,sourceFiles,deployedFiles}={}){
 if(!SHA40.test(sourceSha??'')||!Number.isSafeInteger(version)||version<1)
  throw Error('provenance-invalid');
 const source=inventory(sourceFiles,'source');
 const deployed=inventory(deployedFiles,'deployment');
 const exact=[],newlineOnly=[],contentDrift=[],missingLive=[],liveOnly=[];
 for(const [path,row] of source){
  const other=deployed.get(path);
  if(!other){missingLive.push(path);continue;}
  if(row.sha256===other.hash)exact.push(path);
  else if(row.withoutFinalLfSha256&&row.withoutFinalLfSha256===other.hash)
   newlineOnly.push(path);
  else contentDrift.push(path);
 }
 for(const path of deployed.keys())if(!source.has(path))liveOnly.push(path);
 for(const a of [exact,newlineOnly,contentDrift,missingLive,liveOnly])a.sort();
 const sourceManifestSha256=digestInventory(source,'source');
 const deploymentManifestSha256=digestInventory(deployed,'deployment');
 const byteExact=contentDrift.length===0&&newlineOnly.length===0&&
  missingLive.length===0&&liveOnly.length===0;
 return Object.freeze({schema:'ultron.hatchable-deployment-parity.v1',
  sourceSha,version,sourceFiles:source.size,deployedFiles:deployed.size,
  exactCount:exact.length,exact,newlineOnly,contentDrift,missingLive,liveOnly,
  sourceManifestSha256,deploymentManifestSha256,byteExact,
  status:byteExact?'parity-matched-not-release-authorized':'drift-unverified',
  independentlySigned:false,releaseAccepted:false,
  policy:'A manifest hash cannot prove source provenance or a signed deployment receipt.'});
}
