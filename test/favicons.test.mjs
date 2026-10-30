import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const src = new URL('../', import.meta.url);
test('canonical Pages and Hatchable landing declare the same local vector icon',async()=>{
 for (const file of ['docs/index.html','cloud/hatchable/public/index.html']){
  const html=await readFile(new URL(file,src),'utf8');
  assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg">/);
  assert.equal((html.match(/rel="icon"/g)||[]).length,1);
 }
});

test('both public UIs ship an identical self-contained icon without external requests',async()=>{
 const [pages,hosted]=await Promise.all([
  readFile(new URL('docs/favicon.svg',src),'utf8'),
  readFile(new URL('cloud/hatchable/public/favicon.svg',src),'utf8')
 ]);
 assert.equal(pages,hosted,'UI favicons must remain byte-identical');
 assert.match(pages,/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="0 0 64 64"/);
 assert.match(pages,/<title>Ultron\.MW<\/title>/);
 assert.doesNotMatch(pages,/<(script|image|foreignObject)\b|(?:xlink:)?href=|url\(https?:/i);
});
