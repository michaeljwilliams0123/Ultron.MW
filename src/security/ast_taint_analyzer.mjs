import { parse } from '@babel/parser';

// Advisory, bounded JS/TS analysis. This code only parses source; it never evaluates it.
export const TAINT_IR_VERSION = 'ultron.taint-ir.v1';
const MAX_BYTES = 64 * 1024;
const MAX_NODES = 8000;
const MAX_CALL_DEPTH = 12;
const MAX_IR_EDGES = 1000;
const USER_INPUTS = new Set(['req', 'request', 'event', 'payload', 'params', 'input', 'userInput', 'message', 'webhook']);
const EXEC_METHODS = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);
const NODE_FIELDS = new Set(['loc', 'start', 'end', 'leadingComments', 'innerComments', 'trailingComments', 'extra', 'tokens', 'comments', 'errors']);

function property(node) {
  if (!node) return null;
  if (node.type === 'Identifier' && !node.computed) return node.name;
  if (node.type === 'StringLiteral' || node.type === 'Literal') return String(node.value);
  return null;
}
function memberName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null;
  const object = memberName(node.object);
  const key = node.computed ? property(node.property) : node.property?.name;
  return object && key != null ? object + '.' + key : null;
}
const union = (...values) => new Set(values.flatMap(x => [...(x || [])]));
const clone = env => new Map([...env].map(([k, v]) => [k, new Set(v)]));
function bind(pattern, origins, env, edges, line) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') {
    env.set(pattern.name, new Set(origins));
    if (origins.size && edges.length < MAX_IR_EDGES)
      for (const source of origins) edges.push({ from: source, to: pattern.name, line });
  } else if (pattern.type === 'AssignmentPattern') bind(pattern.left, origins, env, edges, line);
  else if (pattern.type === 'RestElement') bind(pattern.argument, origins, env, edges, line);
  else if (pattern.type === 'ObjectPattern') {
    for (const p of pattern.properties) bind(p.value || p.argument, origins, env, edges, line);
  } else if (pattern.type === 'ArrayPattern') {
    for (const p of pattern.elements) bind(p, origins, env, edges, line);
  }
}
function mergeEnv(target, a, b) {
  for (const key of new Set([...a.keys(), ...b.keys()])) target.set(key, union(a.get(key), b.get(key)));
}

