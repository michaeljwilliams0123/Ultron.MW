import test from 'node:test';
import assert from 'node:assert/strict';
import {createOneTimeSiwcCallback} from '../src/providers/chatgpt-siwc-callback.mjs';

const attempt={
 state:'a'.repeat(48),
 clientId:null,
 redirectUri:'http://127.0.0.1:1455/auth/callback'
};
function uri(state=attempt.state,other=''){
 return attempt.redirectUri+'?state='+state+'&code=example-code&client_id=oaiapp_mock123'+other;
}
test('invalid state and random local HTTP requests cannot exhaust the owner sign-in attempt',async()=>{
 let exchanges=0;
 const gate=createOneTimeSiwcCallback({attempt,consume:async()=>{
  exchanges++;return {planEnabled:true};
 }});
 assert.equal((await gate.handle(uri('spoofed'))).status,400);
 assert.equal(gate.finished,false);
 assert.equal((await gate.handle(attempt.redirectUri+'?foo=bar')).status,400);
 assert.equal(gate.finished,false);
 assert.equal(exchanges,0);
 assert.equal((await gate.handle(uri())).status,200);
 assert.equal(exchanges,1);
 assert.equal(gate.finished,true);
});
test('valid duplicate OAuth callback is handled only once, never repeating token exchange',async()=>{
 let exchanges=0;
 const gate=createOneTimeSiwcCallback({attempt,consume:async()=>{exchanges++;return {planEnabled:true}}});
 const results=await Promise.all([gate.handle(uri()),gate.handle(uri())]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,410]);
 assert.equal(exchanges,1);
});
test('a rejected code exchange consumes valid state and never retries an uncertain token exchange',async()=>{
 let exchanges=0;
 const gate=createOneTimeSiwcCallback({attempt,consume:async()=>{
  exchanges++;throw Error('mock-invalid_grant');
 }});
 assert.equal((await gate.handle(uri())).status,400);
 assert.equal((await gate.handle(uri())).status,410);
 assert.equal(exchanges,1);
});
test('same-state denied consent is terminal; foreign-state denial is not',async()=>{
 const gate=createOneTimeSiwcCallback({attempt,consume:async()=>{throw Error('should-not-run')}});
 assert.equal((await gate.handle(attempt.redirectUri+'?state=wrong&error=access_denied')).status,400);
 assert.equal(gate.finished,false);
 assert.equal((await gate.handle(attempt.redirectUri+'?state='+attempt.state+'&error=access_denied')).status,400);
 assert.equal(gate.finished,true);
 assert.equal((await gate.handle(uri())).status,410);
});
