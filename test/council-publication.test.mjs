import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCouncilPublication,alreadyPublished,COUNCIL_ROLES}
 from '../src/council-publication.mjs';

const positions=()=>COUNCIL_ROLES.map((role,i)=>({
  individualId:role,conclusion:i===1?'hold':'proceed',
  confidence:0.9-i*.05,evidenceRefs:['plan:sha256:'+'a'.repeat(64)],
  unknowns:i===1?['independent-review-missing']:[],
  dissentTags:i===1?['release-gate']:[],
}));
const base=()=>({title:'Repair App exact-head CI',body:'Read scoped PR evidence.',
  isPr:true,sourceSha:'a'.repeat(40),ownerMode:false,
  positions:positions()});

test('RED: same evidence gives the same council publication ID despite different timestamps',()=>{
  const a=buildCouncilPublication({...base(),observedAt:'2026-11-01T10:00:00Z'});
  const b=buildCouncilPublication({...base(),observedAt:'2026-11-01T11:00:00Z'});
  assert.equal(a.fingerprint,b.fingerprint);
  assert.equal(a.members.length,7);
  assert.equal(new Set(a.members.map(m=>m.roleId)).size,7);
  assert.deepEqual(a.members.map(m=>m.roleId),COUNCIL_ROLES);
  assert.ok(a.members.every(m=>m.identityStatus==='unbound'&&m.githubPrincipal===null&&m.modelBacked===false));
  assert.notEqual(a.members[0].fingerprint,a.members[1].fingerprint);
  assert.equal(a.members[1].conclusion,'hold');
  assert.ok(a.members[1].unknowns.includes('independent-review-missing'));
});
test('RED: changing actual source, evidence, or role dissent changes the publication ID',()=>{
  const initial=buildCouncilPublication(base());
  assert.notEqual(initial.fingerprint,buildCouncilPublication({...base(),sourceSha:'b'.repeat(40)}).fingerprint);
  assert.notEqual(initial.fingerprint,buildCouncilPublication({...base(),body:'New owner constraint'}).fingerprint);
  const changed=positions();changed[1]={...changed[1],dissentTags:['new-security-gate']};
  assert.notEqual(initial.fingerprint,buildCouncilPublication({...base(),positions:changed}).fingerprint);
});
test('RED: only a previously posted GitHub Actions report, not owner text, can establish dedupe',()=>{
  const report=buildCouncilPublication(base());
  const body='# Ultron Council Report\n'+report.marker+'\n';
  assert.equal(alreadyPublished(report,[]),false);
  assert.equal(alreadyPublished(report,[{user:{login:'michaeljwilliams0123'},body}]),false);
  assert.equal(alreadyPublished(report,[{user:{login:'github-actions[bot]'},body}]),true);
  assert.equal(alreadyPublished(report,[{user:{login:'github-actions[bot]'},
    body:'# Ultron Council Report\n<!-- ultron-council-evidence-v2:'+'f'.repeat(64)+' -->'}]),false);
});
test('RED: council workflow suppresses identical reports and discloses identities and no model inference',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
  const script=readFileSync(new URL('../scripts/council-debate.mjs',import.meta.url),'utf8');
  assert.match(yaml,/alreadyPublished/);
  assert.match(yaml,/github\.paginate/);
  assert.match(yaml,/github\.event\.inputs\.item_number/);
  assert.match(yaml,/cancel-in-progress: false/);
  assert.match(script,/buildCouncilPublication/);
  assert.match(script,/Individual GitHub principals/);
  assert.match(script,/modelInvocations=0/);
});
