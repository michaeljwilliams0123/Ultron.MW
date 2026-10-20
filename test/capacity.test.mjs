import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityLimits } from '../src/capacity.mjs';
import { parseMultiFileRequest } from '../src/pr-brain-multifile.mjs';

const six='docs/a.md, docs/b.md, docs/c.md, docs/d.md, docs/e.md, docs/f.md';
test('historical velocity capability is throughput-only with proof gates permanently enforced',()=>{
  for(const env of [{},{ULTRON_CAPACITY:'expanded'},{ULTRON_CAPACITY:'unrecognized'},
    {ULTRON_CAPACITY:'expanded',ULTRON_VELOCITY:'1'}]){
    const limits=capacityLimits(env);
    assert.equal(limits.requiredVerify,'blocking');
    assert.equal(limits.modelSafety,'enforced');
    assert.equal(limits.permissionMode,'owner-only');
    assert.equal(limits.maxFileBytes,6500);
    assert.ok(limits.maxTotalBytes<=22000);
    assert.ok(limits.maxFiles<=6);
  }
});
test('six-file source capacity requires explicit opt-in and never accepts unsafe workflow paths',()=>{
  const request='implement files '+six+': change both flags from pending to verified';
  assert.equal(parseMultiFileRequest(request,{env:{}}).kind,'invalid-multi');
  const accepted=parseMultiFileRequest(request,{env:{ULTRON_CAPACITY:'expanded'}});
  assert.equal(accepted.kind,'implement-multi');
  assert.equal(accepted.paths.length,6);
  assert.equal(parseMultiFileRequest('implement files '+six+', docs/g.md: change from pending to verified',
    {env:{ULTRON_CAPACITY:'expanded'}}).kind,'invalid-multi');
  assert.equal(parseMultiFileRequest('implement files '+six.replace('docs/f.md','.github/workflows/verify.yml')+
    ': change from pending to verified',{env:{ULTRON_CAPACITY:'expanded'}}).kind,'invalid-multi');
});
