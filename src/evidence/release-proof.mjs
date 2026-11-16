/* Trusted Council release proof for the canonical seven logical roles.
 * A single dedicated Gate App publishes an exact-head check; seven distinct
 * GitHub Apps are neither required nor evidence of seven independent votes.
 * This is evidence only, never an authorization or permission to release.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/, DIGEST=/^sha256:[a-f0-9]{64}$/;
const GATE=Object.freeze({id:5765239,slug:'ultron-council-gate',name:'ultron/council-7of7'});
const STRICT_TITLE='7/7 Council roles and model reviews on exact head';
const OWNER_TITLE=/^Signed owner exception #([1-9][0-9]*)$/;
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');

// GitHub's canonical PR association proves which reviewed source became the
// current squash-merge commit. A check on a different PR or repo never counts.
function trustedSquashLineage(pr,mainSha){
 if(!pr||!Number.isSafeInteger(pr.number)||pr.number<1||
  pr.state!=='closed'||pr.draft===true||
  typeof pr.merged_at!=='string'||!Number.isFinite(Date.parse(pr.merged_at))||
  pr.merge_commit_sha!==mainSha||!SHA.test(pr.head?.sha||'')||
  pr.base?.ref!=='main'||pr.base?.repo?.id!==1424939667||
  pr.head?.repo?.id!==1424939667||
  pr.base?.repo?.full_name!==REPO||pr.head?.repo?.full_name!==REPO)
   return null;
 return Object.freeze({headSha:pr.head.sha,prNumber:pr.number});
}

function trustedGateDecision(check,commitSha,prNumber){
 if(!check||!Number.isSafeInteger(check.id)||check.id<1||
  !Number.isSafeInteger(prNumber)||prNumber<1||
  check.name!==GATE.name||check.head_sha!==commitSha||
  check.status!=='completed'||check.conclusion!=='success'||
  check.app?.id!==GATE.id||check.app?.slug!==GATE.slug||
  typeof check.output?.title!=='string'||
  typeof check.output?.summary!=='string')return null;
 // Only the dedicated GitHub App's trusted-main check output is interpreted.
 // Never infer unanimity from seven labels, workflow success or bot comments.
 const lines=check.output.summary.split('\n').map(x=>x.trim());
 const field=(name)=>{
  const prefix='**'+name+':** ';
  const values=lines.filter(x=>x.startsWith(prefix));
  return values.length===1?values[0].slice(prefix.length):null;
 };
 if(field('PR')!=='#'+prNumber||field('Head')!==commitSha)return null;
 const decision=field('Decision'),approvals=field('Role approvals');
 const held=field('Held roles'),modelHolds=field('Model hold/unavailable');
 const paths=field('Security-sensitive paths');
 if(held===null||modelHolds===null||paths===null||
    !/^[0-7]\/7$/.test(approvals||''))return null;
 if(check.output.title===STRICT_TITLE&&decision==='accepted'&&
  approvals==='7/7'&&held==='none'&&modelHolds==='none'&&
  paths==='none')return Object.freeze({mode:'7/7',ownerExceptionUsed:false});
 if(OWNER_TITLE.test(check.output.title)&&decision==='owner-overridden'&&
  paths!=='none')return Object.freeze({mode:'owner-exception',ownerExceptionUsed:true});
 return null;
}

export async function buildReleaseProof({commitSha,ci,councilCheck=null,
 prNumber=null,sourcePr=null,deployment={}}={}){
 if(!SHA.test(commitSha||''))throw Error('release-proof-invalid-sha');
 const ciValid=ci?.verified===true&&ci?.status==='verified'&&
  ci?.headSha===commitSha&&ci?.workflowId===388875616&&
  Number.isSafeInteger(ci?.runId)&&ci.runId>0;
 const source=sourcePr===null?null:trustedSquashLineage(sourcePr,commitSha);
 const councilHead=sourcePr===null?commitSha:source?.headSha;
 const councilPr=sourcePr===null?prNumber:source?.prNumber;
 const council=councilHead?trustedGateDecision(councilCheck,councilHead,councilPr):null;
 const councilValid=council!==null;
 const deploymentValid=deployment?.target?.startsWith('hatchable-v')&&
  deployment?.sourceSha===commitSha&&DIGEST.test(deployment?.artifactDigest||'')&&
  typeof deployment?.receiptId==='string'&&deployment.receiptId.length>0&&
  deployment?.independentReadback===true;
 const verified=!!(ciValid&&councilValid&&deploymentValid);
 const envelope={schema:'ultron.release-proof.v1',repo:REPO,commitSha,
  status:verified?'verified':'unverified-drift',verified,
  ci:Object.freeze({workflowPath:'.github/workflows/verify.yml',workflowId:388875616,
   runId:ci?.runId??null,verified:ciValid}),
  council:Object.freeze({quorum:council?.mode??'unverified',
   distinctAppIds:councilValid?1:0,publisherAppId:councilValid?GATE.id:null,
   checkRunId:councilValid?councilCheck.id:null,
   sourceHeadSha:councilValid?councilHead:null,
   prNumber:councilValid?councilPr:null,
   ownerExceptionUsed:council?.ownerExceptionUsed??false,verified:councilValid}),
  deployment:Object.freeze({target:deployment?.target??null,
   artifactDigest:deployment?.artifactDigest??null,receiptId:deployment?.receiptId??null,
   sourceSha:deployment?.sourceSha??null,verified:!!deploymentValid})};
 return Object.freeze({...envelope,evidenceSha256:await hash(JSON.stringify(envelope))});
}
