import { test } from 'node:test';
import assert from 'node:assert/strict';
import {parseCloudStatus,fetchCloudStatus,CLOUD_STATUS_URL} from '../docs/core/cloud-status.mjs';
const good={schema:'ultron.cloud-status.v1',ok:true,status:'active',
  observedAt:'2026-10-29T04:00:00.000Z',lastEventAt:null,
  scheduler:'hourly-configured',ownerOperations:'protected'};
test('public status gives only verified operational fields',()=>{
  assert.deepEqual({...parseCloudStatus(good)},{
    status:'active',observedAt:good.observedAt,lastEventAt:null,scheduler:'hourly-configured'
  });
  assert.equal(parseCloudStatus({...good,status:'paused'}).status,'paused');
});
test('rejects fabricated, malformed and unauthorized status envelopes',()=>{
  for(const x of [null,{}, {...good,ok:false}, {...good,status:'admin'},
    {...good,schema:'other'}, {...good,ownerOperations:'public'},
    {...good,lastEventAt:'not-a-date'}]) assert.throws(()=>parseCloudStatus(x));
});
test('cross-origin request uses no browser identity or secret', async()=>{
  let called=0;
  const actual=await fetchCloudStatus(async (url,opts)=>{
    called++;
    assert.equal(url,CLOUD_STATUS_URL);
    assert.deepEqual(opts,{method:'GET',mode:'cors',cache:'no-store',credentials:'omit'});
    return {ok:true,json:async()=>good};
  });
  assert.equal(called,1);assert.equal(actual.status,'active');
  await assert.rejects(fetchCloudStatus(async()=>({ok:false})),/unavailable/);
});
