import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {RETAINED_ROUTES} from '../src/route-reference-audit.mjs';
test('CLI includes tracked TypeScript modules referenced by JavaScript tests and detects their absence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ultron-ts-audit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const queue='cloudflare/edge-shield/src/queue.ts',testPath='test/wakeup.test.mjs';
 for(const path of [...RETAINED_ROUTES,'src/route-reference-audit.mjs','scripts/audit-route-references.mjs',queue,testPath]){
  await mkdir(dirname(join(root,path)),{recursive:true});
  const content=path.startsWith('src/')||path.startsWith('scripts/audit-')?await readFile(new URL('../'+path,import.meta.url)):
   path===testPath?"import '../cloudflare/edge-shield/src/queue.ts';":'';
  await writeFile(join(root,path),content);
 }
 execFileSync('git',['init','-q'],{cwd:root});
 execFileSync('git',['add','.'],{cwd:root});
 execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:root});
 const run=()=>spawnSync(process.execPath,[join(root,'scripts/audit-route-references.mjs')],{encoding:'utf8'});
 const good=run();assert.equal(good.status,0,good.stdout);
 assert.deepEqual(JSON.parse(good.stdout).unresolvedModuleReferences,[]);
 await rm(join(root,queue));const bad=run();assert.equal(bad.status,1);
 assert.equal(JSON.parse(bad.stdout).unresolvedModuleReferences[0].specifier,'../cloudflare/edge-shield/src/queue.ts');
});
