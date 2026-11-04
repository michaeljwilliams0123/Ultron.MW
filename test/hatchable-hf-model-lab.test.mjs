import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectHfRuns,getHfLabView,WORKFLOWS} from '../cloud/hatchable/lib/hf-lab-view.js';

const read=path=>readFileSync(path,'utf8');
const HEAD='a'.repeat(40);
const urls=[];
const successful=(id)=>({workflow_runs:[{id,head_sha:HEAD,status:'completed',
  conclusion:'success',event:'workflow_dispatch',created_at:'2026-11-04T03:00:00Z'}]});
const response=body=>({ok:true,status:200,json:async()=>body});
const mockFetch=async url=>{
 urls.push(url);
 const u=String(url);
 if(u.includes('hf-heldout-cpu.yml'))return response(successful(41764422463));
 if(u.includes('hf-free-cpu-tournament.yml'))return response(successful(41756754075));
 if(u.includes('c06-owner-model-release.yml'))return response({workflow_runs:[
  {id:41771806146,head_sha:HEAD,status:'completed',conclusion:'failure',
   event:'workflow_dispatch',created_at:'2026-11-04T04:12:41Z'}
 ]});
 throw Error('unexpected-url');
};
test('HF-LAB-01: separately observed workflow status cannot misrepresent failed model release',async()=>{
 urls.length=0;
 const result=await collectHfRuns({fetchGithub:mockFetch,now:()=>new Date('2026-11-04T04:30:00Z').toISOString()});
 assert.equal(result.schema,'ultron.hf-lab.v1');
 assert.equal(result.workflows.length,3);
 assert.equal(result.workflows.find(x=>x.key==='c06').conclusion,'failure');
 assert.equal(result.release.productionAccepted,false);
 assert.equal(result.release.autoPromotion,false);
 assert.equal(result.paidBudgetCents,0);
 assert.equal(urls.length,3);
 assert.ok(urls.every(x=>String(x).startsWith('https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/actions/workflows/')));
});
test('HF-LAB-02: historical scores are source-pinned and 3B remains research-only',async()=>{
 const result=await collectHfRuns({fetchGithub:mockFetch});
 assert.equal(result.benchmark.runId,41764422463);
 assert.equal(result.benchmark.corpusSha.length,64);
 assert.deepEqual(result.benchmark.models.map(x=>x.passed),[1,1,2,7]);
 assert.equal(result.benchmark.models.at(-1).approvedUse,'noncommercial-evaluation-only');
 assert.equal(result.benchmark.models.at(-1).productionEligible,false);
 assert.equal(result.benchmark.observation,'historical-evidence');
});
test('HF-LAB-03: independent upstream failures remain unavailable, not fabricated success',async()=>{
 const failure=async url=>String(url).includes('c06-owner')?
  ({ok:false,status:403,json:async()=>({})}):response({workflow_runs:[]});
 const result=await collectHfRuns({fetchGithub:failure});
 assert.equal(result.workflows.find(x=>x.key==='c06').state,'unavailable');
 assert.equal(result.workflows.find(x=>x.key==='heldout').state,'no-run');
 assert.equal(result.workflows.find(x=>x.key==='c06').conclusion,null);
});
function fakeCache(){
 let state=null;
 const calls=[];
 return {calls,async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('SELECT snapshot,observed_at,lease_until'))return {rows:state?[state]:[]};
  if(sql.includes('INSERT INTO hf_lab_cache')){
   if(state?.locked)return {rows:[]};
   state={snapshot:state?.snapshot||{},observed_at:state?.observed_at||'1970-01-01T00:00:00.000Z',locked:true};
   return {rows:[{id:'owner'}]};
  }
  if(sql.includes('UPDATE hf_lab_cache SET snapshot')){
   state={snapshot:JSON.parse(args[1]),observed_at:args[2],locked:false};
   return {rows:[{id:'owner'}]};
  }
  if(sql.includes('UPDATE hf_lab_cache SET lease_until')){
   if(state)state.locked=false;
   return {rows:[{id:'owner'}]};
  }
  throw Error('unexpected query: '+sql.slice(0,120));
 }};
}
test('HF-LAB-04: shared PostgreSQL cache avoids repeated rate-limit API calls',async()=>{
 const db=fakeCache(),calls=[];
 const fetchGithub=async url=>{calls.push(url);return mockFetch(url)};
 const now=()=>new Date('2026-11-04T04:30:00Z').toISOString();
 const first=await getHfLabView({db,fetchGithub,now});
 const second=await getHfLabView({db,fetchGithub,now});
 assert.equal(first.cache.state,'refreshed');
 assert.equal(second.cache.state,'fresh');
 assert.equal(calls.length,3);
 assert.equal(second.workflows.find(x=>x.key==='c06').conclusion,'failure');
});
test('HF-LAB-05: allowlisted owner route and MCP share the same observation helper',()=>{
 const route=read('cloud/hatchable/api/brain/hf-lab.js');
 const mcp=read('cloud/hatchable/mcp/ultron_hf_lab.js');
 const ui=read('cloud/hatchable/public/index.html');
 const js=read('cloud/hatchable/public/hf-lab.js');
 const migration=read('cloud/hatchable/migrations/0020_hf_lab_cache.sql');
 assert.match(route,/export const access='admin'/);
 assert.match(route,/methods=\['GET'\]/);
 assert.match(mcp,/export const access='admin'/);
 assert.match(route,/getHfLabView/);
 assert.match(mcp,/getHfLabView/);
 assert.match(ui,/id="hf-lab-refresh"/);
 assert.match(ui,/id="hf-lab-workflows"/);
 assert.match(ui,/src="\.\/hf-lab\.js"/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.doesNotMatch(js,/setInterval|new EventSource|new WebSocket/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS hf_lab_cache/);
});
