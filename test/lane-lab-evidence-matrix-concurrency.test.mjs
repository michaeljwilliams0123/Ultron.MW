import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Regression: the 26->8 cutover (#418) moved the legacy workflow-level
// concurrency groups onto matrix jobs. A job-level group is shared by every
// matrix cell, so GitHub keeps one running + one pending and cancels the rest
// (observed on run 43035747613). Each matrix job's group must include every
// matrix key so cells never cancel each other.
const yml=readFileSync(new URL('../.github/workflows/lane-lab-evidence.yml',import.meta.url),'utf8');
const jobs=[...yml.matchAll(/^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n|(?![\s\S]))/gm)];

test('every matrix job in lane-lab-evidence keys its concurrency group by all matrix axes',()=>{
 let checked=0;
 for(const [,name,body] of jobs){
  const matrix=/\n      matrix:\n((?:        [a-z_]+: .*\n)+)/.exec(body);
  if(!matrix)continue;
  const axes=[...matrix[1].matchAll(/^        ([a-z_]+):/gm)].map(m=>m[1]);
  const group=/\n    concurrency:\n      group: (.*)\n/.exec(body)?.[1];
  assert.ok(group,name+' has a job-level concurrency group');
  for(const axis of axes)assert.ok(group.includes('${{ matrix.'+axis+' }}'),name+' group must include matrix.'+axis);
  assert.match(body,/\n      cancel-in-progress: false\n/);
  checked++;
 }
 assert.equal(checked,2,'heldout-evaluation and cpu-evaluation');
});

test('workflow name and run-name stay byte-stable for Hatchable receipt keys',()=>{
 assert.match(yml,/^name: Ultron lab evidence$/m);
 assert.match(yml,/^run-name: "\$\{\{ inputs\.lab_task == 'held-out-acceptance' && format\('Ultron held-out acceptance \{0\}\.\.\{1\}', inputs\.baseline_sha, inputs\.candidate_sha\) \|\| format\('Ultron lab evidence: \{0\}', inputs\.lab_task\) \}\}"$/m);
});
