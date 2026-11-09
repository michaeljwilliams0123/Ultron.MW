import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {assertGovernedDispatch,parseGovernedPayload,runGovernedRequest} from '../src/governed-execution.mjs';

const SHA='a'.repeat(40);
const REPO='michaeljwilliams0123/Ultron.MW';
const env={GITHUB_REPOSITORY:REPO,GITHUB_ACTOR:'michaeljwilliams0123',
 GITHUB_TRIGGERING_ACTOR:'michaeljwilliams0123',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_REF:'refs/heads/main',GITHUB_SHA:SHA,GITHUB_TOKEN:'unit-test-secret'};
const payload=(over={})=>JSON.stringify({objectiveId:'obj-123',op:'github.repo.inspect',sourceSha:SHA,...over});

// Detect expressions in shell run: blocks and one-line commands.
function shellExpressions(yaml){
 const hits=[];let runIndent=null;
 for(const [index,line] of yaml.split(/\r?\n/).entries()){
   const indentation=line.match(/^\s*/)[0].length;
   if(runIndent!==null&&line.trim()&&indentation<=runIndent)runIndent=null;
   const step=/^(\s*)(?:-\s*)?run:\s*(.*)$/.exec(line);
   if(step){
     runIndent=/^[|>][+-]?(?:\s+#.*)?$/.test(step[2])?step[1].length:null;
     if(line.includes('$'+'{{'))hits.push(index+1);
   }else if(runIndent!==null&&line.includes('$'+'{{'))hits.push(index+1);
 }
 return hits;
}

test('repository workflows never interpolate untrusted expressions into run shell',async()=>{
 const dir=new URL('../.github/workflows/',import.meta.url);
 for(const name of await readdir(dir)){
   if(!/\.ya?ml$/.test(name))continue;
   const yaml=await readFile(new URL(name,dir),'utf8');
   assert.deepEqual(shellExpressions(yaml),[],name);
 }
 assert.deepEqual(shellExpressions('steps:\n  - run: echo $'+'{{ inputs.raw_payload }}'),[2]);
 assert.deepEqual(shellExpressions('steps:\n  - run: |\n      echo $'+'{{ github.event.issue.body }}'),[3]);
});

test('harness passes raw input through env, never interpolated into shell',async()=>{
 const yaml=await readFile(new URL('../.github/workflows/governed-execution.yml',import.meta.url),'utf8');
 assert.match(yaml,/UNTRUSTED_PAYLOAD:\s*\$\{\{ inputs\.raw_payload \}\}/);
 assert.match(yaml,/permissions:\n  contents: read\n  actions: read/);
 assert.match(yaml,/persist-credentials: false/);
 assert.match(yaml,/run: node src\/governed-execution\.mjs/);
 assert.doesNotMatch(yaml,/contents: write|secrets\.HITL_HMAC_SECRET|pull_request_target/);
});

test('only owner main-branch dispatches and owner-triggered reruns are allowed',()=>{
 assert.equal(assertGovernedDispatch(env),SHA);
 for(const patch of [
   {GITHUB_ACTOR:'attacker'},{GITHUB_TRIGGERING_ACTOR:'attacker'},
   {GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/heads/feature'},
   {GITHUB_REPOSITORY:'someone/else'},{GITHUB_SHA:'abc'}])
   assert.throws(()=>assertGovernedDispatch({...env,...patch}),/not-authorized/);
});

test('injection strings and mutation attempts never become executable operations',()=>{
 const injection='$(touch /tmp/never-executed); `whoami`';
 for(const bad of [
   payload({op:injection}),payload({op:'browser.external-write'}),
   payload({op:'github.repo.inspect',params:{script:injection}}),
   payload({_meta:{humanApprovalSignature:'fake'}}),
   payload({objectiveId:'hello; echo attack'}),
   payload({sourceSha:'b'.repeat(40)}),
   payload({params:['echo unsafe']}),
   'not JSON','[]','{"__proto__":{},"op":"github.repo.inspect"}',
   ' '.repeat(8200)])
   assert.throws(()=>parseGovernedPayload(bad,SHA),/governed-/);
 assert.equal(parseGovernedPayload(payload(),SHA).op,'github.repo.inspect');
});

test('read-only inspection makes fixed GET calls and redacts token from output',async()=>{
 const urls=[];
 const fetchImpl=async(url,options)=>{
   urls.push([url,options.method]);
   assert.equal(options.headers.authorization,'Bearer unit-test-secret');
   const data=url.endsWith('/git/ref/heads/main')?{object:{sha:SHA}}:
     {full_name:REPO,default_branch:'main'};
   return {ok:true,json:async()=>data};
 };
 const output=await runGovernedRequest(payload(),{env,request:fetchImpl});
 assert.equal(output.status,'verified');
 assert.equal(urls.length,3);
 assert.ok(urls.every(([url,method])=>url.startsWith('https://api.github.com/repos/'+REPO)&&method==='GET'));
 assert.doesNotMatch(JSON.stringify(output),/unit-test-secret/);
});

test('source drift, absent credentials, and missing completed CI fail closed',async()=>{
 await assert.rejects(()=>runGovernedRequest(payload(),{env:{...env,GITHUB_TOKEN:''}}),/token-unavailable/);
 const drift=async url=>({ok:true,json:async()=>url.endsWith('/git/ref/heads/main')
   ?{object:{sha:'b'.repeat(40)}}:{full_name:REPO,default_branch:'main'}});
 assert.equal((await runGovernedRequest(payload(),{env,request:drift})).status,'failed');
 const ci=payload({op:'github.ci.status'});
 const missing=async()=>({ok:true,json:async()=>({workflow_runs:[]})});
 const ciResult=await runGovernedRequest(ci,{env,request:missing});
 assert.equal(ciResult.status,'failed');
 assert.equal(ciResult.verification.completedCount,0);
});

test('CI status never claims success while another exact-head workflow is pending or failed',async()=>{
 const input=payload({op:'github.ci.status'});
 const check=async workflow_runs=>runGovernedRequest(input,{
   env:{...env,GITHUB_RUN_ID:'33'},
   request:async()=>({ok:true,json:async()=>({workflow_runs})})
 });
 const passed={id:22,head_sha:SHA,status:'completed',conclusion:'success'};
 const pending={id:23,head_sha:SHA,status:'in_progress',conclusion:null};
 assert.equal((await check([passed,pending])).status,'failed');
 const failing={id:24,head_sha:SHA,status:'completed',conclusion:'failure'};
 assert.equal((await check([passed,failing])).status,'failed');
 assert.equal((await check([passed])).status,'verified');
 assert.equal((await check([passed,{...pending,id:33}])).status,'verified');
});
