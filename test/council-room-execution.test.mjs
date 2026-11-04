import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseOwnerImplementationComment,postExecutionReceipt,
  runCouncilRoomExecution} from '../src/council-room-execution.mjs';
import {PR_OWNER,PR_REPOSITORY} from '../src/cloud-pr.mjs';

const SHA='a'.repeat(40);
function event(body='@ultron implement Inspect the latest repository state'){
 return {action:'created',
  issue:{number:285,title:'Execution capability',state:'open',
   body:'Owner issue',user:{login:PR_OWNER}},
  comment:{id:12345,body,user:{login:PR_OWNER}}};
}

test('owner implementation comments are bounded, owner-only, and secret-rejecting',()=>{
 const request=parseOwnerImplementationComment(event(),PR_OWNER,PR_REPOSITORY);
 assert.equal(request.issueNumber,285);
 assert.equal(request.objective,'Inspect the latest repository state');
 assert.match(request.idempotencyKey,/^room:issue:285:[a-f0-9]{40}$/);
 assert.throws(()=>parseOwnerImplementationComment(event('@ultron implement password=secret'),PR_OWNER,PR_REPOSITORY),
  /objective-invalid/);
 assert.throws(()=>parseOwnerImplementationComment(event(),'other-user',PR_REPOSITORY),
  /comment-invalid/);
});

test('receipt callback binds the exact body into the GitHub OIDC audience',async()=>{
 const payload={schema:'ultron.council-room.execution.v1',phase:'planned',
  issueNumber:285,commentId:12345,commentBody:'@ultron implement inspect'};
 const raw=JSON.stringify(payload),calls=[];
 const result=await postExecutionReceipt(payload,{
  requestUrl:'https://token.actions.githubusercontent.com/id',
  requestToken:'actions-token',url:'https://hatchable.test/receipt',
  transport:async(url,options={})=>{
   calls.push({url:String(url),options});
   if(String(url).startsWith('https://token.actions.githubusercontent.com/'))
    return {ok:true,json:async()=>({value:'signed-token'})};
   return {ok:true,json:async()=>({ok:true,job:{state:'planned'}})};
  }
 });
 assert.equal(result.job.state,'planned');
 assert.equal(new URL(calls[0].url).searchParams.get('audience'),
  'ultron.council-room.execution.v1:sha256:'+createHash('sha256').update(raw).digest('hex'));
 assert.equal(calls[1].options.headers.authorization,'Bearer signed-token');
 assert.equal(calls[1].options.body,raw);
});

test('terminal execution replay records the request but performs no GitHub writes',async()=>{
 const phases=[];
 const result=await runCouncilRoomExecution({
  event:event(),actor:PR_OWNER,repository:PR_REPOSITORY,executorSha:SHA,
  callback:async payload=>{
   phases.push(payload.phase);
   return {job:{state:'verified',externalUrl:'https://github.com/example/pr/1'}};
  },
  github:{get:async()=>{throw Error('unexpected GitHub read');},
   getOptional:async()=>{throw Error('unexpected GitHub read');},
   post:async()=>{throw Error('unexpected GitHub write');},
   put:async()=>{throw Error('unexpected GitHub write');}}
 });
 assert.deepEqual(phases,['planned']);
 assert.equal(result.status,'verified');
 assert.equal(result.replayed,true);
});

test('paused owner reservation remains held without touching GitHub',async()=>{
 const phases=[];
 const result=await runCouncilRoomExecution({
  event:event(),actor:PR_OWNER,repository:PR_REPOSITORY,executorSha:SHA,
  callback:async payload=>{
   phases.push(payload.phase);
   return {job:{state:payload.phase==='planned'?'planned':'needs-owner',
    result:payload.phase==='planned'?{}:{reason:'owner-paused'}}};
  },
  github:{get:async()=>{throw Error('unexpected GitHub read');},
   getOptional:async()=>{throw Error('unexpected GitHub read');},
   post:async()=>{throw Error('unexpected GitHub write');},
   put:async()=>{throw Error('unexpected GitHub write');}}
 });
 assert.deepEqual(phases,['planned','reserve']);
 assert.equal(result.status,'needs-owner');
});
