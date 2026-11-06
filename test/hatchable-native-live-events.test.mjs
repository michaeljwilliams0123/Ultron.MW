import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {notifyOwner} from '../cloud/hatchable/lib/owner-live-events.js';

const read=p=>readFileSync(p,'utf8');
test('LIVE-01: platform realtime event has a fixed private channel and bounded payload',async()=>{
 const published=[];
 const events={publish:async(...args)=>{published.push(args);return {id:7}}};
 const ok=await notifyOwner(events,'task',42);
 assert.equal(ok,true);
 assert.deepEqual(published,[['ultron.owner','changed',{kind:'task',id:42}]]);
});
test('LIVE-02: unsupported event kinds and untrusted identifiers cannot be broadcast',async()=>{
 const published=[];
 const events={publish:async(...args)=>published.push(args)};
 assert.equal(await notifyOwner(events,'secret',123),false);
 assert.equal(await notifyOwner(events,'task','token-here'),false);
 assert.equal(await notifyOwner(events,'github'),true);
 assert.deepEqual(published,[['ultron.owner','changed',{kind:'github'}]]);
});
test('LIVE-03: notification outages never reverse durable DB writes',async()=>{
 const failed={publish:async()=>{throw Error('rate_limited')}};
 assert.equal(await notifyOwner(failed,'runtime'),false);
});
test('LIVE-04: only admins may mint a private live subscription token',()=>{
 const src=read('cloud/hatchable/api/brain/events-token.js');
 assert.match(src,/export const access\s*=\s*'admin'/);
 assert.match(src,/events\.grant\(\['ultron\.owner'\]\)/);
 assert.match(src,/req\.member\?\.handle/);
});
test('LIVE-05: native event subscription relies on the platform client, not JS polling',()=>{
 const html=read('cloud/hatchable/public/index.html');
 const script=read('cloud/hatchable/public/owner-live.js');
 assert.match(html,/src="\/__hatchable\/events\.js"/);
 assert.match(html,/src="\.\/owner-live\.js"/);
 assert.match(script,/hatchable\.events\.connect/);
 assert.match(script,/\$reset/);
 assert.match(script,/ultron:realtime-change/);
 assert.doesNotMatch(script,/new EventSource|new WebSocket|setInterval/);
});
test('LIVE-06: persisted owner and scheduler work emits changes, MCP calls share the same path',()=>{
 const owner=read('cloud/hatchable/lib/brain-owner.js');
 const runner=read('cloud/hatchable/api/brain/run.js');
 const tick=read('cloud/hatchable/api/brain/tick.js');
 const control=read('cloud/hatchable/api/brain/control.js');
 const mcp=read('cloud/hatchable/mcp/ultron_queue.js');
 const connectivity=read('cloud/hatchable/public/connectivity.js');
 assert.match(owner,/notifyOwner\(/);
 assert.match(runner,/notifyOwner\(/);
 assert.match(tick,/notifyOwner\(/);
 assert.match(control,/notifyOwner\(/);
 assert.match(mcp,/events:ctx\?\.events/);
 assert.match(connectivity,/ultron:realtime-change/);
});
test('LIVE-07: native MCP live connectivity is owner-protected and read-only',()=>{
 const src=read('cloud/hatchable/mcp/ultron_connectivity.js');
 assert.match(src,/export const access\s*=\s*'admin'/);
 assert.match(src,/collectConnectivity/);
 assert.doesNotMatch(src,/queueObjective|runMahoragaAction|env\.set|ai\.generate/);
});
