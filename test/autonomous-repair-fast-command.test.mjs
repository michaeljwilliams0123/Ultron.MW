import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('fast repair command is fixed, token-free, and never substitutes for full exact-head CI',()=>{
 const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const source=readFileSync(new URL('../scripts/verify-fast.mjs',import.meta.url),'utf8');
 assert.equal(packageJson.scripts['verify:fast'],'node scripts/verify-fast.mjs');
 assert.match(source,/spawnSync\(process\.execPath/);
 assert.match(source,/shell:false/);
 assert.match(source,/NODE_ENV:'test'/);
 assert.doesNotMatch(source,/execSync|shell:true|git add|github-token|GITHUB_TOKEN:/i);
 assert.match(source,/Exact-head GitHub Verify remains mandatory/);
});