export function analyzePayloadAST(codeSnippet) {
  const violations = [];
  const flows = [];
  const edges = [];
  const callGraph = [];
  const unknowns = [];
  const reported = new Set();
  const functions = new Map();
  const imports = new Map();
  const moduleNames = new Set(['child_process']);
  let nodes = 0;

  function result(status) {
    return {
      schema: TAINT_IR_VERSION,
      isSafe: status === 'no-known-flow', // Not a certification of safety.
      status,
      violations,
      flows,
      ir: { edges, callGraph },
      unknowns,
      coverage: { parsed: status !== 'parse-error', visitedNodes: nodes, language: 'javascript-typescript', scope: 'single-snippet' },
    };
  }
  if (typeof codeSnippet !== 'string' || Buffer.byteLength(codeSnippet, 'utf8') > MAX_BYTES) {
    violations.push('AST Parsing Failure: non-string or oversized input');
    return result('parse-error');
  }
  let ast;
  try {
    ast = parse(codeSnippet, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'], errorRecovery: false });
  } catch (error) {
    violations.push('AST Parsing Failure: ' + (error instanceof Error ? error.message.slice(0, 200) : 'invalid syntax'));
    return result('parse-error');
  }
  try {
    function visit(node, fn) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) visit(child, fn); return; }
      if (typeof node.type !== 'string') return;
      if (++nodes > MAX_NODES) throw new Error('AST node budget exceeded');
      fn(node);
      for (const [field, value] of Object.entries(node)) {
        if (!NODE_FIELDS.has(field) && value && typeof value === 'object') visit(value, fn);
      }
    }
    visit(ast.program, node => {
      if (node.type === 'FunctionDeclaration' && node.id?.name) functions.set(node.id.name, node);
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' &&
        ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) functions.set(node.id.name, node.init);
      if (node.type === 'ImportDeclaration' && ['child_process', 'node:child_process'].includes(node.source?.value)) {
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier') imports.set(spec.local.name, spec.imported.name || spec.imported.value);
          else if (spec.local?.name) moduleNames.add(spec.local.name);
        }
      }
    });
    const mark = (sink, node, origins, unconditional = false) => {
      if (!unconditional && !origins.size) return;
      const line = node.loc?.start?.line || 1;
      const key = sink + ':' + node.start;
      if (reported.has(key)) return;
      reported.add(key);
      const sourceList = [...origins].sort();
      violations.push((unconditional ? 'Dangerous execution sink' : 'Tainted data reaches sink') + ': ' + sink + ' at line ' + line);
      flows.push({ sink, line, sources: sourceList, kind: unconditional ? 'unconditional-sink' : 'taint-flow' });
      for (const source of sourceList) {
        if (edges.length < MAX_IR_EDGES) edges.push({ from: source, to: sink, line });
      }
    };
    const unknown = msg => { if (!unknowns.includes(msg)) unknowns.push(msg); };
    const isExec = name => EXEC_METHODS.has(imports.get(name)) ||
      [...moduleNames].some(mod => name?.startsWith(mod + '.') && EXEC_METHODS.has(name.slice(mod.length + 1))) ||
      /^require\(['"](?:node:)?child_process['"]\)\.(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)$/.test(name || '');
    const isGlobalEval = name => ['eval', 'Function', 'globalThis.eval', 'globalThis.Function', 'window.eval', 'window.Function'].includes(name);

    function evaluate(node, env, depth = 0) {
      if (!node || typeof node !== 'object') return new Set();
      if (depth > MAX_CALL_DEPTH * 3) { unknown('Expression depth exceeded'); return new Set(); }
      const next = x => evaluate(x, env, depth + 1);
      switch (node.type) {
        case 'Identifier': return env.has(node.name) ? new Set(env.get(node.name)) :
          USER_INPUTS.has(node.name) ? new Set([node.name]) : new Set();
        case 'MemberExpression':
        case 'OptionalMemberExpression': {
          const name = memberName(node);
          if (name === 'document.cookie' || name === 'window.document.cookie') {
            mark('document.cookie', node, new Set(['document.cookie']), true);
            return new Set(['document.cookie']);
          }
          if (/^(?:process\.env|import\.meta\.env|window\.location|document\.location)(?:\.|$)/.test(name || ''))
            return new Set([name]);
          if (node.computed && !property(node.property)) {
            const key = next(node.property);
            if (key.size) unknown('Dynamic property access at line ' + (node.loc?.start?.line || 1));
            return union(next(node.object), key);
          }
          return next(node.object);
        }
        case 'CallExpression':
        case 'OptionalCallExpression':
        case 'NewExpression': {
          const name = memberName(node.callee);
          const args = (node.arguments || []).map(a => next(a));
          const all = union(...args);
          if (isGlobalEval(name) || imports.get(name) === 'eval') mark(name || 'eval', node, all, true);
          if (isExec(name)) mark(name, node, all);
          if (name === 'setTimeout' || name === 'setInterval') mark(name, node, args[0] || new Set());
          if (name?.endsWith('.insertAdjacentHTML')) mark(name, node, args[1] || new Set());
          if (['document.write', 'document.writeln'].includes(name)) mark(name, node, all);
          if (name && functions.has(name)) {
            if (depth > MAX_CALL_DEPTH) { unknown('Call depth exceeded for ' + name); return all; }
            if (callGraph.length < MAX_IR_EDGES) callGraph.push({ callee: name, line: node.loc?.start?.line || 1 });
            return executeFunction(functions.get(name), args, env, depth + 1);
          }
          if (node.callee?.type === 'Identifier' && env.has('$sink:' + name)) {
            mark(name, node, all, true);
          }
          if (!name && all.size) unknown('Unresolved dynamic call at line ' + (node.loc?.start?.line || 1));
          // Unknown function results may preserve taint; absence of a finding is not a policy approval.
          return all;
        }
        case 'AssignmentExpression': {
          const value = next(node.right);
          if (node.left.type === 'Identifier') bind(node.left, value, env, edges, node.loc?.start?.line || 1);
          else {
            const name = memberName(node.left);
            if (name?.endsWith('.innerHTML') || name?.endsWith('.outerHTML') || name?.endsWith('.srcdoc')) mark(name, node, value);
            if (name === 'document.cookie') mark(name, node, value, true);
            next(node.left.object);
          }
          return value;
        }
        case 'TemplateLiteral': return union(...node.expressions.map(next));
        case 'BinaryExpression': case 'LogicalExpression': return union(next(node.left), next(node.right));
        case 'ConditionalExpression': return union(next(node.test), next(node.consequent), next(node.alternate));
        case 'ArrayExpression': return union(...node.elements.map(next));
        case 'ObjectExpression': return union(...node.properties.map(p => next(p.value || p.argument)));
        case 'SequenceExpression': return union(...node.expressions.map(next));
        case 'UnaryExpression': case 'AwaitExpression': case 'YieldExpression':
        case 'SpreadElement': case 'TSAsExpression': case 'TSTypeAssertion':
        case 'TSNonNullExpression': case 'ParenthesizedExpression': return next(node.argument || node.expression);
        case 'TaggedTemplateExpression': return next(node.quasi);
        case 'UpdateExpression': return next(node.argument);
        default: return new Set();
      }
    }
    function executeFunction(fn, args, closureEnv, depth) {
      if (depth > MAX_CALL_DEPTH) { unknown('Interprocedural call budget exceeded'); return union(...args); }
      const scope = clone(closureEnv);
      (fn.params || []).forEach((p, i) => bind(p, args[i] || new Set(), scope, edges, fn.loc?.start?.line || 1));
      const returns = [];
      const body = fn.body?.type === 'BlockStatement' ? fn.body.body : null;
      if (body) runStatements(body, scope, returns, depth);
      else returns.push(evaluate(fn.body, scope, depth));
      return union(...returns);
    }
    function runStatements(statements, env, returns, depth = 0) {
      for (const stmt of statements || []) {
        if (!stmt) continue;
        const line = stmt.loc?.start?.line || 1;
        switch (stmt.type) {
          case 'BlockStatement': runStatements(stmt.body, env, returns, depth); break;
          case 'VariableDeclaration':
            for (const decl of stmt.declarations) {
              if (decl.id?.type === 'Identifier' && decl.init?.type === 'CallExpression' &&
                decl.init.callee?.name === 'require' && ['child_process', 'node:child_process'].includes(decl.init.arguments?.[0]?.value))
                moduleNames.add(decl.id.name);
              const value = evaluate(decl.init, env, depth);
              bind(decl.id, value, env, edges, line);
              const assigned = decl.id?.name;
              const sinkAlias = memberName(decl.init);
              if (assigned && (isGlobalEval(sinkAlias) || isExec(sinkAlias))) env.set('$sink:' + assigned, new Set([sinkAlias]));
            }
            break;
          case 'ExpressionStatement': evaluate(stmt.expression, env, depth); break;
          case 'ReturnStatement': returns.push(evaluate(stmt.argument, env, depth)); break;
          case 'ThrowStatement': evaluate(stmt.argument, env, depth); break;
          case 'IfStatement': {
            evaluate(stmt.test, env, depth);
            const left = clone(env), right = clone(env);
            runStatements(stmt.consequent.type === 'BlockStatement' ? stmt.consequent.body : [stmt.consequent], left, returns, depth);
            if (stmt.alternate) runStatements(stmt.alternate.type === 'BlockStatement' ? stmt.alternate.body : [stmt.alternate], right, returns, depth);
            mergeEnv(env, left, right); break;
          }
          case 'ForStatement': case 'WhileStatement': case 'DoWhileStatement':
          case 'ForOfStatement': case 'ForInStatement': {
            const prior = clone(env), loop = clone(env);
            if (stmt.init?.type === 'VariableDeclaration') runStatements([stmt.init], loop, returns, depth);
            else evaluate(stmt.init || stmt.left, loop, depth);
            evaluate(stmt.test || stmt.right, loop, depth);
            runStatements(stmt.body?.type === 'BlockStatement' ? stmt.body.body : [stmt.body], loop, returns, depth);
            evaluate(stmt.update, loop, depth);
            mergeEnv(env, prior, loop); break;
          }
          case 'TryStatement': {
            const attempted = clone(env), caught = clone(env);
            runStatements(stmt.block?.body, attempted, returns, depth);
            runStatements(stmt.handler?.body?.body, caught, returns, depth);
            mergeEnv(env, attempted, caught);
            if (stmt.finalizer) runStatements(stmt.finalizer.body, env, returns, depth); break;
          }
          case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration':
            if (stmt.declaration) runStatements([stmt.declaration], env, returns, depth); break;
          case 'FunctionDeclaration': case 'ImportDeclaration': break;
          default:
            // Unsupported control flow must not silently produce a safe verdict.
            unknown('Unsupported statement ' + stmt.type + ' at line ' + line);
        }
      }
    }
    const root = new Map();
    runStatements(ast.program.body, root, [], 0);
    // Scan uncalled functions for direct sinks, but do not assume unknown callers are safe.
    for (const fn of functions.values()) executeFunction(fn, [], root, 0);
  } catch (error) {
    unknown(error instanceof Error ? error.message : 'Analysis failed');
  }
  return result(violations.length ? 'findings' : unknowns.length ? 'unknown' : 'no-known-flow');
}
