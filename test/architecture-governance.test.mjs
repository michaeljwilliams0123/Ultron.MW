import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../docs/governance/',import.meta.url);
async function load(){return JSON.parse(await readFile(new URL('architecture-policy.v1.json',root),'utf8'));}
const expectedGates=[
 'authoritative-component-and-consumer-inventory',
 'versioned-compatibility-matrix',
 'negative-security-and-replay-tests',
 'exact-head-ci',
 'independent-live-provider-postcondition',
 'rollback-and-revocation-evidence',
 'owner-authorized-release',
 'zero-unapproved-paid-spend'
];

test('architecture policy identifies one owner, one source and a non-runtime governance status',async()=>{
 const x=await load();
 assert.equal(x.schema,'ultron.architecture-governance.v1');
 assert.equal(x.status,'review-contract-not-runtime-enforcement');
 assert.equal(x.owner,'michaeljwilliams0123');
 assert.equal(x.repository,'michaeljwilliams0123/Ultron.MW');
 assert.equal(x.cloudProject,'proj_A6GCXRSKizko');
 assert.equal(x.cloudName,'Ultron MW Cloud Brain');
 assert.equal(x.authorities.execution,'Hatchable PostgreSQL');
});

test('architecture governance never declares self-grant, unbounded admin or automatic retirement',async()=>{
 const x=await load();
 const c=x.controls;
 assert.equal(c.llmCanGrantAuthority,false);
 assert.equal(c.ownerApprovalRequiredForNewPrivilegedAction,true);
 assert.equal(c.operationScopedTokens,true);
 assert.equal(c.versionedStopAndPauseRequired,true);
 assert.equal(c.independentReadbackForWrites,true);
 assert.equal(c.unknownWriteOutcome,'reconcile-before-retry');
 assert.equal(c.paidSpendCeilingUsd,0);
 assert.equal(c.protectedMainBypass,false);
 assert.equal(c.automaticRetirement,false);
 assert.deepEqual(x.retirementRequirements,expectedGates);
 assert.equal(new Set(x.retirementRequirements).size,x.retirementRequirements.length);
});

test('transport modernizes without erasing legacy local clients or durable business execution',async()=>{
 const x=await load();
 assert.equal(x.protocol.newRemoteMcp,'2026-07-28');
 assert.equal(x.protocol.modernRemoteTransport,'streamable-http');
 assert.equal(x.protocol.legacyAdapter,'2025-06-18');
 assert.equal(x.protocol.legacyAdapterPolicy,'retain-until-compatibility-parity-and-rollout');
 assert.equal(x.protocol.localStdio,'permitted');
 assert.equal(x.protocol.businessExecutionState,'durable-postgresql');
 assert.match(x.protocol.a2aExternalPeers,/owner-authenticated/);
});

test('only a declared lifecycle can promote a capability; blocked and reconcile are not success',async()=>{
 const x=await load();
 assert.deepEqual(x.lifecycle,['proposed','sandbox','authorized','canary','active','revoked']);
 assert.deepEqual(x.conditionalOutcomes,['blocked','reconcile-required']);
 for(const item of x.componentDecisions){
  assert.ok(['keep','modernize','defer','retire-candidate'].includes(item.decision));
  assert.ok(Number.isSafeInteger(item.issue)&&item.issue>0);
 }
 assert.equal(new Set(x.componentDecisions.map(i=>i.component)).size,x.componentDecisions.length);
 assert.ok(x.componentDecisions.some(i=>i.component==='durable-execution-ledger'&&i.decision==='keep'));
 assert.ok(x.componentDecisions.some(i=>i.component==='browser-session-authentication'&&i.decision==='keep'));
 assert.ok(!x.componentDecisions.some(i=>i.decision==='retired'));
});

test('published governance docs distinguish proposal, historical evidence and guarded retirement',async()=>{
 const decision=await readFile(new URL('ARCHITECTURE-GOVERNANCE.md',root),'utf8');
 const registry=await readFile(new URL('RETIREMENT-REGISTER.md',root),'utf8');
 for(const phrase of ['not','Mcp-Session-Id','PostgreSQL','2026-07-28','80–95%']){
  assert.ok(decision.includes(phrase),phrase+' missing from governance decision');
 }
 for(const phrase of ['RETIRE-CANDIDATE','docs/ARCHITECTURE.md','src/framework-integration-runtime.mjs']){
  assert.ok(registry.includes(phrase),phrase+' missing from retirement register');
 }
});
