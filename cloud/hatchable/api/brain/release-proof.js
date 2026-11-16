/** Read-only owner release-proof view.
 * The release is explicitly unverified until independent Council and
 * deployment readbacks exist; source CI alone is never promoted to release.
 */
import {db} from 'hatchable';
import {collectConnectivity} from 'lib/connectivity-view.js';
import {buildReleaseProof} from 'lib/release-proof.js';
import {collectMergedCouncilReadback} from 'lib/release-github-readback.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 const observation=await collectConnectivity({db});
 const sha=observation.github?.mainSha;
 if(!/^[a-f0-9]{40}$/.test(sha||'')){
  return res.json({schema:'ultron.release-proof.v1',verified:false,
   status:'unverified-drift',reason:'current-main-not-observed'});
 }
 const ci=observation.ci;
 // Public GitHub metadata independently binds a merged PR source head to
 // current main, then reads the dedicated Council App check on that source.
 // An absent, ambiguous or failed read remains unverified, never invented.
 const councilSource=await collectMergedCouncilReadback({commitSha:sha});
 const proof=await buildReleaseProof({commitSha:sha,
  ci:{verified:ci?.state==='observed'&&ci?.conclusion==='success',
   status:ci?.state==='observed'&&ci?.conclusion==='success'?'verified':'unavailable',
   headSha:ci?.sourceSha,workflowId:388875616,runId:ci?.runId},
  // No deployment assertion is invented. A verified Council check and
  // independent exact-main CI alone cannot prove a deployed artifact.
  councilCheck:councilSource.councilCheck,
  sourcePr:councilSource.sourcePr,deployment:{}});
 return res.json({...proof,observation:{ciState:ci?.state??'unavailable',
  councilSourceState:councilSource.councilCheck?'observed':'unavailable',
  runtimeState:observation.runtime?.state??'unavailable'}});
}
