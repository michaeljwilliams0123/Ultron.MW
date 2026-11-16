/** Read-only source-to-deployment parity audit. Not a signed release receipt. */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha=value=>createHash('sha256').update(value).digest('hex');
const SHA=/^[a-f0-9]{64}$/;
const DEPLOYABLE=/^(?:api|lib|mcp|pages|migrations|public)\//;
const CONFIG=new Set(['hatchable.toml','seed.sql','package.json']);
function isSafePath(path){
 return typeof path==='string'&&path.length>0&&path.length<=400&&
  !path.startsWith('/')&&!path.includes('\\')&&
  !/[\x00-\x1f\x7f]/.test(path)&&
  path.split('/').every(part=>part&&part!=='.'&&part!=='..');
}
function enumerate(root,base='',output=[]){
 for(const item of readdirSync(join(root,base),{withFileTypes:true})){
  const relative=base?base+'/'+item.name:item.name;
  if(item.isDirectory()){
   if(item.name!=='.git'&&item.name!=='node_modules')enumerate(root,relative,output);
  }else if(item.isFile())output.push(relative);
 }
 return output;
}
export function auditHatchableSourceParity(manifest,sourceRoot){
 if(!manifest||typeof manifest!=='object'||!Number.isSafeInteger(Number(manifest.version))||
   Number(manifest.version)<1||typeof sourceRoot!=='string')throw Error('parity-input-invalid');
 const files=manifest.file_manifest??manifest.files;
 if(!Array.isArray(files)||files.length===0||files.length>5000)throw Error('parity-manifest-invalid');
 const root=realpathSync(resolve(sourceRoot)),seen=new Set(),items=[];
 for(const row of files){
  if(row?.virtual===true)continue;
  const path=row?.path,hash=row?.hash??row?.sha256;
  if(!isSafePath(path)||typeof hash!=='string'||!SHA.test(hash)||seen.has(path))
   throw Error('parity-entry-invalid');
  seen.add(path);items.push({path,hash});
 }
 if(items.length===0)throw Error('parity-manifest-invalid');
 const exact=[],finalNewlineOnly=[],substantiveDrift=[],missingInSource=[];
 for(const row of items){
  const absolute=resolve(root,...row.path.split('/'));
  if(!absolute.startsWith(root+sep)){missingInSource.push(row.path);continue}
  let bytes;
  try{
   if(!lstatSync(absolute).isFile())throw Error('not-file');
   const physical=realpathSync(absolute);
   if(!physical.startsWith(root+sep))throw Error('outside-root');
   bytes=readFileSync(absolute);
   if(bytes.length>20*1024*1024)throw Error('oversize');
  }catch{missingInSource.push(row.path);continue}
  if(sha(bytes)===row.hash){exact.push(row.path);continue}
  const shorter=bytes.length>0&&bytes[bytes.length-1]===10?
   sha(bytes.subarray(0,bytes.length-1))===row.hash:false;
  const longer=sha(Buffer.concat([bytes,Buffer.from('\n')]))===row.hash;
  if(shorter||longer)finalNewlineOnly.push(row.path);
  else substantiveDrift.push(row.path);
 }
 const sourceOnlyDeployable=enumerate(root).filter(path=>
  !seen.has(path)&&(DEPLOYABLE.test(path)||CONFIG.has(path))).sort();
 const counts={exact:exact.length,finalNewlineOnly:finalNewlineOnly.length,
  substantiveDrift:substantiveDrift.length,missingInSource:missingInSource.length,
  sourceOnlyDeployable:sourceOnlyDeployable.length};
 const byteExactParity=counts.exact===items.length&&
  counts.finalNewlineOnly===0&&counts.substantiveDrift===0&&
  counts.missingInSource===0&&counts.sourceOnlyDeployable===0;
 const fingerprint=sha(JSON.stringify({version:manifest.version,
  files:items.slice().sort((a,b)=>a.path.localeCompare(b.path))}));
 return Object.freeze({
  schema:'ultron.hatchable-source-parity.v1',version:Number(manifest.version),
  sourceSha:typeof manifest.sourceSha==='string'?manifest.sourceSha:null,
  deploymentManifestFingerprintSha256:fingerprint,filesObserved:items.length,
  counts,exact,finalNewlineOnly,substantiveDrift,missingInSource,
  sourceOnlyDeployable,byteExactParity,signedReleaseVerified:false,
  note:'Source parity and manifest hashes do not prove signed deployment provenance.'
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const input=process.argv[2],root=process.argv[3];
  if(!input||!root)throw Error('usage: node scripts/hatchable-source-parity.mjs manifest.json sourceRoot');
  const result=auditHatchableSourceParity(JSON.parse(readFileSync(input,'utf8')),root);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.byteExactParity)process.exitCode=1;
 }catch(error){process.stderr.write('hatchable-source-parity: '+String(error.message)+'\n');process.exitCode=2}
}
