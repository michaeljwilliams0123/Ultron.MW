/** Read-only owner release-proof view.
 * The release is explicitly unverified until independent Council and
 * deployment readbacks exist; source CI alone is never promoted to release.
 */
import {collectConnectivity} from './connectivity-view.js';
import {buildReleaseProof} from './release-proof.js';
import {collectMergedCouncilReadback} from './release-github-readback.js';
import {findDeploymentReleaseReceipt} from './deployment-release-receipt.js';
import {verifyLiveHatchableManifest} from './hatchable-manifest-readback.js';
import {createAuthenticatedGithubReleaseFetch} from './github-operator-release-fetch.js';
export async function readCanonicalReleaseProof({db,config,api}){
 // Reuse connected dedicated GitHub OAuth. Anonymous fetch is rate-limited
 // to 60/hour and must never silently replace authenticated readback.
 const fetchGithub=createAuthenticatedGithubReleaseFetch({
  call:(name,args)=>api.call(name,args)
 });
 const observation=await collectConnectivity({db,fetchGithub});
 const sha=observation.github?.mainSha;
 if(!/^[a-f0-9]{40}$/.test(sha||'')){
  return {schema:'ultron.release-proof.v1',verified:false,
   status:'unverified-drift',reason:'current-main-not-observed'};
 }
 const ci=observation.ci;
 // Authenticated GitHub metadata independently binds a merged PR source head to
 // current main, then reads the dedicated Council App check on that source.
 // An absent, ambiguous or failed read remains unverified, never invented.
 const councilSource=await collectMergedCouncilReadback({commitSha:sha,fetchGithub});
 let deploymentRow=null;
 try{deploymentRow=await findDeploymentReleaseReceipt({db,sourceSha:sha});}catch{}
 // The standing-policy receipt is a separate, tightly scoped authority path.
 // Join the immutable claim, its policy and exact receipt/grant binding.
 try{
  const observed=await db.query(
   "SELECT r.id,r.target,r.source_sha,r.artifact_digest,r.manifest_file_count,r.independent_readback,r.grant_id FROM brain_deployment_release_receipts r JOIN brain_autonomous_release_claims c ON c.receipt_id=r.id JOIN brain_standing_release_policies p ON p.policy_id=c.policy_id JOIN brain_authority_grants g ON g.grant_id=r.grant_id WHERE r.source_sha=$1 AND r.independent_readback AND c.decision='authorized' AND c.project_id='proj_A6GCXRSKizko' AND c.target=r.target AND c.source_sha=r.source_sha AND c.artifact_digest=r.artifact_digest AND c.policy_sha256=r.policy_sha AND p.policy_sha256=c.policy_sha256 AND p.policy_version=c.policy_version AND g.actor='github:standing-policy-v1' AND g.operation='cloud.release-receipt.record' AND g.objective_id=r.receipt_key AND g.policy_sha=r.policy_sha AND g.resource='hatchable:deployment:proj_A6GCXRSKizko:'||r.target||':'||r.artifact_digest||':source:'||r.source_sha ORDER BY r.id DESC LIMIT 1",[sha]);
  const standing=observed?.rows?.[0];
  if(standing&&(!deploymentRow||Number(standing.id)>Number(deploymentRow.id)))deploymentRow=standing;
 }catch{}
 const liveManifest=deploymentRow
  ?await verifyLiveHatchableManifest({deploymentRow,config,fetchGithub})
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
 return {...proof,
  driftDetails:{ciVerified:proof.ci.verified,councilVerified:proof.council.verified,
   deploymentReceiptRecorded:!!deploymentRow,
   independentManifestReadback:Boolean(liveManifest?.verified),
   manifestReason:liveManifest?.reason||null,
   sourceAttribution:liveManifest?.sourceAttribution||null,
   attestorRunId:liveManifest?.attestorRunId||null,
   attestorArtifactId:liveManifest?.attestorArtifactId||null,missingGates},
  observation:{ciState:ci?.state??'unavailable',
  councilSourceState:councilSource.councilCheck?'observed':'unavailable',
  deploymentState:liveManifest?.state||(deploymentRow?'receipt-only-unverified':'unavailable'),
  runtimeState:observation.runtime?.state??'unavailable'}};
}
