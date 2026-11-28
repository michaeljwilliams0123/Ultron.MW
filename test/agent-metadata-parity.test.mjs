import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgentDocs} from '../scripts/build-agent-docs.mjs';
const docs=buildAgentDocs();
test('full documentation contains the actual Markdown guide, not just its index',()=>{
  const body=docs['agent-guide.md'].replace(/^---\n[\s\S]*?\n---\n\n/,'');
  assert.ok(body.startsWith('# Ultron MW agent guide'));
  assert.ok(docs['llms-full.txt'].includes(body));
});
test('shared navigation has no missing HTML or Markdown target',()=>{
  const html=docs['agent-guide.html'],md=docs['agent-guide.md'];
  const htmlLinks=[...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(m=>[m[1],m[2]]);
  for(const [url,label] of htmlLinks)assert.ok(md.includes('['+label+']('+url+')'),url);
  assert.equal(new Set(htmlLinks.map(x=>x[0])).size,htmlLinks.length);
});
test('structured metadata agrees with canonical page and visible title',()=>{
  const html=docs['agent-guide.html'];
  const structured=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(structured.url,html.match(/rel="canonical" href="([^"]+)"/)[1]);
  assert.equal(structured.name,html.match(/<h1>([^<]+)<\/h1>/)[1]);
  assert.equal(structured.description,html.match(/name="description" content="([^"]+)"/)[1]);
  assert.equal(structured.url,html.match(/property="og:url" content="([^"]+)"/)[1]);
});
