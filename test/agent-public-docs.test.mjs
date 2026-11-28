import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgentDocs, validateAgentDocs } from '../scripts/build-agent-docs.mjs';

const docs = buildAgentDocs();
test('public docs are bounded and generated assets match curated source',()=>{
  assert.equal(validateAgentDocs(docs),true);
  for(const [path,body] of Object.entries(docs)){
    assert.equal(readFileSync(new URL('../cloud/hatchable/public/'+path,import.meta.url),'utf8').replace(/\r\n/g,'\n'),body);
  }
});
test('llms index has H1, summary, sections and absolute public links',()=>{
  assert.match(docs['llms.txt'],/^# Ultron MW\n\n> /);
  assert.match(docs['llms.txt'],/## Documentation\n- \[/);
  assert.match(docs['llms.txt'],/## Optional/);
  assert.match(docs['llms-full.txt'],/# Agent guidance/);
  assert.match(docs['llms-full.txt'],/# Glossary/);
});
test('sitemap uses only approved documentation URLs and fixed content modification date',()=>{
  const urls=[...docs['sitemap.xml'].matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>x[1]);
  assert.deepEqual(urls,['agent-guide.html','AGENTS.md','glossary.md'].map(p=>'https://ultron-mw-cloud.hatchable.site/'+p));
  assert.equal([...docs['sitemap.xml'].matchAll(/<lastmod>2026-11-28<\/lastmod>/g)].length,3);
});
test('public guide preserves noindex and exposes only safe discovery',()=>{
  assert.match(docs['agent-guide.html'],/name="robots" content="noindex,nofollow"/);
  assert.match(docs['agent-guide.html'],/rel="describedby" href="\/llms.txt"/);
  assert.match(readFileSync(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8'),/noindex,nofollow/);
});
test('reject external, private, query-string and unknown links',()=>{
  for(const target of ['https://example.com/AGENTS.md','https://ultron-mw-cloud.hatchable.site/api/brain/status','https://ultron-mw-cloud.hatchable.site/release-owner.html','https://ultron-mw-cloud.hatchable.site/AGENTS.md?x=1']){
    assert.throws(()=>validateAgentDocs({...docs,'llms.txt':docs['llms.txt']+'\n- [invalid]('+target+')\n'}));
  }
});
test('reject unapproved assets and credential-shaped material',()=>{
  assert.throws(()=>validateAgentDocs({...docs,'private.md':'internal'}));
  assert.throws(()=>validateAgentDocs({...docs,'llms.txt':docs['llms.txt']+'\n'+'gh'+'p_'+'A'.repeat(32)}),/private-material/);
  assert.throws(()=>validateAgentDocs({...docs,'llms.txt':'a'.repeat(16385)}),/invalid-document-size/);
});
