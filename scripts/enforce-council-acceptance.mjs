#!/usr/bin/env node
// Fail-closed release check on trusted main; never imports or executes PR source.
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {evaluateCouncilAcceptance} from '../src/council-release-gate.mjs';

function read(path){
 if(typeof path!=='string'||!path||path.includes('..'))return null;
 try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}
}
const sourceSha=process.env.TARGET_SOURCE_SHA;
const baseSha=process.env.TARGET_BASE_SHA;
const prNumber=Number(process.env.ITEM_NUMBER);
const dir=process.env.COUNCIL_EVIDENCE_DIRECTORY||'.';
const report=read(join(dir,'council-members.json'));
const receipt=read(join(dir,'council-receipt.json'));
const overrideComment=read(process.env.COUNCIL_OVERRIDE_FILE);
const result=evaluateCouncilAcceptance({report,receipt,sourceSha,baseSha,
 prNumber,overrideComment,
 ownerPublicJwk:process.env.ULTRON_OWNER_SIGNING_PUBLIC_JWK});
writeFileSync('council-release-gate.json',JSON.stringify(result,null,2)+'\n');
const summary=[
 '## Council release gate',
 '**Decision:** '+result.status,
 '**PR:** #'+String(prNumber),
 '**Head:** '+String(sourceSha),
 '**Base:** '+String(baseSha),
 '**Role approvals:** '+result.approvedCount+'/7',
 '**Held roles:** '+(result.holdRoles.join(', ')||'none'),
 '**Model-backed hold/unavailable:** '+(result.modelHoldRoles?.join(', ')||'none'),
 '**Override signature:** '+(result.overrideSignatureVerified?'P-256 verified':'not verified'),
 '**Override:** '+(result.overrideUsed?
   'OWNER EXACT-COMMIT EXCEPTION #'+result.overrideCommentId:
   'none'),
 'Seven logical role votes are not seven independent authenticated GitHub accounts.',
 'No Council decision overrides required source tests, GitHub branch protection,',
 'cryptographic live-write authority, or deployment gates.'
].join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
if(result.status==='held'){
 console.error('COUNCIL_7OF7_REQUIRED: '+result.reason);
 process.exitCode=1;
}
