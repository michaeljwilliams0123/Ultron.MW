import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('every PR including workflow-only changes runs verification at its exact head',async()=>{
  const source=(await readFile(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8'))
    .replace(/\r\n/g,'\n');
  assert.match(source,/\n  pull_request:/);
  assert.doesNotMatch(source,/\bpaths(?:-ignore)?:|pull_request_target/);
  assert.match(source,/ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(source,/permissions:\n  contents: read\n/);
  assert.doesNotMatch(source,/issues: write|contents: write|secrets\./);
  assert.match(source,/npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(source,/npx --yes npm@11\.9\.0 audit --omit=dev --audit-level=high/);
  assert.match(source,/import\('@huggingface\/transformers'\)/);
  assert.match(source,/bash scripts\/lint-workflows.sh/);
  assert.match(source,/node scripts\/verify.mjs/);
});

test('all workflow actions are SHA-pinned and checkout never persists credentials',async()=>{
  const directory=new URL('../.github/workflows/',import.meta.url);
  for(const name of await readdir(directory)){
    if(!/\.ya?ml$/.test(name))continue;
    const source=await readFile(new URL(name,directory),'utf8');
    for(const [,action] of source.matchAll(/\buses:\s*([^\s#]+)/g))
      assert.match(action,/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/,name);
    assert.match(source,/persist-credentials: false/,name);
    assert.doesNotMatch(source,/\$\{\{\s*github\.event\.(?:issue\.body|inputs\.objective)/,name);
  }
});
