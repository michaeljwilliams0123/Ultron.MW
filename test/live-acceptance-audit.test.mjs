import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_CHECKS, parsePagesRevision, evaluateAcceptance, renderAcceptanceMarkdown
} from '../src/live-acceptance-audit.mjs';

const PASS = [
  {id:'github-main',status:'pass',detail:'Expected SHA retrieved'},
  {id:'github-verify',status:'pass',detail:'Successful exact-main push verification'},
  {id:'pages-http',status:'pass',detail:'HTTP 200'},
  {id:'pages-revision',status:'pass',detail:'Exact main SHA'},
  {id:'pages-module',status:'pass',detail:'HTTP 200'},
  {id:'production-http',status:'pass',detail:'HTTP 200'},
  {id:'production-admin-gate',status:'pass',detail:'Anonymous access refused (401)'},
  {id:'production-scheduler-gate',status:'pass',detail:'External execution refused (404)'}
];
const SHA='ee620f2dec1d41a5b283a46286d9f5446fad622f';

test('extract Pages exact SHA without mistaking arbitrary HTML for a deployed revision',()=>{
  assert.equal(parsePagesRevision('<meta name="ultron-source-sha" content="'+SHA+'">'),SHA);
  assert.equal(parsePagesRevision('<meta content="'+SHA+'" name="ultron-source-sha">'),SHA);
  assert.equal(parsePagesRevision('<title>'+SHA+'</title>'),null);
  assert.equal(parsePagesRevision('<meta name="ultron-source-sha" content="unresolved-template">'),null);
});

test('healthy public readbacks cannot assert private, cross-provider or browser acceptance',()=>{
  const result=evaluateAcceptance({sourceSha:SHA,observedAt:'2026-10-28T20:00:00.000Z',checks:PASS});
  assert.equal(result.publicReadiness,'observed-healthy');
  assert.equal(result.productionReadiness,'not-accepted');
  assert.equal(result.evidenceBoundary.privateAuthenticatedReadback,'not-tested');
  assert.equal(result.evidenceBoundary.externalWriteReconciliation,'not-tested');
  assert.equal(result.evidenceBoundary.ownerBrowserExecution,'not-tested');
  assert.equal(result.evidenceBoundary.independentLearning,'not-tested');
  assert.equal(result.counts.passed,PASS.length);
});

test('missing check is unknown, not healthy, and duplicate checks cannot mask a failure',()=>{
  const missing=evaluateAcceptance({sourceSha:SHA,checks:PASS.slice(1)});
  assert.equal(missing.publicReadiness,'incomplete');
  assert.ok(missing.checks.some(x=>x.id==='github-main'&&x.status==='unknown'));
  const conflicting=evaluateAcceptance({sourceSha:SHA,checks:[
    ...PASS,{id:'pages-http',status:'fail',detail:'HTTP 503'}
  ]});
  assert.equal(conflicting.publicReadiness,'degraded');
  assert.equal(conflicting.checks.find(x=>x.id==='pages-http').status,'fail');
});

test('invalid caller assertion and arbitrary text cannot silently become a passing control',()=>{
  const check=PASS.map(x=>({...x}));
  check.find(x=>x.id==='production-admin-gate').status='maybe';
  const result=evaluateAcceptance({sourceSha:SHA,checks:check});
  assert.equal(result.publicReadiness,'incomplete');
  assert.equal(result.checks.find(x=>x.id==='production-admin-gate').status,'unknown');
});

test('markdown is an inspectable summary with evidence boundaries and canonical issues',()=>{
  const result=evaluateAcceptance({sourceSha:SHA,checks:PASS,observedAt:'2026-10-28T20:00:00Z'});
  const report=renderAcceptanceMarkdown(result);
  assert.match(report,/GitHub Pages/);
  assert.match(report,/not-accepted/);
  assert.match(report,/issues\/67/);
  assert.match(report,/issues\/65/);
  assert.doesNotMatch(report,/private access confirmed|complete autonomous acceptance/i);
});

test('one production Hatchable surface is checked without calling the retired experiment',async()=>{
 assert.equal(REQUIRED_CHECKS.length,8);
 assert.equal(REQUIRED_CHECKS.some(x=>x.id==='experimental-isolation'),false);
 const script=await readFile(new URL('../scripts/live-acceptance-audit.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(script,/up3slz|EXPERIMENT|experimental-isolation/);
 assert.match(script,/ultron-mw-cloud\\.hatchable\\.site/);
});
