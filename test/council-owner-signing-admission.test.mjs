import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnerOverrideAdmission} from '../src/council-owner-signing-admission.mjs';

const owner={login:'michaeljwilliams0123',id:308995719,type:'User'};
const delegate={login:'michaeljwilliams0123ultron',id:354634860,type:'User'};
const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
const head='a'.repeat(40),base='b'.repeat(40);
const pr={number:544,state:'open',draft:false,user:delegate,head:{sha:head,repo},base:{sha:base,ref:'main',repo}};
const approval={id:1,user:owner,state:'APPROVED',commit_id:head,submitted_at:'2026-11-24T12:00:00Z'};
const checks={total_count:4,check_runs:['test','fixed-comparison','reef-runtime-probe','attested-receipt'].map(name=>({name,head_sha:head,app:{id:15368},status:'completed',conclusion:'success',started_at:'2026-11-24T11:00:00Z'}))};
const args={principal:owner,pr,expectedHead:head,expectedBase:base,reviews:[approval],checks};
const verify=(overrides={})=>assertOwnerOverrideAdmission({...args,...overrides});
test('delegated PR requires an exact-head genuine owner approval and pinned CI',()=>assert.equal(verify().via,'owner-approved-exact-head'));
test('owner-authored PR retains owner-only admission',()=>assert.equal(verify({pr:{...pr,user:owner},reviews:[]}).via,'owner-authored'));
test('delegated GitHub account cannot sign owner exception',()=>assert.throws(()=>verify({principal:delegate})));
test('matching login with wrong numeric identity is rejected',()=>assert.throws(()=>verify({principal:{...owner,id:1}})));
test('no review, wrong reviewer, stale review or missing reviewed target is rejected',()=>{
 for(const x of [{reviews:[]},{reviews:[{...approval,user:delegate}]},{reviews:[{...approval,commit_id:'c'.repeat(40)}]},{expectedHead:null},{expectedBase:null}])assert.throws(()=>verify(x));
});
test('a later owner denial or dismissal invalidates the old approval',()=>{
 for(const state of ['CHANGES_REQUESTED','DISMISSED'])assert.throws(()=>verify({reviews:[approval,{...approval,id:2,state,submitted_at:'2026-11-24T12:01:00Z'}]}));
});
test('closed, draft, wrong repo, wrong base and moved head fail closed',()=>{
 for(const p of [{...pr,state:'closed'},{...pr,draft:true},{...pr,head:{...pr.head,repo:{...repo,id:1}}},{...pr,base:{...pr.base,ref:'other'}},{...pr,head:{...pr.head,sha:'c'.repeat(40)}}])assert.throws(()=>verify({pr:p}));
});
test('untrusted publisher, failed, stale or truncated checks are denied',()=>{
 for(const c of [{...checks,total_count:5},{...checks,check_runs:checks.check_runs.map(x=>({...x,app:{id:1}}))},{...checks,check_runs:checks.check_runs.map(x=>({...x,conclusion:'failure'}))},{...checks,check_runs:checks.check_runs.map(x=>({...x,head_sha:'c'.repeat(40)}))}])assert.throws(()=>verify({checks:c}));
});
