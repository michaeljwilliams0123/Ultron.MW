import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTINUUM_ISSUES, selectCouncilReviews} from '../src/continuum-supervisor.mjs';

const now='2026-11-01T12:00:00Z';
const item=(number,extra={})=>({number,state:'open',lastReviewAt:null,lastMeaningfulAt:'2026-10-31T12:00:00Z',...extra});

test('supervisor has a bounded exact roadmap scope',()=>{
  assert.deepEqual(CONTINUUM_ISSUES,Array.from({length:13},(_,i)=>183+i));
});

test('dispatch only open issues that have no council review yet',()=>{
  const picked=selectCouncilReviews([item(183),item(184,{state:'closed'}),item(195)],{now,limit:2});
  assert.deepEqual(picked,[183,195]);
});

test('a new owner issue comment triggers review sooner than stale refresh',()=>{
  const selected=selectCouncilReviews([
    item(183,{lastReviewAt:'2026-11-01T10:00:00Z',lastMeaningfulAt:'2026-11-01T11:00:00Z'}),
    item(184,{lastReviewAt:'2026-11-01T10:00:00Z',lastMeaningfulAt:'2026-10-31T12:00:00Z'})
  ],{now});
  assert.deepEqual(selected,[183]);
});

test('repeated council bot reports without meaningful owner changes are not continually redispatched',()=>{
  const picked=selectCouncilReviews([item(184,{lastReviewAt:'2026-11-01T11:50:00Z',lastMeaningfulAt:'2026-10-31T12:00:00Z'})],{now});
  assert.deepEqual(picked,[]);
});

test('stale reports are selected oldest-first with max concurrency and no closed issue',()=>{
  const picked=selectCouncilReviews([
    item(183,{lastReviewAt:'2026-10-31T08:00:00Z'}),
    item(184,{lastReviewAt:'2026-10-31T07:00:00Z'}),
    item(185,{lastReviewAt:'2026-10-31T09:00:00Z'}),
    item(186,{state:'closed'})
  ],{now,limit:2,refreshHours:24});
  assert.deepEqual(picked,[184,183]);
});

test('refuse out-of-scope and invalid time/limits before dispatch',()=>{
  assert.throws(()=>selectCouncilReviews([item(196)],{now}),/out-of-scope/);
  assert.throws(()=>selectCouncilReviews([item(183)],{now,limit:0}),/limit-invalid/);
  assert.throws(()=>selectCouncilReviews([item(183)],{now:'not-time'}),/time-invalid/);
});

test('supervisor grants only actions dispatch, never administration or secret access',()=>{
  const yml=readFileSync(new URL('../.github/workflows/continuum-council-supervisor.yml',import.meta.url),'utf8');
  assert.match(yml,/schedule:/);
  assert.match(yml,/workflow_dispatch:/);
  assert.match(yml,/\bactions: write\b/);
  assert.match(yml,/\bissues: read\b/);
  assert.doesNotMatch(yml,/administration: write|contents: write|issues: write|pull-requests: write|secrets: inherit|OPENAI_API_KEY|pull_request_target/);
  assert.match(yml,/council-debate\.yml/);
  assert.match(yml,/src\/continuum-supervisor\.mjs/);
});
