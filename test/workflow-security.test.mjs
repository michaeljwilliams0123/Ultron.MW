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
  assert.match(source,/node scripts\/verify-audited-lockfile\.mjs/);
  assert.doesNotMatch(source,/continue-on-error/);
  assert.match(source,/import\('@huggingface\/transformers'\)/);
  assert.match(source,/bash scripts\/lint-workflows.sh/);
  assert.match(source,/node scripts\/verify.mjs/);
});

test('all workflow actions are SHA-pinned and checkout never persists credentials',async()=>{
  const directory=new URL('../.github/workflows/',import.meta.url);
  for(const name of await readdir(directory)){
    if(!/\.ya?ml$/.test(name))continue;
    const source=await readFile(new URL(name,directory),'utf8');
    const allowedLocal=new Set([
      './.github/workflows/cloud-objective.yml',
      './.github/workflows/pr-brain.yml',
      './.github/workflows/council-debate.yml'
    ]);
    for(const [,action] of source.matchAll(/\buses:\s*([^\s#]+)/g)){
      if(action.startsWith('./')){
        // Only same-repository, explicit reusable workflows are permitted.
        // External actions remain required to use immutable 40-digit SHA pins.
        assert.ok(allowedLocal.has(action),name+': unapproved local reusable workflow '+action);
      }else assert.match(action,/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/,name);
    }
    if(/\buses:\s*actions\/checkout@/.test(source))
      assert.match(source,/persist-credentials: false/,name);
    assert.doesNotMatch(source,/\$\{\{\s*github\.event\.(?:issue\.body|inputs\.objective)/,name);
  }
});
