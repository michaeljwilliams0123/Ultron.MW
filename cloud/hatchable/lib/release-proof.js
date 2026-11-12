/* Release evidence envelope. Immutable observation, not a release authorization.
 * A green source check cannot substitute for authenticated live deployment evidence.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^sha256:[a-f0-9]{64}$/;
const ROLES=Object.freeze(['architect','security','sre','qa','scope','devils_advocate','judge']);
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
export async function buildReleaseProof({commitSha,ci,councilChecks=[],expectedAppIds={},
 deployment={}}={}){
 if(!SHA.test(commitSha||''))throw Error('release-proof-invalid-sha');
 const ciValid=ci?.verified===true&&ci?.status==='verified'&&
  ci?.headSha===commitSha&&ci?.workflowId===388875616&&
  Number.isSafeInteger(ci?.runId)&&ci.runId>0;
 const appIds=ROLES.map(role=>expectedAppIds[role]);
 const councilValid=appIds.every(x=>Number.isSafeInteger(x)&&x>0)&&
  new Set(appIds).size===7&&Array.isArray(councilChecks)&&
  ROLES.every(role=>councilChecks.filter(c=>c?.name==='council/'+role&&
    c?.head_sha===commitSha&&c?.app?.id===expectedAppIds[role]&&
    c?.status==='completed'&&c?.conclusion==='success').length===1);
 const deploymentValid=deployment?.target?.startsWith('hatchable-v')&&
  deployment?.sourceSha===commitSha&&DIGEST.test(deployment?.artifactDigest||'')&&
  typeof deployment?.receiptId==='string'&&deployment.receiptId.length>0&&
  deployment?.independentReadback===true;
 const verified=!!(ciValid&&councilValid&&deploymentValid);
 const envelope={schema:'ultron.release-proof.v1',repo:REPO,commitSha,
  status:verified?'verified':'unverified-drift',verified,
  ci:Object.freeze({workflowPath:'.github/workflows/verify.yml',workflowId:388875616,
   runId:ci?.runId??null,verified:ciValid}),
  council:Object.freeze({quorum:councilValid?'7/7':'unverified',
   distinctAppIds:new Set(councilChecks.map(c=>c?.app?.id).filter(Boolean)).size,
   verified:councilValid}),
  deployment:Object.freeze({target:deployment?.target??null,
   artifactDigest:deployment?.artifactDigest??null,receiptId:deployment?.receiptId??null,
   sourceSha:deployment?.sourceSha??null,verified:!!deploymentValid})};
 return Object.freeze({...envelope,evidenceSha256:await hash(JSON.stringify(envelope))});
}
