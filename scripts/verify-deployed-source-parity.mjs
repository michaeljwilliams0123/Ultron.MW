#!/usr/bin/env node
/**
 * OFFLINE source-to-Hatchable manifest SHA-256 verifier.
 * Usage: node scripts/verify-deployed-source-parity.mjs manifest.json cloud/hatchable
 * Does not fetch, sign, submit, read configuration or certify runtime authority.
 */
import {readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {deploymentArtifactDigest} from '../cloud/hatchable/lib/deployment-release-receipt/read.js';

function fail(reason){
 process.stdout.write(JSON.stringify({verified:false,error:reason})+'\n');
 process.exitCode=1;
}
const [manifestArg,sourceArg]=process.argv.slice(2);
if(!manifestArg||!sourceArg){
 fail('usage-manifest-and-source-required');
}else{
 try{
  const manifest=JSON.parse(readFileSync(manifestArg,'utf8'));
  if(!Array.isArray(manifest)||manifest.length===0)
   throw Error('manifest-invalid');
  const root=resolve(sourceArg),seen=new Set();
  for(const file of manifest){
   const path=file?.path;
   if(typeof path!=='string'||!path||isAbsolute(path)||
    path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..')||
    typeof file.hash!=='string'||!/^[a-f0-9]{64}$/.test(file.hash))
    throw Error('manifest-invalid-path');
   if(seen.has(path))throw Error('manifest-duplicate-path');
   seen.add(path);
  }
  const artifactDigest=deploymentArtifactDigest(manifest.map(x=>({
   path:x.path,hash:x.hash
  })));
  let matched=0,missing=0,different=0;
  const failures=[];
  for(const file of manifest){
   const full=resolve(root,...file.path.split('/'));
   const rel=relative(root,full);
   if(rel.startsWith('..')||isAbsolute(rel))
    throw Error('manifest-invalid-path');
   let bytes;
   try{bytes=readFileSync(full);}catch(e){
    if(e?.code==='ENOENT'){missing++;failures.push({path:file.path,state:'MISSING'});continue;}
    throw e;
   }
   const observed=createHash('sha256').update(bytes).digest('hex');
   if(observed===file.hash)matched++;
   else{different++;failures.push({path:file.path,state:'DIFFERENT'});}
  }
  const verified=missing===0&&different===0;
  process.stdout.write(JSON.stringify({
   schema:'ultron.offline-source-manifest-parity.v1',
   verified,manifestFileCount:manifest.length,
   matched,missing,different,artifactDigest,failures
  })+'\n');
  if(!verified)process.exitCode=1;
 }catch(e){
  const allowed=new Set(['manifest-invalid','manifest-invalid-path',
   'manifest-duplicate-path','deployment-files-invalid']);
  fail(allowed.has(e?.message)?e.message:'manifest-readback-unavailable');
 }
}
