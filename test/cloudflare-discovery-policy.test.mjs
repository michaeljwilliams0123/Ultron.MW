import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unsupportedDiscoveryResponse} from '../cloudflare/edge-shield/src/discovery-policy.ts';

const unsupported=['ucp','oauth-authorization-server','api-catalog','http-message-signatures-directory'];
for(const name of unsupported){
  test('unsupported '+name+' returns truthful 404 without origin traffic',async()=>{
    for(const suffix of ['', '/']){
      const response=unsupportedDiscoveryResponse('/.well-known/'+name+suffix,'GET');
      assert.equal(response.status,404);
      assert.match(response.headers.get('content-type'),/^application\/json/);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
      assert.deepEqual(await response.json(),{error:'not_found'});
    }
    const head=unsupportedDiscoveryResponse('/.well-known/'+name,'HEAD');
    assert.equal(head.status,404);
    assert.equal(await head.text(),'');
  });
}
test('supported MCP metadata, normal UI and API routes are untouched',()=>{
  for(const path of ['/.well-known/oauth-protected-resource/mcp','/','/index.html','/api/brain/status','/openapi.json','/other']){
    assert.equal(unsupportedDiscoveryResponse(path,'GET'),null);
  }
});
test('edge invokes discovery policy before origin proxy',()=>{
  const source=readFileSync(new URL('../cloudflare/edge-shield/src/index.ts',import.meta.url),'utf8');
  assert.match(source,/const discovery = unsupportedDiscoveryResponse\(path, request\.method\);\s*if \(discovery\) return applyOwnHeaders\(discovery\);/);
  assert.ok(source.indexOf('const discovery =')<source.indexOf('await proxyToOrigin('));
});
