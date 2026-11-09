import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePayloadAST, TAINT_IR_VERSION } from '../src/security/ast_taint_analyzer.mjs';
const scan = code => analyzePayloadAST(code);
const sinks = code => scan(code).flows.map(flow => flow.sink);

test('clean code produces bounded no-known-flow rather than an authorization', () => {
  const result = scan("const command = 'fixed'; console.log(command);");
  assert.equal(result.schema, TAINT_IR_VERSION);
  assert.equal(result.status, 'no-known-flow');
  assert.equal(result.isSafe, true);
  assert.equal(result.coverage.scope, 'single-snippet');
});

test('flags direct evaluation and constructor sinks even with literal input', () => {
  assert.ok(sinks('eval("2 + 2")').includes('eval'));
  assert.ok(sinks('new Function("return 1")').includes('Function'));
  assert.ok(sinks("globalThis['eval']('1')").includes('globalThis.eval'));
  assert.ok(sinks('const execute = eval; execute("1")').includes('execute'));
});

test('propagates aliases from request bodies to imported shell command execution', () => {
  const result = scan("import {exec as run} from 'node:child_process';\nconst raw = req.body;\nconst cmd = raw.command;\nrun(cmd);");
  assert.equal(result.status, 'findings');
  assert.ok(result.flows.some(flow => flow.sink === 'run' && flow.sources.includes('req')));
  assert.ok(result.ir.edges.some(edge => edge.to === 'cmd'));
});

test('constant command execution is not a tainted flow', () => {
  const result = scan("import {exec} from 'node:child_process'; exec('echo fixed')");
  assert.equal(result.status, 'no-known-flow');
});

test('resolves namespace imports and CommonJS child_process calls', () => {
  assert.ok(sinks("import * as cp from 'node:child_process'; cp.execSync(req.body.cmd)").includes('cp.execSync'));
  assert.ok(sinks("const cp = require('child_process'); cp.exec(req.body.cmd)").includes('cp.exec'));
});

test('follows interprocedural returns and records a call graph', () => {
  const result = scan("function forward(value) { return value; }\nconst param = forward(request.query.value);\neval(param);");
  assert.ok(result.ir.callGraph.some(edge => edge.callee === 'forward'));
  assert.ok(result.flows.some(flow => flow.sink === 'eval' && flow.sources.includes('request')));
});

test('handles arrow functions, destructuring and unresolved dynamic dispatch conservatively', () => {
  const result = scan("const take = x => x;\nconst {cmd} = req.body;\nconst value = take(cmd);\nhandlers[req.body.action](value);");
  assert.equal(result.isSafe, false);
  assert.equal(result.status, 'unknown');
});

test('flags HTML assignment sinks including static computed properties', () => {
  assert.ok(sinks('element.innerHTML = userInput').includes('element.innerHTML'));
  assert.ok(sinks("element['outerHTML'] = req.body.html").includes('element.outerHTML'));
  assert.ok(sinks('frame.srcdoc = req.body.html').includes('frame.srcdoc'));
});

test('flags HTML writer and document.cookie access', () => {
  assert.ok(sinks("element.insertAdjacentHTML('beforeend', payload.html)").includes('element.insertAdjacentHTML'));
  assert.ok(sinks('document.write(req.body.markup)').includes('document.write'));
  assert.ok(sinks("const secret = document['cookie']").includes('document.cookie'));
});

test('preserves taint across the branches of a conditional', () => {
  const result = scan("import {exec} from 'node:child_process';\nlet value = 'fixed';\nif (event.ok) { value = event.body; } else { value = 'safe'; }\nexec(value);");
  assert.ok(result.flows.some(flow => flow.sink === 'exec' && flow.sources.includes('event')));
});

test('parses TypeScript assertions without executing the source', () => {
  const result = scan('const value: string = req.body.code as string; eval(value);');
  assert.ok(result.flows.some(flow => flow.sink === 'eval' && flow.sources.includes('req')));
});

test('parser failures are not safe verdicts', () => {
  for (const value of ['function (', 'x'.repeat(66000), null]) {
    const result = scan(value);
    assert.equal(result.status, 'parse-error');
    assert.equal(result.isSafe, false);
    assert.match(result.violations[0], /^AST Parsing Failure/);
  }
});

test('the analyzer never evaluates a payload', () => {
  globalThis.__taintCanary = 0;
  const result = scan('globalThis.__taintCanary += 1;');
  assert.equal(globalThis.__taintCanary, 0);
  assert.equal(result.status, 'no-known-flow');
  delete globalThis.__taintCanary;
});
