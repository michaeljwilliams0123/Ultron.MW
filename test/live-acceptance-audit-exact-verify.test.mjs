import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyExactMainVerify} from '../src/live-acceptance-audit.mjs';
const SHA='a'.repeat(40);
const OTHER='b'.repeat(40);
const record=(id,head_sha=SHA,conclusion='success',status='completed')=>({
 id,head_sha,conclusion,status,head_branch:'main',workflow_id:388875616,event:'push'
});
const response=(runs,status=200)=>({status,body:{workflow_runs:runs}});
test('bounded exact-head query accepts the current GitHub main verification, not a 30-run bulk download',()=>{
 const r=classifyExactMainVerify(SHA,response([record(15),record(12,OTHER)]));
 assert.equal(r.id,'github-verify');
 assert.equal(r.status,'pass');
 assert.match(r.detail,/run 15/);
 const source=readFileSync(new URL('../scripts/live-acceptance-audit.mjs',import.meta.url),'utf8');
 assert.match(source,/head_sha=/);
 assert.match(source,/per_page=3/);
 assert.doesNotMatch(source,/event=push&per_page=30/);
});
test('old SHA, wrong workflow identity, wrong branch or event can never pass',()=>{
 for(const invalid of [
  record(9,OTHER),
  {...record(9),workflow_id:999},
  {...record(9),head_branch:'feature'},
  {...record(9),event:'workflow_dispatch'},
  {...record(9),id:'9'}
 ]){
  assert.notEqual(classifyExactMainVerify(SHA,response([invalid])).status,'pass');
 }
});
test('newer failed run overrides an older successful attempt',()=>{
 const r=classifyExactMainVerify(SHA,response([record(3),record(5,SHA,'failure')]));
 assert.equal(r.status,'fail');
 assert.match(r.detail,/run 5/);
});
test('pending checks, API errors, oversized bodies and malformed replies remain unknown',()=>{
 for(const r of [
  response([record(7,SHA,null,'in_progress')]),
  {status:403,body:{message:'Resource not accessible by integration'}},
  {status:200,error:'response-over-limit'},
  {status:200,body:{workflow_runs:'invalid'}},
  response([]),
  {status:null,error:'request-unavailable'}
 ]){
  const v=classifyExactMainVerify(SHA,r);
  assert.equal(v.status,'unknown');
 }
});
test('invalid SHA never becomes a passing Verify observation',()=>{
 assert.equal(classifyExactMainVerify('invalid',response([record(3)])).status,'unknown');
});
