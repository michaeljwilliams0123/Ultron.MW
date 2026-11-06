import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('every Git checkout selects the explicit bare-repository policy before checkout',async()=>{
  const directory=new URL('../.github/workflows/',import.meta.url);
  for(const name of await readdir(directory)){
    if(!/\.ya?ml$/.test(name))continue;
    const source=(await readFile(new URL(name,directory),'utf8')).replace(/\r\n/g,'\n');
    const policies=[...source.matchAll(/^      - name: Configure Git bare-repository policy\n        run: git config --global safe\.bareRepository explicit$/gm)];
    const checkouts=[...source.matchAll(/^(?:      - uses:|\s+uses:) actions\/checkout@/gm)];
    assert.equal(policies.length,checkouts.length,`${name} must configure every checkout runner`);
    for(let index=0;index<checkouts.length;index++)
      assert.ok(policies[index].index<checkouts[index].index,`${name} must configure Git before checkout`);
  }
});
