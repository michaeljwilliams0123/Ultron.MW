import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildAgentDocs} from '../scripts/build-agent-docs.mjs';

const publicDir=new URL('../cloud/hatchable/public/',import.meta.url);
const read=path=>readFileSync(new URL(path,publicDir),'utf8').replace(/\r\n/g,'\n');
test('robots permits only exact curated documentation paths',()=>{
  const expected=['User-agent: *','Disallow: /',...Object.keys(buildAgentDocs()).sort().map(p=>'Allow: /'+p+'$'),'Sitemap: https://ultron-mw-cloud.hatchable.site/sitemap.xml'];
  assert.deepEqual(read('robots.txt').split('\n').filter(Boolean),expected);
});
test('all public-facing HTML retains explicit noindex and nofollow',()=>{
  for(const path of readdirSync(publicDir).filter(p=>p.endsWith('.html'))){
    const html=read(path);
    assert.match(html,/<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/i,path);
    assert.doesNotMatch(html,/<meta\s+name="robots"[^>]*(?:max-snippet|max-image-preview)/i,path);
  }
});
test('generated sitemaps list only the approved documentation, not operator routes',()=>{
  const paths=new Set(Object.keys(buildAgentDocs()));
  for(const m of read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)){
    const u=new URL(m[1]);
    assert.equal(u.origin,'https://ultron-mw-cloud.hatchable.site');
    assert.ok(paths.has(u.pathname.slice(1)));
    assert.equal(u.search,'');
  }
});
test('existing zero-secret contract job explicitly checks docs and crawl policy',()=>{
  const yml=readFileSync(new URL('../.github/workflows/contract-validation.yml',import.meta.url),'utf8');
  assert.match(yml,/run: node --test test\/agent-public-docs\.test\.mjs test\/agent-crawler-policy\.test\.mjs/);
});
test('all 42 scanner findings have unique, truthful dispositions',()=>{
  const doc=readFileSync(new URL('../docs/agent-readiness-disposition.md',import.meta.url),'utf8');
  const expected=['S1','S2','S3','S4','S5','S7','S8','S9','S10','S11','S12','S13','S15','P5','P6','P7','P8','P10','P11','P14','P15','P16','P17','P18','P19','P20','P24','P25',...Array.from({length:10},(_,i)=>'L'+(i+1)),'C8','C9','C13','C14'];
  const ids=[...doc.matchAll(/^\| ([SPLC]\d+) \|/gm)].map(m=>m[1]);
  assert.deepEqual(ids.sort(),expected.sort());
  assert.match(doc,/No post-release scan or deployed acceptance has been established/);
});
