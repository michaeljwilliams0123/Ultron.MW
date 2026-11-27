import { parse } from '@babel/parser';

// Advisory, bounded JS/TS analysis. This code only parses source; it never evaluates it.
export const TAINT_IR_VERSION = 'ultron.taint-ir.v1';
const MAX_BYTES = 64 * 1024;
const MAX_NODES = 8000;
const MAX_CALL_DEPTH = 12;
const MAX_IR_EDGES = 1000;
const MAX_LOOP_PASSES = 4;
const MAX_EVALUATION_STEPS = 40000;
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
function sameEnv(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, values] of a) {
    const other = b.get(key);
    if (!other || values.size !== other.size || [...values].some(value => !other.has(value))) return false;
  }
  return true;
}
// Only expression-bodied callbacks with a deliberately small, side-effect-free AST
// are modeled as literal-array map operations. Everything else retains uncertainty.
function pureCallbackExpression(node) {
  if (!node) return false;
  switch (node.type) {
    case 'Identifier': case 'NumericLiteral': case 'StringLiteral':
    case 'BooleanLiteral': case 'NullLiteral': return true;
    case 'BinaryExpression': return ['+','-','*','/','%','**','===','!==','<','>','<=','>='].includes(node.operator) && pureCallbackExpression(node.left) && pureCallbackExpression(node.right);
    case 'LogicalExpression': return pureCallbackExpression(node.left) && pureCallbackExpression(node.right);
    case 'ConditionalExpression': return pureCallbackExpression(node.test) && pureCallbackExpression(node.consequent) && pureCallbackExpression(node.alternate);
    case 'UnaryExpression': return ['!','+','-','~','typeof','void'].includes(node.operator) && pureCallbackExpression(node.argument);
    default: return false;
  }
}
function literalMapCallback(node) {
  const callee = node.callee, fn = node.arguments?.[0];
  return node.type === 'CallExpression' && callee?.type === 'MemberExpression' &&
    !callee.computed && callee.property?.name === 'map' && callee.object?.type === 'ArrayExpression' &&
    node.arguments.length === 1 && fn?.type === 'ArrowFunctionExpression' && !fn.async &&
    fn.params.length <= 3 && fn.params.every(p => p.type === 'Identifier') && pureCallbackExpression(fn.body);
}
function mergeEnv(target, a, b) {
  for (const key of new Set([...a.keys(), ...b.keys()])) target.set(key, union(a.get(key), b.get(key)));
}

