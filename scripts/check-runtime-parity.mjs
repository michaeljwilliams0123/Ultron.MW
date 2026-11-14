#!/usr/bin/env node
/**
 * Byte-exact, build-time drift check for intentionally mirrored deploy assets.
 * The authored file is first in each pair. This is a verification-only tool:
 * it never copies files, mutates a deployment, or acquires credentials.
 *
 * Deliberate adapters (master-pipeline Hatchable stub and continuum-ack's
 * source re-export) are excluded; they have their own dedicated tests.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PARITY_PAIRS=Object.freeze([
 ['src/composio-v3-policy.mjs','cloud/hatchable/lib/composio-v3-policy.js'],
 ['src/identity/github-app-installation-proof.mjs','cloud/hatchable/lib/github-app-installation-proof.js'],
 ['src/ci-evidence.mjs','cloud/hatchable/lib/ci-evidence.js'],
 ['src/scheduler/slot-ledger.mjs','cloud/hatchable/lib/slot-ledger.js'],
 ['src/council/trusted-evaluator.mjs','cloud/hatchable/lib/trusted-evaluator.js'],
 ['src/evidence/release-proof.mjs','cloud/hatchable/lib/release-proof.js'],
 ['lib/c06-model-candidate.js','cloud/hatchable/lib/c06-model-candidate.js'],
 ['lib/c06-owner-safe.mjs','cloud/hatchable/lib/c06-owner-safe.js'],
 ['cloud/hatchable/public/favicon.svg','docs/favicon.svg'],
 ['cloud/hatchable/public/browser-vault.mjs','docs/browser-vault.mjs'],
 ['cloud/hatchable/public/app.js','docs/app.js'],
 ['cloud/hatchable/public/council-front-door.js','docs/council-front-door.js'],
 ['cloud/hatchable/public/browser-brain.mjs','docs/browser-brain.mjs'],
 ['cloud/hatchable/public/core/cloud-status.mjs','docs/core/cloud-status.mjs'],
 ['cloud/hatchable/public/core/codex-authors.mjs','docs/core/codex-authors.mjs'],
 ['cloud/hatchable/public/core/capabilities.mjs','docs/core/capabilities.mjs'],
 ['cloud/hatchable/public/core/cycle.mjs','docs/core/cycle.mjs'],
 ['cloud/hatchable/public/core/cloud-submit.mjs','docs/core/cloud-submit.mjs'],
 ['cloud/hatchable/public/core/cloud-pr-submit.mjs','docs/core/cloud-pr-submit.mjs'],
]);
const sha256=buf=>createHash('sha256').update(buf).digest('hex');
const directory=root=>root instanceof URL?fileURLToPath(root):resolve(root);
const read=async(path)=>{try{return await readFile(path);}catch(e){
 if(e?.code==='ENOENT')return null;
 throw e;
}};

export async function auditRuntimeParity({root=new URL('../',import.meta.url),pairs=PARITY_PAIRS}={}){
 const base=directory(root),mismatches=[];
 for(const [source,target] of pairs){
  const [a,b]=await Promise.all([read(resolve(base,source)),read(resolve(base,target))]);
  if(!a||!b){
   mismatches.push({source,target,reason:!a?'missing-source':'missing-target'});
   continue;
  }
  const sourceSha256=sha256(a),targetSha256=sha256(b);
  if(sourceSha256!==targetSha256)
   mismatches.push({source,target,reason:'sha256-mismatch',sourceSha256,targetSha256});
 }
 return {schema:'ultron.build-runtime-parity.v1',checked:pairs.length,mismatches};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const report=await auditRuntimeParity();
  if(report.mismatches.length){
   console.error(JSON.stringify(report));
   process.exitCode=1;
  }else console.log('Runtime source→Hatchable and Hatchable→Pages parity: '+report.checked+' mirrors verified');
 }catch(e){console.error('Runtime parity unavailable: '+(e?.code||'unexpected-error'));process.exitCode=1;}
}
