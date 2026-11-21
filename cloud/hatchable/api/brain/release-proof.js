/** Read-only owner release-proof view.
 * The release is explicitly unverified until independent Council and
 * deployment readbacks exist; source CI alone is never promoted to release.
 */
import {db,config,api} from 'hatchable';
import {collectConnectivity} from 'lib/connectivity-view.js';
import {buildReleaseProof} from 'lib/release-proof.js';
import {collectMergedCouncilReadback} from 'lib/release-github-readback.js';
import {findDeploymentReleaseReceipt} from 'lib/deployment-release-receipt.js';
import {verifyLiveHatchableManifest} from 'lib/hatchable-manifest-readback.js';
import {createAuthenticatedGithubReleaseFetch} from 'lib/github-operator-release-fetch.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 // Reuse connected dedicated GitHub OAuth. Anonymous fetch is rate-limited
 // to 60/hour and must never silently replace authenticated readback.
 const fetchGithub=createAuthenticatedGithubReleaseFetch({
  call:(name,args)=>api.call(name,args)
 });
 const observation=await collectConnectivity({db,fetchGithub});
 const sha=observation.github?.mainSha;
 if(!/^[a-f0-9]{40}$/.test(sha||'')){
  return res.json({schema:'ultron.release-proof.v1',verified:false,
   status:'unverified-drift',reason:'current-main-not-observed'});
 }
 const ci=observation.ci;
 // Authenticated GitHub metadata independently binds a merged PR source head to
 // current main, then reads the dedicated Council App check on that source.
 // An absent, ambiguous or failed read remains unverified, never invented.
 const councilSource=await collectMergedCouncilReadback({commitSha:sha,fetchGithub});
 let deploymentRow=null;
 try{deploymentRow=await findDeploymentReleaseReceipt({db,sourceSha:sha});}catch{}
 const liveManifest=deploymentRow
  ?await verifyLiveHatchableManifest({deploymentRow,config})
  :null;
 const deployment=deploymentRow?{
  target:deploymentRow.target,sourceSha:deploymentRow.source_sha,
  artifactDigest:deploymentRow.artifact_digest,
  receiptId:'deployment:'+String(deploymentRow.id),
  independentReadback:Boolean(liveManifest?.verified)
 }:{};
 const proof=await buildReleaseProof({commitSha:sha,
  ci:{verified:ci?.state==='observed'&&ci?.conclusion==='success',
   status:ci?.state==='observed'&&ci?.conclusion==='success'?'verified':'unavailable',
   headSha:ci?.sourceSha,workflowId:388875616,runId:ci?.runId},
  councilCheck:councilSource.councilCheck,
  sourcePr:councilSource.sourcePr,deployment});
 const missingGates=[];
 if(!proof.ci.verified)missingGates.push('ci');
 if(!proof.council.verified)missingGates.push('council-7of7');
 if(!deploymentRow)missingGates.push('signed-deployment-receipt');
 if(!liveManifest?.verified)missingGates.push('independent-manifest-readback');
 return res.json({...proof,
  driftDetails:{ciVerified:proof.ci.verified,councilVerified:proof.council.verified,
   deploymentReceiptRecorded:!!deploymentRow,
   independentManifestReadback:Boolean(liveManifest?.verified),
   manifestReason:liveManifest?.reason||null,missingGates},
  observation:{ciState:ci?.state??'unavailable',
  councilSourceState:councilSource.councilCheck?'observed':'unavailable',
  deploymentState:liveManifest?.state||(deploymentRow?'receipt-only-unverified':'unavailable'),
  runtimeState:observation.runtime?.state??'unavailable'}});
}