export function analyzePayloadAST(codeSnippet) {
  const violations = [];
  const flows = [];
  const edges = [];
  const callGraph = [];
  const activeCalls = [];
  const unknowns = [];
  const reported = new Set();
  const functions = new Map();
  const lexicalSinks = [];
  const callbacks = [];
  const imports = new Map();
  const moduleNames = new Set(['child_process']);
  let nodes = 0;
  let evaluationSteps = 0;

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
  const unknown = msg => { if (!unknowns.includes(msg)) unknowns.push(msg); };
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
      if (['CallExpression', 'NewExpression', 'OptionalCallExpression'].includes(node.type)) {
        if (['eval', 'Function', 'globalThis.eval', 'globalThis.Function', 'window.eval', 'window.Function'].includes(memberName(node.callee)))
          lexicalSinks.push({ sink: memberName(node.callee), node });
        if (!literalMapCallback(node) && node.arguments?.some(arg => ['ArrowFunctionExpression', 'FunctionExpression'].includes(arg?.type)))
          callbacks.push(node.loc?.start?.line || 1);
      }
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type) &&
        ['document.cookie', 'window.document.cookie'].includes(memberName(node)))
        lexicalSinks.push({ sink: 'document.cookie', node });
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
    if (callbacks.length) unknown('Callback analysis incomplete at lines ' + [...new Set(callbacks)].join(','));
    const isExec = name => EXEC_METHODS.has(imports.get(name)) ||
      [...moduleNames].some(mod => name?.startsWith(mod + '.') && EXEC_METHODS.has(name.slice(mod.length + 1))) ||
      /^require\(['"](?:node:)?child_process['"]\)\.(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)$/.test(name || '');
    const isGlobalEval = name => ['eval', 'Function', 'globalThis.eval', 'globalThis.Function', 'window.eval', 'window.Function'].includes(name);
    const registerDestructuredImports = (pattern, sourceIsChildProcess) => {
      if (!sourceIsChildProcess || pattern?.type !== 'ObjectPattern') return;
      for (const spec of pattern.properties) {
        if (spec.type !== 'ObjectProperty') continue;
        const imported = spec.computed ? property(spec.key) : spec.key?.name ?? spec.key?.value;
        const binding = spec.value?.type === 'AssignmentPattern' ? spec.value.left : spec.value;
        if (EXEC_METHODS.has(imported) && binding?.type === 'Identifier')
          imports.set(binding.name, imported);
      }
    };

    function evaluate(node, env, depth = 0) {
      if (!node || typeof node !== 'object') return new Set();
      if (++evaluationSteps > MAX_EVALUATION_STEPS) throw Error('Evaluation budget exceeded');
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
          if (literalMapCallback(node)) {
            const receiver = next(node.callee.object);
            const value = executeFunction(node.arguments[0], [receiver, new Set(), receiver], env, depth + 1, '<literal-array-map>');
            // Conservatively preserve input and callback-result taint.
            return union(receiver, value);
          }
          // Inspect unsupported callback bodies as well as retaining the lexical
          // coverage warning. Unknown callers may supply untrusted values.
          for (const arg of node.arguments || []) {
            if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(arg?.type)) continue;
            const origins = union(all, new Set(['unknown-callback-input']));
            executeFunction(arg, (arg.params || []).map(() => origins), env, depth + 1, '<unknown-callback>');
          }
          if (isGlobalEval(name) || imports.get(name) === 'eval') mark(name || 'eval', node, all, true);
          if (isExec(name)) mark(name, node, all);
          if (name === 'setTimeout' || name === 'setInterval') mark(name, node, args[0] || new Set());
          if (name?.endsWith('.insertAdjacentHTML')) mark(name, node, args[1] || new Set());
          if (['document.write', 'document.writeln'].includes(name)) mark(name, node, all);
          if (name && functions.has(name)) {
            if (depth > MAX_CALL_DEPTH) { unknown('Call depth exceeded for ' + name); return all; }
            if (callGraph.length < MAX_IR_EDGES) callGraph.push({ caller: activeCalls.at(-1) || '<module>', callee: name, line: node.loc?.start?.line || 1 });
            return executeFunction(functions.get(name), args, env, depth + 1, name);
          }
          if (node.callee?.type === 'Identifier' && env.has('$sink:' + name)) {
            mark(name, node, all, true);
          }
          if (all.size && name && !isExec(name) && !isGlobalEval(name) &&
            imports.get(name) !== 'eval' && !functions.has(name) &&
            !(node.callee?.type === 'Identifier' && env.has('$sink:' + name)))
            unknown('Tainted data passed to unresolved call ' + name + ' at line ' + (node.loc?.start?.line || 1));
          if (!name && union(all, next(node.callee)).size) unknown('Unresolved dynamic call at line ' + (node.loc?.start?.line || 1));
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
    function executeFunction(fn, args, closureEnv, depth, name = '<anonymous>') {
      if (depth > MAX_CALL_DEPTH) { unknown('Interprocedural call budget exceeded'); return union(...args); }
      activeCalls.push(name);
      try {
      const scope = clone(closureEnv);
      (fn.params || []).forEach((p, i) => bind(p, args[i] || new Set(), scope, edges, fn.loc?.start?.line || 1));
      const returns = [];
      const body = fn.body?.type === 'BlockStatement' ? fn.body.body : null;
      if (body) runStatements(body, scope, returns, depth);
      else returns.push(evaluate(fn.body, scope, depth));
      return union(...returns);
      } finally { activeCalls.pop(); }
    }
    function runStatements(statements, env, returns, depth = 0, loopContinues = null) {
      for (const stmt of statements || []) {
        if (!stmt) continue;
        if (++evaluationSteps > MAX_EVALUATION_STEPS) throw Error('Evaluation budget exceeded');
        const line = stmt.loc?.start?.line || 1;
        switch (stmt.type) {
          case 'BlockStatement': runStatements(stmt.body, env, returns, depth, loopContinues); break;
          case 'ContinueStatement':
            if (stmt.label || !loopContinues) unknown('Unsupported statement ContinueStatement at line ' + line);
            else { loopContinues.push(clone(env)); return; }
            break;
          case 'VariableDeclaration':
            for (const decl of stmt.declarations) {
              const requiredModule = decl.init?.type === 'CallExpression' && decl.init.callee?.name === 'require'
                ? decl.init.arguments?.[0]?.value
                : null;
              const isChildProcessRequire = ['child_process', 'node:child_process'].includes(requiredModule);
              if (decl.id?.type === 'Identifier' && isChildProcessRequire)
                moduleNames.add(decl.id.name);
              else if (decl.id?.type === 'Identifier' && decl.init?.type === 'Identifier' && moduleNames.has(decl.init.name))
                moduleNames.add(decl.id.name);
              const sourceIsChildProcess = isChildProcessRequire ||
                (decl.init?.type === 'Identifier' && moduleNames.has(decl.init.name));
              registerDestructuredImports(decl.id, sourceIsChildProcess);
              const value = evaluate(decl.init, env, depth);
              bind(decl.id, value, env, edges, line);
              const assigned = decl.id?.name;
              const sinkAlias = memberName(decl.init);
              if (assigned && decl.init?.type === 'Identifier' && imports.has(decl.init.name))
                imports.set(assigned, imports.get(decl.init.name));
              if (assigned && (isGlobalEval(sinkAlias) || isExec(sinkAlias))) env.set('$sink:' + assigned, new Set([sinkAlias]));
            }
            break;
          case 'ExpressionStatement': evaluate(stmt.expression, env, depth); break;
          case 'ReturnStatement': returns.push(evaluate(stmt.argument, env, depth)); break;
          case 'ThrowStatement': evaluate(stmt.argument, env, depth); break;
          case 'IfStatement': {
            evaluate(stmt.test, env, depth);
            const left = clone(env), right = clone(env);
            runStatements(stmt.consequent.type === 'BlockStatement' ? stmt.consequent.body : [stmt.consequent], left, returns, depth, loopContinues);
            if (stmt.alternate) runStatements(stmt.alternate.type === 'BlockStatement' ? stmt.alternate.body : [stmt.alternate], right, returns, depth, loopContinues);
            mergeEnv(env, left, right); break;
          }
          case 'ForStatement': case 'WhileStatement': case 'DoWhileStatement':
          case 'ForOfStatement': case 'ForInStatement': {
            const prior = clone(env), entry = clone(env);
            if (stmt.init?.type === 'VariableDeclaration') runStatements([stmt.init], entry, returns, depth);
            else evaluate(stmt.init, entry, depth);
            const iterating = stmt.type === 'ForOfStatement' || stmt.type === 'ForInStatement';
            const iterableOrigins = iterating ? evaluate(stmt.right, entry, depth) : null;
            let state = entry, stable = false;
            for (let pass = 0; pass < MAX_LOOP_PASSES; pass++) {
              const loop = clone(state), continues = [];
              if (iterating) {
                const origins = iterableOrigins;
                if (stmt.left?.type === 'VariableDeclaration') {
                  for (const decl of stmt.left.declarations) bind(decl.id, origins, loop, edges, line);
                } else if (stmt.left?.type === 'Identifier' || stmt.left?.type === 'ObjectPattern' || stmt.left?.type === 'ArrayPattern') bind(stmt.left, origins, loop, edges, line);
                else unknown('Unsupported loop binding at line ' + line);
              } else if (stmt.type !== 'DoWhileStatement') evaluate(stmt.test, loop, depth);
              runStatements(stmt.body?.type === 'BlockStatement' ? stmt.body.body : [stmt.body], loop, returns, depth, continues);
              for (const skipped of continues) mergeEnv(loop, loop, skipped);
              if (stmt.type === 'DoWhileStatement') evaluate(stmt.test, loop, depth);
              evaluate(stmt.update, loop, depth);
              const joined = clone(state);
              mergeEnv(joined, state, loop);
              if (sameEnv(joined, state)) { stable = true; state = joined; break; }
              state = joined;
            }
            if (!stable) unknown('Loop analysis budget exceeded at line ' + line);
            mergeEnv(env, prior, state); break;
          }
          case 'TryStatement': {
            const attempted = clone(env), caught = clone(env);
            runStatements(stmt.block?.body, attempted, returns, depth, loopContinues);
            runStatements(stmt.handler?.body?.body, caught, returns, depth, loopContinues);
            mergeEnv(env, attempted, caught);
            if (stmt.finalizer) {
              // A finally block can alter a pending continue; do not certify that
              // complex control flow with the bounded loop model.
              if (loopContinues) unknown('Unsupported statement TryFinallyInLoop at line ' + line);
              runStatements(stmt.finalizer.body, env, returns, depth, loopContinues);
            } break;
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
    for (const [name, fn] of functions) executeFunction(fn, [], root, 0, name);
    for (const hit of lexicalSinks) mark(hit.sink, hit.node, new Set(), true);
  } catch (error) {
    unknown(error instanceof Error ? error.message : 'Analysis failed');
  }
  return result(violations.length ? 'findings' : unknowns.length ? 'unknown' : 'no-known-flow');
}
