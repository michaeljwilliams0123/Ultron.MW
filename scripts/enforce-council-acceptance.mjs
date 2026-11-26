#!/usr/bin/env node
// Fail-closed Council gate evaluation. Runs from a checkout of default main
// only; PR content arrives as JSON data files and is never imported or run.
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {evaluateTrustedCouncilGate,gatePasses} from '../src/council-trusted-gate.mjs';

import {planCouncilRemediation} from '../src/council-hold-remediation.mjs';
import {evaluateAdaptiveShadow} from '../src/council-adaptive-governance.mjs';

function read(path){
 if(typeof path!=='string'||!path||path.includes('..'))return null;
 try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}
}
const dir=process.env.COUNCIL_EVIDENCE_DIRECTORY||'.';
const pr=read(process.env.COUNCIL_PR_FILE);
const filesData=read(process.env.COUNCIL_FILES_FILE);
const report=read(join(dir,'council-members.json'));
const receipt=read(join(dir,'council-receipt.json'));
const overrideComment=read(process.env.COUNCIL_OVERRIDE_FILE);
// Pinned on main and changed only by a reviewed PR (Skeptic H3); never a repo variable.
const ownerPublicJwk=read('config/council-owner-signing-key.json')?.publicJwk??null;
const result=evaluateTrustedCouncilGate({report,receipt,pr,
 files:filesData?.files,filesComplete:filesData?.complete===true,
 overrideComment,ownerPublicJwk});
// Shadow evidence is diagnostic only. The existing result remains the only
// input to gatePasses and the dedicated App publisher.
let adaptiveShadow;
try{
 adaptiveShadow=evaluateAdaptiveShadow({report,receipt,pr,files:filesData?.files,
  filesComplete:filesData?.complete===true,legacy:result,
  ci:read(process.env.COUNCIL_REVIEW_EVIDENCE_FILE),
  roleVerification:read(join(dir,'council-role-attestation-verification.json')),
  taint:read(process.env.COUNCIL_TAINT_EVIDENCE_FILE)});
}catch{
 adaptiveShadow={schema:'ultron.council-adaptive-shadow.v1',mode:'shadow',authorizesMerge:false,decision:'held',reason:'shadow-evaluation-error'};
}
writeFileSync('council-release-gate.json',JSON.stringify({...result,adaptiveShadow},null,2)+'\n');
const pass=gatePasses(result,pr?.head?.sha,pr?.number);
const remediation=planCouncilRemediation({result,receipt,taintEvidence:read(process.env.COUNCIL_TAINT_EVIDENCE_FILE)});
writeFileSync('council-hold-remediation.json',JSON.stringify(remediation,null,2)+'\n');
const summary=[
 '## Council release gate (trusted v2)',
 '**Decision:** '+result.status+(pass?' (pass)':' (HOLD)'),
 '**Reason:** '+String(result.reason||'none'),
 '**PR:** #'+String(pr?.number),
 '**Head:** '+String(pr?.head?.sha),
 '**Base:** '+String(pr?.base?.sha),
 '**Role approvals:** '+result.approvedCount+'/7',
 '**Held roles:** '+(result.holdRoles.join(', ')||'none'),
 '**Model-backed hold/unavailable:** '+(result.modelHoldRoles?.join(', ')||'none'),
 '**Security-sensitive paths:** '+((result.securityPaths||[]).join(', ')||'none'),
 '**Owner key pinned on main:** '+(ownerPublicJwk?'yes':'no (override unavailable)'),
 '**Override:** '+(result.overrideUsed?'SIGNED OWNER EXCEPTION #'+result.overrideCommentId:'none'),
 '**Remediation route:** '+(remediation?.route||'unavailable'),
 '**Adaptive v3 shadow:** '+adaptiveShadow.decision+' ('+adaptiveShadow.reason+'); tier '+String(adaptiveShadow.riskTier??'unknown')+'; quorum '+String(adaptiveShadow.requiredCount??'unknown')+'/7; no merge authority',
 'Seven logical role votes are not seven independent authenticated GitHub accounts.',
 'No Council decision overrides required tests, branch rules or deployment gates.'
].join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
if(!pass){
 console.error('COUNCIL_7OF7_REQUIRED: '+String(result.reason||result.status));
 process.exitCode=1;
}
