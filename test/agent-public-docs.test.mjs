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

test('public guide exposes canonical metadata and valid JSON-LD',()=>{
  const html=docs['agent-guide.html'];
  assert.match(html,/rel="canonical" href="https:\/\/ultron-mw-cloud\.hatchable\.site\/agent-guide\.html"/);
  assert.match(html,/name="description" content="[^"]{50,}"/);
  assert.match(html,/property="og:title"/);
  assert.match(html,/property="og:description"/);
  const json=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(json['@type'],'WebPage');
  assert.equal(json['@context'],'https://schema.org');
  assert.equal(json.url,'https://ultron-mw-cloud.hatchable.site/agent-guide.html');
  assert.equal(json.dateModified,'2026-11-28');
});
test('HTML and Markdown share public guide content and explicit alternate discovery',()=>{
  const html=docs['agent-guide.html'],md=docs['agent-guide.md'];
  assert.match(html,/rel="alternate" type="text\/markdown" href="\/agent-guide\.md"/);
  assert.match(md,/^---\n/);
  assert.match(md,/canonical: https:\/\/ultron-mw-cloud\.hatchable\.site\/agent-guide\.html/);
  assert.match(md,/## Access boundaries/);
  assert.match(md,/## Sitemap/);
  for(const sentence of ['Ultron MW provides an owner-controlled interface for authorized automation.','Public documentation does not establish production acceptance or permit access to private operations.']){
    assert.ok(html.includes(sentence));assert.ok(md.includes(sentence));
  }
  assert.match(md,/\[Documentation sitemap\]/);
  assert.ok(docs['llms.txt'].includes('/agent-guide.md'));
});
test('schema vocabulary is not a general external-link exception',()=>{
  assert.throws(()=>validateAgentDocs({...docs,'agent-guide.md':docs['agent-guide.md']+'\n[external](https://schema.org)'}));
});
