import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../cloud/hatchable/public/monitoring.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../cloud/hatchable/public/workspace-shell.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../cloud/hatchable/public/ultron-chat.js', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("const sources =")) || '';

function node() {
  return { dataset: { state: 'unknown' }, textContent: '', disabled: false, addEventListener() {} };
}
async function evaluate(responses) {
  const dom = new Map(), calls = [];
  const getElementById = id => {
    if (!dom.has(id)) dom.set(id, node());
    return dom.get(id);
  };
  const fetch = async (path, options) => {
    calls.push({path, ...options});
    const entry = responses[path] ?? {status:503};
    const status = entry.status ?? 200;
    return {ok:status>=200 && status<300,status,json:async()=>entry.body??{}};
  };
  vm.runInNewContext(inline, { document:{getElementById},fetch,Promise,Date });
  // The page starts one async manual-refresh cycle during initialization.
  await new Promise(resolve=>setImmediate(resolve));
  return { dom, calls };
}

test('monitoring source is valid JS and navigation links are present',()=>{
  assert.ok(inline.includes('function set('));
  assert.doesNotThrow(()=>new vm.Script(inline));
  assert.ok(shell.includes("'/monitoring.html','Monitoring'"));
  assert.ok(chat.includes("['Monitoring','/monitoring.html']"));
});

test('owner dashboard reads only four existing endpoints and never mutates',async()=>{
  const {calls}=await evaluate({});
  assert.deepEqual(calls.map(x=>x.path).sort(),[
    '/api/brain/autonomy',
    '/api/brain/cloudflare-edge-health',
    '/api/brain/release-proof',
    '/api/brain/status-public'
  ]);
  assert.ok(calls.every(x=>x.method==='GET' && x.credentials==='same-origin' && x.cache==='no-store'));
});

test('actual active runtime does not conceal staging hold or unaccepted release',async()=>{
  const {dom}=await evaluate({
    '/api/brain/status-public':{body:{ok:true,status:'active',lastEventAt:'2026-11-22T01:00:00Z',scheduler:'hourly-configured'}},
    '/api/brain/cloudflare-edge-health':{body:{state:'observed',ingressAccepting:false,executionAuthorized:false}},
    '/api/brain/autonomy':{body:{ok:true,profile:{version:12,preset:'release',maxPaidCents:0,paused:false}}},
    '/api/brain/release-proof':{body:{verified:false,ci:{verified:true},driftDetails:{missingGates:['council-7of7']}}}
  });
  assert.equal(dom.get('monitor-runtime').dataset.state,'healthy');
  assert.equal(dom.get('monitor-edge').dataset.state,'hold');
  assert.equal(dom.get('monitor-autonomy').dataset.state,'healthy');
  assert.equal(dom.get('monitor-release').dataset.state,'hold');
  assert.equal(dom.get('monitor-release-state').textContent,'Not accepted');
  assert.match(dom.get('monitor-release-detail').textContent,/council-7of7/);
});

test('unauthorized and server-error readbacks never show healthy',async()=>{
  const {dom}=await evaluate({
    '/api/brain/status-public':{status:503},
    '/api/brain/cloudflare-edge-health':{status:403},
    '/api/brain/autonomy':{status:401},
    '/api/brain/release-proof':{status:500}
  });
  for(const id of ['runtime','edge','autonomy','release'])
    assert.equal(dom.get('monitor-'+id).dataset.state,'unknown');
  assert.equal(dom.get('monitor-autonomy-state').textContent,'Owner sign-in required');
});

test('separate Cloudflare and Hatchable telemetry is labeled, never fabricated',()=>{
  assert.match(html,/not ingested by this page/);
  assert.match(html,/Host logs only/);
  assert.ok(!inline.includes('innerHTML'));
  assert.ok(!inline.includes('setInterval'));
  assert.ok(!inline.includes("method:'POST'"));
});
