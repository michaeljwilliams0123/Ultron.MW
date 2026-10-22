import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalJson, snapshotSha, contentDigest, evaluateHubEntry, verifyGitHubs } from '../src/git-hubs.mjs';

const root=resolve(import.meta.dirname,'..');
const stage=async()=>{
  const temp=await mkdtemp(join(tmpdir(),'ultron-git-hub-'));
  await cp(join(root,'hubs'),join(temp,'hubs'),{recursive:true});
  await mkdir(join(temp,'test'),{recursive:true});
  await writeFile(join(temp,'test/git-hubs.test.mjs'),'// fixture for test-path existence');
  await writeFile(join(temp,'test/learning.test.mjs'),'// fixture for test-path existence');
  return temp;
};
test('canonical SHA preserves nested properties while ignoring object insertion order',()=>{
  const one={name:'x',nested:{b:2,a:1},data:[{x:1,y:2}]};
  const other={data:[{y:2,x:1}],nested:{a:1,b:2},name:'x'};
  assert.equal(snapshotSha(one),snapshotSha(other));
  assert.notEqual(snapshotSha(one),snapshotSha({name:'x',nested:{b:2,a:9},data:[{x:1,y:2}]}));
  assert.equal(snapshotSha(one).length,64);
  assert.throws(()=>canonicalJson({bad:Infinity}),/non-finite/);
});
test('hub content fingerprints are stable across Git line-ending conversion',()=>{
  const lf='# Skill: Portable\n## Inputs\n## Fail-Closed Rules\n## Test Evidence\n';
  assert.equal(contentDigest(lf),contentDigest(lf.replaceAll('\n','\r\n')));
});
test('all public Git hubs pass committed integrity and reference gates',async()=>{
  const verified=await verifyGitHubs(root);
  assert.equal(verified.accepted,4);
  assert.deepEqual(verified.byType,{memory:1,skill:2,harness:1});
});
test('tampered memory or skill contents cannot pass the committed digest',async()=>{
  const temp=await stage();
  try{
    const path=join(temp,'hubs/memory/architecture-authority.json');
    await writeFile(path,(await readFile(path,'utf8')).replace('read-only','arbitrary'));
    await assert.rejects(()=>verifyGitHubs(temp),/fingerprint mismatch/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('skill formatting is not sufficient to bypass code provenance',()=>{
  const source='# Skill: Dangerous\n## Inputs\n## Fail-Closed Rules\n## Test Evidence\ntest/git-hubs.test.mjs\n';
  assert.throws(()=>evaluateHubEntry({entry:{kind:'skill',id:'danger',revision:1,
    path:'hubs/skills/danger/SKILL.md',sha256:contentDigest(source),tests:['test/missing.test.mjs']},
    source,tests:['test/git-hubs.test.mjs']}),/missing verified test/);
});
test('new harness cannot obtain shell, secret, merge or deployment authority',()=>{
  const source='{"kind":"harness","id":"owner-workflow","revision":1,"authority":"admin","commands":["shell"],"skills":["repo-review"]}';
  assert.throws(()=>evaluateHubEntry({entry:{kind:'harness',id:'owner-workflow',revision:1,
    path:'hubs/harness/owner-workflow.json',sha256:contentDigest(source),tests:['test/git-hubs.test.mjs']},
    source,tests:['test/git-hubs.test.mjs']}),/cannot grant operations/);
});
test('invalid test references, duplicate entries, or incomplete catalog block admission',async()=>{
  const temp=await stage();
  try{
    const index=join(temp,'hubs/catalog.json');
    const catalog=JSON.parse(await readFile(index,'utf8'));
    catalog.entries.push({...catalog.entries[0]});
    await writeFile(index,JSON.stringify(catalog));
    await assert.rejects(()=>verifyGitHubs(temp),/duplicate entry/);
    catalog.entries.pop();catalog.entries[0].tests=['test/fake.test.mjs'];
    await writeFile(index,JSON.stringify(catalog));
    await assert.rejects(()=>verifyGitHubs(temp),/ENOENT/);
    catalog.entries[0].tests=['test/git-hubs.test.mjs'];
    catalog.entries[0].path='../../private-data.json';
    await writeFile(index,JSON.stringify(catalog));
    await assert.rejects(()=>verifyGitHubs(temp),/path outside allowlist/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
