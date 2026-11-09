import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectResearchIntake,RESEARCH_SOURCES} from '../cloud/hatchable/lib/research-intake.js';

const NOW='2026-11-09T13:30:00.000Z';
const tags={'actions/checkout':'v7.0.1','actions/setup-node':'v7.1.0',
 'actions/upload-artifact':'v7.0.2','microsoft/playwright':'v1.65.0',
 'nodejs/node':'v26.13.0','actions/cache':'v6.1.0'};
const date={'actions/checkout':'2026-07-20T15:10:05Z',
 'actions/setup-node':'2026-10-08T02:52:34Z',
 'actions/upload-artifact':'2026-10-07T10:08:14Z',
 'microsoft/playwright':'2026-11-05T18:25:45Z',
 'nodejs/node':'2026-10-28T16:57:41Z',
 'actions/cache':'2026-06-26T19:17:06Z'};
function fixture(url){
 const p=new URL(url).pathname.split('/');
 const repo=p[2]+'/'+p[3],tag=tags[repo];
 return {ok:true,status:200,headers:{get:()=>null},
  json:async()=>({tag_name:tag,published_at:date[repo],
   html_url:'https://github.com/'+repo+'/releases/tag/'+tag,
   draft:false,prerelease:false})};
}
test('bounded public research reads six fixed upstream releases and separates actionable from suppressed',async()=>{
 const seen=[];
 const r=await collectResearchIntake({now:new Date(NOW),fetcher:async(url,options)=>{
  seen.push({url,options});return fixture(url);}});
 assert.equal(RESEARCH_SOURCES.length,6);
 assert.equal(seen.length,6);
 assert.equal(new Set(seen.map(x=>x.url)).size,6);
 assert.ok(seen.every(x=>/^https:\/\/api.github.com\/repos\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9.-]+\/releases\/latest$/.test(x.url)));
 assert.equal(r.objective,'research.intake');
 assert.equal(r.source,'github-release-primary');
 assert.equal(r.paidCents,0);
 assert.equal(r.observations.length,6);
 assert.equal(r.actionableCount,2);
 assert.equal(r.suppressedCount,4);
 const upload=r.observations.find(x=>x.repository==='actions/upload-artifact');
 assert.equal(upload.status,'candidate');assert.equal(upload.version,'v7.0.2');
 assert.equal(upload.pinnedVersion,'v4.6.2');
 assert.equal(upload.sourceUrl,'https://github.com/actions/upload-artifact/releases/tag/v7.0.2');
 const same=r.observations.find(x=>x.repository==='microsoft/playwright');
 assert.equal(same.status,'suppressed');
 assert.equal(same.reason,'already-pinned');
 assert.equal(r.reviewRequired,true);
 assert.ok(r.observations.every(x=>x.costCents===0));
});
test('stale, malformed, network-failed and prerelease research sources never trigger external writes',async()=>{
 const fresh=await collectResearchIntake({now:new Date('2027-11-09T00:00:00Z'),fetcher:async u=>fixture(u)});
 assert.equal(fresh.actionableCount,0);
 assert.ok(fresh.observations.some(x=>x.reason==='stale-source'));
 const untrusted=await collectResearchIntake({now:new Date(NOW),fetcher:async url=>{
  if(url.includes('upload-artifact'))return {...fixture(url),json:async()=>({
   tag_name:'v8.0.0',published_at:NOW,html_url:'https://bad.example/release',draft:false,prerelease:false})};
  if(url.includes('playwright'))throw Error('request-timeout');
  return fixture(url);
 }});
 assert.equal(untrusted.observations.find(x=>x.repository==='actions/upload-artifact').status,'suppressed');
 assert.equal(untrusted.observations.find(x=>x.repository==='microsoft/playwright').reason,'source-unavailable');
 assert.equal(untrusted.paidCents,0);
});
test('research runs inside existing six-hour durable task slot, not a separate authorization path',()=>{
 const tick=readFileSync(new URL('../cloud/hatchable/api/brain/tick.js',import.meta.url),'utf8');
 const runner=readFileSync(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
 const core=readFileSync(new URL('../cloud/hatchable/lib/brain-core.js',import.meta.url),'utf8');
 assert.match(tick,/research\.intake/);
 assert.match(tick,/research-slot-/);
 assert.match(runner,/WHEN 'research\.intake' THEN jsonb_exists\(autonomy\.allowed_operations,'research\.public'\)/);
 assert.match(core,/objective==='research\.intake'/);
 assert.match(runner,/research-review-admitted/);
});
