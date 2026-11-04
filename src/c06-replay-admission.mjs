/** Approval envelope for a previous genuine, independently scored C06 model artifact.
 * This is NOT an inference or credential-grant path. A replay is allowed only
 * when latest protected main is a descendant of the original model source and
 * the generator/evaluator/validator/test toolchain bytes have not changed.
 */
const SHA=/^[a-f0-9]{40}$/;
const RUN=/^[1-9][0-9]{0,19}$/;
export const C06_REPLAY_PINNED_PATHS=Object.freeze([
 '.github/workflows/c06-owner-model-release.yml',
 'scripts/c06-run-model.mjs',
 'scripts/c06-verify-output.mjs',
 'src/c06-model-origin.mjs',
 'src/hf-free-compute.mjs',
 'src/hf-repair-output.mjs',
 'package.json',
 'package-lock.json',
 'scripts/verify-audited-lockfile.mjs',
 'test/c06-model-origin.test.mjs'
]);
export const C06_REPLAY_OUTPUT_PATHS=Object.freeze([
 'lib/c06-model-candidate.js',
 'test/c06-model-generated.test.mjs',
 'docs/c06-model-generated.md'
]);
/** Existing paths are not a collision. Only an exact no-op content replay is. */
export function hasNovelC06Outputs(existing,generated){
 const invalid=()=>{throw Error('c06-replay-admission-denied');};
 if(!existing||typeof existing!=='object'||Array.isArray(existing)||
  !generated||typeof generated!=='object'||Array.isArray(generated))
  invalid();
 const keys=Object.keys(generated).sort().join(',');
 if(keys!==[...C06_REPLAY_OUTPUT_PATHS].sort().join(','))invalid();
 if(Object.keys(existing).some(key=>!C06_REPLAY_OUTPUT_PATHS.includes(key))||
  C06_REPLAY_OUTPUT_PATHS.some(path=>typeof generated[path]!=='string'||
   (Object.hasOwn(existing,path)&&typeof existing[path]!=='string')))
  invalid();
 return C06_REPLAY_OUTPUT_PATHS.some(path=>existing[path]!==generated[path]);
}
export function admitC06Replay(input={}){
 const invalid=()=>{throw Error('c06-replay-admission-denied');};
 if(input.repository!=='michaeljwilliams0123/Ultron.MW'||
  input.actor!=='michaeljwilliams0123'||
  input.publicRepository!==true||input.paidBudgetCents!==0||
  !SHA.test(input.sourceSha||'')||!SHA.test(input.mainSha||'')||
  !RUN.test(String(input.runId||''))||
  input.isOriginalAncestor!==true||input.alreadyPublished!==false||
  !Array.isArray(input.changedModelToolchainPaths)||
  input.changedModelToolchainPaths.length!==0)
  invalid();
 return Object.freeze({schema:'ultron.c06.model-replay-admission.v1',
  repository:input.repository,originSha:input.sourceSha,mainSha:input.mainSha,
  runId:String(input.runId),branch:'ultron/c06-model-'+input.runId,
  paidBudgetCents:0,provenanceRequired:true,
  modelExecutionPermitted:false,productionAccepted:false});
}
