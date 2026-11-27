import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agentCatalog,previewRoute} from '../cloud/hatchable/public/agent-federation.mjs';
test('one federation acceptance matrix across runtime, authorization, cost and failure categories',()=>{
 const categories=[['research','gemini'],['reasoning','chatgpt'],['event-delivery','cloudflare-sentinel'],['orchestration','ultron'],['engineering','github-engineer'],['verification','reef'],['recovery','mahoraga'],['local-execution','local-technician']];
 for(const [capability,id] of categories){
  const result=previewRoute({capability,mode:'preview',budgetCents:0});
  assert.equal(result.agentId,id,capability);
  assert.equal(result.state,'preview-only');
  assert.equal(result.dispatchAllowed,false);
  assert.equal(result.paidCeilingCents,0);
 }
 for(const request of [{capability:'unknown',mode:'preview',budgetCents:0},{capability:'research',mode:'execute',budgetCents:0},{capability:'reasoning',mode:'preview',budgetCents:1},{capability:'engineering',mode:'preview',budgetCents:-1},{capability:'research',mode:'preview'},{capability:'research',mode:'preview',budgetCents:'0'},null]){
  const result=previewRoute(request);
  assert.equal(result.state,'denied');
  assert.equal(result.dispatchAllowed,false);
 }
 const repeated={capability:'research',mode:'preview',budgetCents:0};
 assert.deepEqual(previewRoute(repeated),previewRoute(repeated));
 assert.equal(agentCatalog.every(a=>a.dispatchEnabled===false),true);
 assert.equal(Object.isFrozen(agentCatalog),true);
 assert.equal(agentCatalog.every(Object.isFrozen),true);
 const page=readFileSync(new URL('../cloud/hatchable/public/agent-federation.html',import.meta.url),'utf8');
 const shell=readFileSync(new URL('../cloud/hatchable/public/workspace-shell.js',import.meta.url),'utf8');
 assert.match(page,/Preview only/);
 assert.match(page,/agent-federation\.mjs/);
 assert.match(shell,/\/agent-federation\.html/);
});
