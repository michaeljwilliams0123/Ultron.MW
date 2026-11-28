import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createTestHarness} from 'wrangler';

const config = name => fileURLToPath(new URL('../'+name, import.meta.url));
test('native Worker rejects discovery before origin but forwards supported metadata', async () => {
  let calls=0;
  const origin=createServer((req,res)=>{
    calls++;
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({path:req.url}));
  });
  origin.listen(0,'127.0.0.1');
  await once(origin,'listening');
  const server=createTestHarness();
  try {
    await server.update({workers:[{
      configPath:config('wrangler.runtime-test.json'),
      vars:{HATCHABLE_CORE_ORIGIN:'http://127.0.0.1:'+origin.address().port},
      secrets:{ORIGIN_LOCK_SECRET:'runtime-test-fixture-only'},
    }]});
    await server.listen();
    for(const path of ['ucp','oauth-authorization-server','api-catalog','http-message-signatures-directory','%75cp///']){
      for(const method of ['GET','HEAD','POST','OPTIONS']){
        const res=await server.fetch('/.well-known/'+path,{method});
        assert.equal(res.status,404,path+' '+method);
        assert.equal(res.headers.get('cache-control'),'no-store');
        assert.match(res.headers.get('x-robots-tag'),/noindex/);
        assert.equal(await res.text(),method==='HEAD'?'':'{"error":"not_found"}');
      }
    }
    assert.equal(calls,0);
    const positive=await server.fetch('/.well-known/oauth-protected-resource/mcp');
    assert.equal(positive.status,200);
    assert.deepEqual(await positive.json(),{path:'/.well-known/oauth-protected-resource/mcp'});
    assert.equal(calls,1,'positive control proves origin counter is functional');
  }finally{
    try{await server.close();}finally{
      await new Promise((resolve,reject)=>origin.close(err=>err?reject(err):resolve()));
    }
  }
});
test('native preview entrypoint denies non-public operations',async()=>{
  const server=createTestHarness({workers:[{configPath:config('wrangler.preview.json')}]});
  try{
    await server.listen();
    const health=await server.fetch('/__ultron/health');
    assert.equal(health.status,200);
    assert.deepEqual(await health.json(),{ok:true,environment:'isolated-preview'});
    for(const path of ['/','/api/brain/control','/__ultron/admin','/__ultron/webhooks/github','/.well-known/oauth-protected-resource/mcp']){
      for(const method of ['GET','POST']){
        const res=await server.fetch(path,{method});
        assert.equal(res.status,404,path);
        assert.equal(res.headers.get('cache-control'),'no-store');
      }
    }
    const discovery=await server.fetch('/.well-known/ucp');
    assert.equal(discovery.status,404);
    assert.equal(await discovery.text(),'{"error":"not_found"}');
  }finally{await server.close();}
});
