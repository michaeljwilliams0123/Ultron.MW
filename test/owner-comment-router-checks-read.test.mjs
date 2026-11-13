import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/owner-comment-router.yml',import.meta.url),'utf8');

test('owner Council comment router retains the checks read scope required after PR #397',()=>{
 const council=workflow.split('\n  council-command:\n')[1]?.split('\n  codex-trigger-audit:\n')[0];
 assert.ok(council,'consolidated Council command route must exist');
 assert.match(council,/^    permissions:\n(?:      [^\n]+\n)+/m);
 assert.match(council,/^      checks: read$/m,
   'nested Council workflow needs caller checks:read to inspect required statuses');
 assert.match(workflow,/^name: Ultron owner comment router$/m);
});
