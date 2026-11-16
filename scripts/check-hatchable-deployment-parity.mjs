#!/usr/bin/env node
/** Read-only comparison of GitHub source at exact SHA with a separately fetched
 * Hatchable get_deployment(version).file_manifest JSON array. Never marks a
 * release accepted; this tool does not obtain signing or provider credentials.
 * Usage: node scripts/check-hatchable-deployment-parity.mjs --source SHA --manifest FILE --version INT
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareHatchableDeployment} from '../src/evidence/hatchable-deployment-parity.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const root=fileURLToPath(new URL('../',import.meta.url));
const SKIP=new Set(['README.md','OPENAI-AGENTS-INTEGRATION.md']);
export function collectSourceFiles({sha,git=(args)=>execFileSync('git',['-C',root,...args],{
 maxBuffer:16*1024*1024})}={}){
 if(!/^[0-9a-f]{40}$/.test(sha??''))throw Error('invalid-pinned-source-sha');
 const paths=git(['ls-tree','-r','-z','--name-only',sha,'--','cloud/hatchable/'])
  .toString('utf8').split('\0').filter(Boolean);
 if(!paths.length||paths.length>1000)throw Error('source-file-list-invalid');
 return paths.map(full=>{
  const path=full.slice('cloud/hatchable/'.length);
  if(SKIP.has(path))return null;
  const bytes=git(['show',sha+':'+full]);
  if(bytes.length>8*1024*1024)throw Error('source-file-too-large');
  return {path,sha256:hash(bytes),
   ...(bytes.length&&bytes[bytes.length-1]===10?{
    withoutFinalLfSha256:hash(bytes.subarray(0,-1))}:{}),
  };
 }).filter(Boolean);
}
export function run(args,sourceCollector=collectSourceFiles){
 if(args.length!==6||args[0]!=='--source'||args[2]!=='--manifest'||args[4]!=='--version')
  throw Error('usage: --source SHA --manifest FILE --version INTEGER');
 const [,sourceSha,,manifestPath,,versionString]=args;
 if(!/^[1-9][0-9]*$/.test(versionString))throw Error('version-invalid');
 const decoded=JSON.parse(readFileSync(resolve(manifestPath),'utf8'));
 if(!Array.isArray(decoded)&&!(decoded&&decoded.version===Number(versionString)&&
   Array.isArray(decoded.file_manifest)))throw Error('manifest-input-invalid');
 const deployedFiles=Array.isArray(decoded)?decoded:decoded.file_manifest;
 return compareHatchableDeployment({sourceSha,version:Number(versionString),
  sourceFiles:sourceCollector({sha:sourceSha}),deployedFiles:deployedFiles.filter(f=>f.path!=='README.md')});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=run(process.argv.slice(2));
  console.log(JSON.stringify(result));
  if(!result.byteExact)process.exitCode=1;
 }catch(e){console.error('Deployment parity unverified: '+String(e.message).slice(0,150));
  process.exitCode=2;}
}
