import test from 'node:test';
import assert from 'node:assert/strict';
import {isCouncilGovernanceRepairPr,assertCouncilRepairManifest} from '../src/council-governance-repair-admission.mjs';

const REPO='michaeljwilliams0123/Ultron.MW',ID=1424939667;
const SHA='a'.repeat(40),BASE='b'.repeat(40);
const marker='<!-- ULTRON_COUNCIL_REPAIR_PR_V1 -->';
function fixture(){
 return {number:397,state:'open',body:marker+'\n## Bounded Council source repair',
  head:{ref:'governance/council-7of7-20261110',sha:SHA,
    repo:{id:ID,full_name:REPO}},
  base:{ref:'main',sha:BASE,repo:{id:ID,full_name:REPO}}};
}
function entry(path){return {path,before:'old',after:'new'};}
const sourcePath='src/council-members.mjs',testPath='test/council-members.test.mjs';

test('canonical marked same-repo Council governance PR is eligible for an owner-authorized repair',()=>{
 assert.equal(isCouncilGovernanceRepairPr(fixture()),true);
});
test('unmarked, unrelated, closed, spoofed or fork governance PR is not eligible',()=>{
 const changes=[
  p=>{p.body='not admitted';},
  p=>{p.head.ref='feature/council-7of7-20261110';},
  p=>{p.head.ref='governance/council-../evil';},
  p=>{p.number=0;},
  p=>{p.state='closed';},
  p=>{p.head.sha='invalid';},
  p=>{p.base.sha='invalid';},
  p=>{p.head.repo.id=9;},
  p=>{p.base.repo.full_name='untrusted/Ultron.MW';},
  p=>{p.base.ref='release';}
 ];
 for(const change of changes){
  const p=fixture();change(p);
  assert.equal(isCouncilGovernanceRepairPr(p),false);
 }
});
test('source and matching regression test are required together',()=>{
 assert.equal(assertCouncilRepairManifest(fixture(),{changes:[
   entry(sourcePath),entry(testPath)
 ]}),true);
 assert.throws(()=>assertCouncilRepairManifest(fixture(),{changes:[entry(sourcePath)]}),
   /regression|paired|scope/i);
 assert.throws(()=>assertCouncilRepairManifest(fixture(),{changes:[
   entry(sourcePath),entry('test/council-trusted-gate.test.mjs')
 ]}),/regression|paired|scope|denied/i);
});
test('arbitrary and security-sensitive source, workflows, signer and gate changes are forbidden',()=>{
 for(const path of [
  '.github/workflows/council-debate.yml',
  'src/council-release-gate.mjs',
  'src/council-trusted-gate.mjs',
  'test/council-trusted-gate.test.mjs',
  'config/council-owner-signing-key.json',
  'src/pr-brain.mjs',
  'src/council-app-identities.mjs',
  'src/security/crypto_auth.ts',
  'scripts/enforce-council-acceptance.mjs',
  'docs/../../.github/evil.yml',
  'test/malicious.test.mjs'
 ]){
  assert.throws(()=>assertCouncilRepairManifest(fixture(),{changes:[entry(path)]}),
    /scope|path|denied/i,path);
 }
});
test('a test-only or evidence-document edit is allowed without impersonating Council approval',()=>{
 assert.equal(assertCouncilRepairManifest(fixture(),{changes:[entry(testPath)]}),true);
 assert.equal(assertCouncilRepairManifest(fixture(),{changes:[
   entry('docs/COUNCIL-7OF7-ENFORCEMENT.md')
 ]}),true);
});
test('too many changes, duplicate paths, and unmarked proposals fail closed',()=>{
 const r=fixture();
 assert.throws(()=>assertCouncilRepairManifest(r,{changes:[entry(testPath),entry(testPath)]}),
   /duplicate|scope|path/i);
 assert.throws(()=>assertCouncilRepairManifest(r,{changes:[]}),/scope|changes/i);
 assert.throws(()=>assertCouncilRepairManifest(r,{changes:Array.from({length:5},()=>entry(testPath))}),
  /scope|changes/i);
 const unmarked=fixture();unmarked.body='';
 assert.throws(()=>assertCouncilRepairManifest(unmarked,{changes:[entry(testPath)]}),
   /governance|scope|admission/i);
});
