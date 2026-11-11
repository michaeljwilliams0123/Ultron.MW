import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCouncilAcceptance,validateOwnerOverride} from '../src/council-release-gate.mjs';

const HEAD='a'.repeat(40),BASE='b'.repeat(40),PR=456;
const names=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
const roles=names.map(name=>'ultron-'+name.toLowerCase());
function facts(){
 return {
  report:{itemNumber:PR,isPr:true,sourceSha:HEAD,hold:false,
    memberAssessments:names.map(name=>({identity:{role:name},verdict:'proceed'}))},
  receipt:{decision:'proceed',publication:{members:roles.map(roleId=>({
    roleId,conclusion:'proceed',unknowns:[],dissentTags:[],evidenceRefs:['case:exact-head']
  }))}}
 };
}
const evaluate=(patch={},extra={})=>evaluateCouncilAcceptance({
 ...facts(),prNumber:PR,sourceSha:HEAD,baseSha:BASE,now:'2026-11-10T21:00:00.000Z',
 ...patch,...extra
});
function owner(body){
 return {id:9876,user:{login:'michaeljwilliams0123',id:308995719},
   body,created_at:'2026-11-10T20:45:00Z',updated_at:'2026-11-10T20:45:00Z'};
}
const overrideBody=(head=HEAD,base=BASE)=>
 '/council override '+head+' '+base+' -- Owner explicitly authorizes this exact Council exception after security review.';
test('all seven exact roles must approve on the same PR head with full evidence',()=>{
 const result=evaluate();
 assert.equal(result.status,'accepted');
 assert.equal(result.approvedCount,7);
 assert.equal(result.overrideUsed,false);
 assert.deepEqual(result.holdRoles,[]);
});
test('one hold makes the decision HOLD, even if six approve',()=>{
 const f=facts();f.report.memberAssessments[1].verdict='hold';
 const result=evaluate(f);
 assert.equal(result.status,'held');
 assert.equal(result.approvedCount,6);
 assert.deepEqual(result.holdRoles,['Skeptic']);
});
test('missing, duplicate, unknown and fake roles never reach 7/7',()=>{
 for(const mutate of [
  f=>f.report.memberAssessments.pop(),
  f=>f.report.memberAssessments[6].identity.role='Builder',
  f=>f.receipt.publication.members[6].roleId='ultron-pretender',
  f=>f.receipt.publication.members.pop()
 ]){const f=facts();mutate(f);assert.equal(evaluate(f).status,'held');}
});
test('source drift, governor HOLD, open unknown or dissent hold even at 7 vote labels',()=>{
 const bad=[
  f=>{f.report.sourceSha='c'.repeat(40);},
  f=>{f.report.hold=true;},
  f=>{f.receipt.decision='hold';},
  f=>{f.receipt.publication.members[0].unknowns=['not-verified'];},
  f=>{f.receipt.publication.members[0].dissentTags=['security'];},
  f=>{f.receipt.publication.members[0].evidenceRefs=[];},
 ];
 for(const mutate of bad){const f=facts();mutate(f);assert.equal(evaluate(f).status,'held');}
});
test('missing report is never accepted, even with an owner override comment',()=>{
 assert.equal(evaluate({report:null,overrideComment:owner(overrideBody())}).status,'held');
});
test('explicit owner override is allowed only on exact current head/base and is auditable',()=>{
 const f=facts();f.report.memberAssessments[1].verdict='hold';
 const result=evaluate({...f,overrideComment:owner(overrideBody())});
 assert.equal(result.status,'owner-overridden');
 assert.equal(result.approvedCount,6);
 assert.equal(result.overrideUsed,true);
 assert.equal(result.overrideCommentId,9876);
 assert.ok(result.holdRoles.includes('Skeptic'));
});
test('comment authored by a bot or collaborator is not a valid owner override',()=>{
 for(const user of [{login:'michaeljwilliams0123ultron',id:354634860},
                    {login:'michaeljwilliams0123',id:999},
                    {login:'github-actions[bot]',id:308995719}]){
  const c=owner(overrideBody());c.user=user;
  assert.equal(validateOwnerOverride(c,{sourceSha:HEAD,baseSha:BASE,
     now:'2026-11-10T21:00:00.000Z'}),null);
 }
});
test('no implicit override: exact syntax, SHA, base, immutable comment and freshness mandatory',()=>{
 const cases=[
  owner('/council approve '+HEAD),
  owner('/council override '+HEAD+' -- missing base'),
  owner(overrideBody('c'.repeat(40))),
  owner(overrideBody(HEAD,'c'.repeat(40))),
  {...owner(overrideBody()),updated_at:'2026-11-10T20:47:00Z'},
  {...owner(overrideBody()),created_at:'2026-11-07T21:00:00Z',updated_at:'2026-11-07T21:00:00Z'},
  {...owner(overrideBody()),created_at:'2026-11-11T21:00:00Z',updated_at:'2026-11-11T21:00:00Z'},
 ];
 for(const c of cases)assert.equal(validateOwnerOverride(c,{sourceSha:HEAD,
   baseSha:BASE,now:'2026-11-10T21:00:00.000Z'}),null);
});
test('owner override never overwrites Council role evidence',()=>{
 const f=facts();f.report.memberAssessments[2].verdict='hold';
 const r=evaluate({...f,overrideComment:owner(overrideBody())});
 assert.equal(r.approvedCount,6);
 assert.deepEqual(r.holdRoles,['Steward']);
 assert.equal(r.status,'owner-overridden');
});
