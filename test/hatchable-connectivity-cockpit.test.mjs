import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectConnectivity} from '../cloud/hatchable/lib/connectivity-view.js';

const SHA='a'.repeat(40);
const ROOT='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const mockDB={
 async query(sql){
  if(sql.includes('GROUP BY status'))return {rows:[{status:'done',total:14},{status:'queued',total:2}]};
  if(sql.includes('FROM brain_tasks ORDER BY'))return {rows:[
   {id:81,objective:'repo.inspect',status:'done',attempts:1,updated_at:'2026-11-03T20:00:00.000Z'}
  ]};
  if(sql.includes('FROM brain_runtime_control'))return {rows:[
   {paused:false,version:3,last_event_at:'2026-11-03T20:00:00.000Z'}
  ]};
  throw Error('unexpected-sql');
 }
};
const response=data=>({ok:true,status:200,json:async()=>data});
const healthyFetch=async url=>{
 if(url===ROOT+'/git/ref/heads/main')return response({object:{sha:SHA}});
 if(url.includes('/pulls?'))return response([{number:256,title:'User interface',draft:false,
  html_url:'https://github.com/michaeljwilliams0123/Ultron.MW/pull/256',
  updated_at:'2026-11-03T19:00:00Z'}]);
 if(url.includes('/actions/runs?'))return response({workflow_runs:[
  {id:12,name:'Ultron core verification',status:'completed',conclusion:'success',
   head_sha:SHA,event:'push',created_at:'2026-11-03T20:00:00Z',
   html_url:'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/12'},
  {id:11,name:'Ultron core verification',status:'completed',conclusion:'failure',
   head_sha:'b'.repeat(40),event:'push',created_at:'2026-11-03T19:00:00Z'}
 ]});
 throw Error('unexpected-url');
};

test('CONNECT-01: owner connectivity reports independent GitHub/CI plus persisted tasks',async()=>{
 const value=await collectConnectivity({db:mockDB,fetchGithub:healthyFetch,
  now:()=>new Date('2026-11-03T21:00:00Z').toISOString()});
 assert.equal(value.schema,'ultron.connectivity.v1');
 assert.equal(value.observedAt,'2026-11-03T21:00:00.000Z');
 assert.equal(value.github.state,'observed');
 assert.equal(value.github.mainSha,SHA);
 assert.equal(value.ci.conclusion,'success');
 assert.equal(value.ci.runId,12);
 assert.equal(value.pullRequests.items[0].number,256);
 assert.equal(value.runtime.state,'active');
 assert.equal(value.queue.counts.done,14);
 assert.equal(value.queue.recent[0].id,81);
 assert.equal(value.paidCeilingCents,0);
 assert.equal(JSON.stringify(value).includes('token'),false);
});

test('CONNECT-02: GitHub failure remains unknown, not a fabricated green status',async()=>{
 const fail=async()=>({ok:false,status:403,json:async()=>({message:'limited'})});
 const value=await collectConnectivity({db:mockDB,fetchGithub:fail,
  now:()=>new Date('2026-11-03T21:00:00Z').toISOString()});
 assert.equal(value.github.state,'unavailable');
 assert.equal(value.github.mainSha,null);
 assert.equal(value.ci.state,'unavailable');
 assert.equal(value.ci.conclusion,null);
 assert.equal(value.pullRequests.state,'unavailable');
 assert.equal(value.runtime.state,'active');
});

test('CONNECT-03: stale CI from a different SHA must never claim head success',async()=>{
 const change=async url=>{
  if(url===ROOT+'/git/ref/heads/main')return response({object:{sha:SHA}});
  if(url.includes('/pulls?'))return response([]);
  return response({workflow_runs:[{
   id:500,name:'Ultron core verification',event:'push',status:'completed',
   conclusion:'success',head_sha:'b'.repeat(40),
   html_url:'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/500'
  }]});
 };
 const value=await collectConnectivity({db:mockDB,fetchGithub:change});
 assert.equal(value.ci.state,'no-current-main-run');
 assert.equal(value.ci.conclusion,null);
});

test('CONNECT-04: owner-only route and safe static UI are required',()=>{
 const route=readFileSync('cloud/hatchable/api/brain/connectivity.js','utf8');
 const html=readFileSync('cloud/hatchable/public/index.html','utf8');
 const script=readFileSync('cloud/hatchable/public/connectivity.js','utf8');
 assert.match(route,/export const access\s*=\s*'admin'/);
 assert.match(route,/methods\s*=\s*\['GET'\]/);
 for(const id of ['connection-refresh','connection-runtime','connection-github',
  'connection-ci','connection-queue','connection-prs','connection-stamp']) {
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 }
 assert.match(html,/src="\.\/connectivity\.js"/);
 assert.match(script,/credentials:\s*'same-origin'/);
 assert.match(script,/textContent/);
 assert.doesNotMatch(script,/innerHTML\s*=/);
 assert.doesNotMatch(script,/localStorage|sessionStorage|Authorization|Bearer\s/);
});

test('CONNECT-05: unsigned owners see sign-in guidance, not a fake connection success',()=>{
 const script=readFileSync('cloud/hatchable/public/connectivity.js','utf8');
 const css=readFileSync('cloud/hatchable/public/connectivity.css','utf8');
 assert.match(script,/owner-authentication-required/);
 assert.match(script,/meta\('session'/);
 assert.match(script,/Public liveness only/);
 assert.match(css,/data-state="session"/);
});
