import test from 'node:test';
import assert from 'node:assert/strict';
import {executionEvent,publishTelemetry} from '../src/observability.mjs';
test('structured event excludes arbitrary input and credentials',()=>{
  const r=executionEvent({kind:'pr-execution',state:'succeeded',intent:'implement-multi',
    sha:'a'.repeat(40),prNumber:37,secret:'s3cret',commentBody:'untrusted'});
  assert.equal(r.kind,'pr-execution');
  assert.equal(r.prNumber,37);
  assert.equal('secret' in r,false);
  assert.equal('commentBody' in r,false);
});
test('Datadog is off by default and writes GitHub-native summary',async()=>{
  let written='',fetches=0;
  const r=await publishTelemetry({kind:'ci-heartbeat',state:'succeeded'},{
    env:{},summaryPath:'/virtual/github-summary',
    append:async(path,data)=>{assert.equal(path,'/virtual/github-summary');written+=data;},
    fetchImpl:async()=>{fetches++;throw Error('unexpected network')}
  });
  assert.equal(r.state,'disabled');assert.equal(fetches,0);
  assert.match(written,/ultron-execution-v1/);
});
test('Datadog requires existing owner-approved key',async()=>{
  let calls=0;
  const r=await publishTelemetry({kind:'ci-heartbeat'},{
    env:{ULTRON_ENABLE_DATADOG:'1'},
    fetchImpl:async()=>{calls++;throw Error('network forbidden')}
  });
  assert.equal(r.state,'authorization-required');assert.equal(calls,0);
});
test('authorized Datadog only gets sanitized events',async()=>{
  const key='a'.repeat(40);let seen;
  const r=await publishTelemetry({
    kind:'pr-execution',state:'succeeded',sha:'b'.repeat(40),prNumber:37,
    userPrompt:'do not forward'
  },{
    env:{ULTRON_ENABLE_DATADOG:'1',ULTRON_DATADOG_API_KEY:key,
      ULTRON_DATADOG_SITE:'datadoghq.com'},
    fetchImpl:async(url,opts)=>{seen={url,opts};return {ok:true,status:202}}
  });
  assert.equal(r.state,'delivered');
  assert.equal(seen.url,'https://http-intake.logs.datadoghq.com/api/v2/logs');
  assert.equal(seen.opts.headers['DD-API-KEY'],key);
  assert.doesNotMatch(seen.opts.body,/do not forward|userPrompt/);
  assert.doesNotMatch(seen.opts.body,new RegExp(key));
});
test('unapproved Datadog endpoints are rejected',async()=>{
  const r=await publishTelemetry({kind:'ci-heartbeat'},{
    env:{ULTRON_ENABLE_DATADOG:'1',ULTRON_DATADOG_API_KEY:'a'.repeat(40),
      ULTRON_DATADOG_SITE:'evil.example'},
    fetchImpl:async()=>{throw Error('unexpected external call')}
  });
  assert.equal(r.state,'site-unapproved');
});

test('observability keeps pending and failure states distinct from completion',()=>{
  assert.equal(executionEvent({kind:'pr-execution',state:'pending'}).state,'pending');
  assert.equal(executionEvent({kind:'pr-execution',state:'failed'}).state,'failed');
  assert.equal(executionEvent({kind:'pr-execution',state:'responded'}).state,'responded');
});
