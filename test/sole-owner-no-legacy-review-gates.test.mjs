import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyMutation} from '../src/mutation-evolution.mjs';

test('mutation classifier asks for owner-authorized security evidence, never an external approver',()=>{
 const result=classifyMutation({baseline:[{id:'owner.core',passed:true,evidenceId:'base-proof'}],
  candidate:[{id:'owner.core',passed:true,evidenceId:'head-proof'},
   {id:'new.action',passed:true,evidenceId:'head-proof-2'}]});
 assert.equal(result.releaseEligible,false,'classification is not execution authority');
 assert.equal(result.ownerSecurityEvidenceRequired,true);
 assert.equal(Object.hasOwn(result,'independentSecurityApprovalRequired'),false,
  'no non-owner security signoff must be emitted');
});

test('Reef provenance does not claim a mandatory second human review',async()=>{
 const source=await readFile(new URL('../scripts/reef-paired-cases.mjs',import.meta.url),'utf8');
 assert.match(source,/caseSetProvenance:'checked-in-evaluator; owner authorization and trusted evaluation required'/);
 assert.doesNotMatch(source,/caseSetProvenance:'checked-in-evaluator; independent review required'/);
});

test('active owner policy and Hatchable UI name the owner as the only human release authority',async()=>{
 const files=await Promise.all([
  '../README.md','../cloud/hatchable/public/index.html',
  '../docs/DESTINY-EXECUTOR-CANARY.md','../docs/UNIFIED-GITHUB-PRINCIPAL.md'
 ].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
 const active=files.join('\n');
 assert.match(active,/No second reviewer or co-signer is required|never another human signer/);
 assert.doesNotMatch(active,/production release and independent reviewer gates remain separate/);
 assert.doesNotMatch(active,/External signer independently bound/);
 assert.doesNotMatch(active,/independent reviewer approved that same SHA/);
});
