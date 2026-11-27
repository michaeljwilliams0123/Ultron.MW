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


/** Parse additive v3 diagnostics from the dedicated publisher, not authorization.
 * Hash detects corruption; GitHub App provenance authenticates the readback.
 * A shadow result never satisfies trustedGateDecision or changes proof digests.
 */
export async function readAdaptiveCouncilShadow(check,{sourceSha,baseSha,prNumber}={}){
 if(!SHA.test(sourceSha||'')||!SHA.test(baseSha||'')||!Number.isSafeInteger(prNumber)||prNumber<1||
  !Number.isSafeInteger(check?.id)||check.id<1||check.name!==GATE.name||check.head_sha!==sourceSha||
  check.app?.id!==GATE.id||check.app?.slug!==GATE.slug||check.status!=='completed'||
  !['success','failure'].includes(check.conclusion)||typeof check.output?.summary!=='string')return null;
 const lines=check.output.summary.split('\n');
 const field=name=>{const prefix='**'+name+':** ';const values=lines.filter(l=>l.startsWith(prefix));return values.length===1?values[0].slice(prefix.length):null;};
 if(field('PR')!=='#'+prNumber||field('Head')!==sourceSha)return null;
 const raw=field('Adaptive shadow'),digest=field('Adaptive shadow SHA-256');
 if(typeof raw!=='string'||raw.length>4096||!/^[a-f0-9]{64}$/.test(digest||'')||await hash(raw)!==digest)return null;
 try{
  const s=JSON.parse(raw),tiers=['administrative','low','standard','high','critical'],thresholds=[4,5,6,7,7];
  if(!s||Object.keys(s).length!==16||s.schema!=='ultron.council-adaptive-shadow.v1'||s.policyVersion!==3||
   s.mode!=='shadow'||s.authorizesMerge!==false||s.sourceSha!==sourceSha||s.baseSha!==baseSha||s.prNumber!==prNumber||
   !Number.isInteger(s.riskTier)||s.riskTier<0||s.riskTier>4||s.riskName!==tiers[s.riskTier]||
   s.requiredCount!==thresholds[s.riskTier]||s.paidSpendAuthorizedUsd!==0||!Number.isInteger(s.approvedCount)||
   s.approvedCount<0||s.approvedCount>7||!['eligible','held'].includes(s.decision)||
   typeof s.reason!=='string'||!/^[a-z0-9-]{1,100}$/.test(s.reason))return null;
  const roles=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
  const modelRoles=['Builder','Skeptic','Sentinel'];
  const list=(a,allowed)=>Array.isArray(a)&&a.length<=allowed.length&&new Set(a).size===a.length&&a.every(x=>allowed.includes(x));
  if(!list(s.nonApprovals,roles)||!list(s.unavailableModels,modelRoles))return null;
  if(s.decision==='eligible'&&(s.riskTier>2||s.approvedCount<s.requiredCount||
   s.approvedCount+s.nonApprovals.length!==7||s.unavailableModels.length>1||s.reason!=='shadow-quorum-satisfied'))return null;
  return Object.freeze({...s,nonApprovals:Object.freeze([...s.nonApprovals]),unavailableModels:Object.freeze([...s.unavailableModels])});
 }catch{return null;}
}

// A shadow result is not authorization. An active decision has a separate
// dedicated-App success envelope bound to the shadow digest and squash base.
export async function readAdaptiveCouncilDecision(check,{sourceSha,baseSha,prNumber}={}){
 if(check?.conclusion!=='success'||check.output?.title!=='Adaptive Council v3 decision on exact head')return null;
 const shadow=await readAdaptiveCouncilShadow(check,{sourceSha,baseSha,prNumber});
 if(shadow?.decision!=='eligible'||shadow.riskTier>2)return null;
 const lines=check.output.summary.split('\n');
 const field=name=>{const prefix='**'+name+':** ';const values=lines.filter(l=>l.startsWith(prefix));return values.length===1?values[0].slice(prefix.length):null;};
 if(field('Decision')!=='accepted-adaptive'||field('Security-sensitive paths')!=='none'||
  field('Role approvals')!==shadow.approvedCount+'/7'||field('Held roles')!==(shadow.nonApprovals.join(', ')||'none')||
  field('Model hold/unavailable')!==(shadow.unavailableModels.join(', ')||'none'))return null;
 const expected=JSON.stringify({schema:'ultron.council-adaptive-decision.v1',policyVersion:3,mode:'active',
  authorizesMerge:true,sourceSha,baseSha,prNumber,shadowDigest:field('Adaptive shadow SHA-256')});
 if(field('Adaptive active')!==expected||field('Adaptive active SHA-256')!==await hash(expected))return null;
 return Object.freeze({mode:shadow.approvedCount+'/7',ownerExceptionUsed:false,policyVersion:3,riskTier:shadow.riskTier,requiredCount:shadow.requiredCount});
}
export async function readTrustedMergedCouncilDecision({commitSha,sourcePr,councilCheck,integrationBaseSha}={}){
 if(!SHA.test(commitSha||''))return null;
 const source=trustedSquashLineage(sourcePr,commitSha);
 if(!source)return null;
 if(councilCheck?.output?.title==='Adaptive Council v3 decision on exact head')
  return readAdaptiveCouncilDecision(councilCheck,{sourceSha:source.headSha,baseSha:integrationBaseSha,prNumber:source.prNumber});
 return trustedGateDecision(councilCheck,source.headSha,source.prNumber);
}
export async function buildReleaseProof({commitSha,ci,councilCheck=null,
 prNumber=null,sourcePr=null,integrationBaseSha=null,deployment={}}={}){
 if(!SHA.test(commitSha||''))throw Error('release-proof-invalid-sha');
 const ciValid=ci?.verified===true&&ci?.status==='verified'&&
  ci?.headSha===commitSha&&ci?.workflowId===388875616&&
  Number.isSafeInteger(ci?.runId)&&ci.runId>0;
 const source=sourcePr===null?null:trustedSquashLineage(sourcePr,commitSha);
 const councilHead=sourcePr===null?commitSha:source?.headSha;
 const councilPr=sourcePr===null?prNumber:source?.prNumber;
 const council=sourcePr!==null?await readTrustedMergedCouncilDecision({commitSha,sourcePr,councilCheck,integrationBaseSha}):
  councilHead?trustedGateDecision(councilCheck,councilHead,councilPr):null;
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
   ownerExceptionUsed:council?.ownerExceptionUsed??false,verified:councilValid,
   ...(council?.policyVersion===3?{policyVersion:3,riskTier:council.riskTier,requiredCount:council.requiredCount}:{})}),
  deployment:Object.freeze({target:deployment?.target??null,
   artifactDigest:deployment?.artifactDigest??null,receiptId:deployment?.receiptId??null,
   sourceSha:deployment?.sourceSha??null,verified:!!deploymentValid})};
 return Object.freeze({...envelope,evidenceSha256:await hash(JSON.stringify(envelope))});
}
