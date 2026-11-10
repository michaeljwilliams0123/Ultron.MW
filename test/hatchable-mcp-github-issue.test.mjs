import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,github,githubModule,makeTool} from './helpers/mcp-provider-fixture.mjs';

const request=()=>({key:'github-write-001',issueNumber:42,body:'bounded update',
 state:'closed',expectedProfileVersion:2,expectedStopVersion:3});
function provider({lost=false,conflict=false}={}){
 let issue={number:42,body:'old',state:'open',
  html_url:'https://github.com/Ultron-MW/Ultron.MW/issues/42'},writes=0;
 return {get writes(){return writes;},async transport(url,init){
  assert.equal(url,'https://api.github.com/repos/Ultron-MW/Ultron.MW/issues/42');
  assert.equal(init.redirect,'error');
  if(init.method==='PATCH'){
   writes++;issue={...issue,...JSON.parse(init.body)};
   if(conflict)issue.body='foreign edit';
   if(lost)throw Error('response lost');
   return new Response('{}',{status:200});
  }
  return new Response(JSON.stringify(issue));
 }};
}
test('signed GitHub issue write verifies scope, sends once and records readback',async()=>{
 const h=await fixture({lostReceipt:true}),p=provider(),value=request();
 const prepare=await github.githubIssueWrite({mode:'prepare',request:value});
 assert.equal(prepare.grantRequest.operation,'github.issue.write');
 const envelope=await h.sign(prepare.grantRequest);
 const execute=()=>github.githubIssueWrite({mode:'submit',request:value,envelope,
  db:h.db,config:h.config,transport:p.transport});
 const result=await execute();
 assert.equal(result.status,'observed');
 assert.equal(result.evidence.issueNumber,42);
 assert.equal(result.evidence.state,'closed');
 assert.equal(result.issueUrl,'https://github.com/Ultron-MW/Ultron.MW/issues/42');
 assert.equal((await execute()).status,'observed');
 assert.equal(p.writes,1);
 assert.equal(h.claimCount,1);
 assert.equal(JSON.stringify(result).includes('github-fixture-token'),false);
 const changed=request();changed.body='altered';
 assert.equal((await github.githubIssueWrite({mode:'submit',request:changed,envelope,
  db:h.db,config:h.config,transport:p.transport})).reason,'grant-invalid-or-expired');
});
test('lost GitHub response or conflicting readback remains durable and never replays',async()=>{
 for(const options of [{lost:true},{conflict:true}]){
  const h=await fixture(),p=provider(options),value=request();
  const prepared=await github.githubIssueWrite({mode:'prepare',request:value});
  const envelope=await h.sign(prepared.grantRequest);
  const submit=()=>github.githubIssueWrite({mode:'submit',request:value,envelope,
   db:h.db,config:h.config,transport:p.transport});
  assert.equal((await submit()).status,'reconcile-required');
  assert.equal((await submit()).status,'reconcile-required');
  assert.equal((await github.githubIssueWrite({mode:'reconcile',request:value,grantId:'test-provider-grant',
   db:h.db})).status,'reconcile-required');
  assert.equal(p.writes,1);
 }
});
test('lost claim acknowledgement cannot dispatch or retry',async()=>{
 const h=await fixture({lostClaim:true}),p=provider(),value=request();
 const prepared=await github.githubIssueWrite({mode:'prepare',request:value});
 const envelope=await h.sign(prepared.grantRequest);
 const submit=()=>github.githubIssueWrite({mode:'submit',request:value,envelope,
  db:h.db,config:h.config,transport:p.transport});
 assert.equal((await submit()).status,'reconcile-required');
 assert.equal((await submit()).status,'reconcile-required');
 assert.equal(p.writes,0);
});
test('GitHub MCP handler routes bounded signed requests and rejects invalid input',async()=>{
 const tool=await makeTool('mcp/ultron_github_issue_write.js',"'lib/github-issue-write.js'",githubModule);
 const result=await tool.handler({mode:'prepare',request:request()},{});
 assert.equal(result.grantRequest.operation,'github.issue.write');
 assert.equal((await tool.handler({mode:'prepare',request:{...request(),issueNumber:0}},{})).status,'held');
 assert.equal(tool.inputSchema.additionalProperties,false);
});
test('denied or revoked authority never dispatches, including a forged grant',async()=>{
 for(const options of [{denied:true},{revoked:true}]){
  const h=await fixture(options),p=provider(),value=request();
  const prepared=await github.githubIssueWrite({mode:'prepare',request:value});
  const envelope=await h.sign(prepared.grantRequest);
  const result=await github.githubIssueWrite({mode:'submit',request:value,envelope,
   db:h.db,config:h.config,transport:p.transport});
  assert.equal(result.status,'reconcile-required');
  assert.equal(p.writes,0);
 }
 const h=await fixture(),p=provider(),value=request();
 const prepared=await github.githubIssueWrite({mode:'prepare',request:value});
 const envelope=await h.sign(prepared.grantRequest,{resource:'sha256:'+'0'.repeat(64)});
 assert.equal((await github.githubIssueWrite({mode:'submit',request:value,envelope,
  db:h.db,config:h.config,transport:p.transport})).reason,'grant-invalid-or-expired');
 assert.equal(h.claimCount,0);
 assert.equal(p.writes,0);
});
