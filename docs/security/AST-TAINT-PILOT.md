# AST/IR taint pilot (advisory only)

This pilot implements a bounded JavaScript/TypeScript source analyzer in
src/security/ast_taint_analyzer.mjs, with a typed public facade at
src/security/ast_taint_analyzer.ts.

## Interface

analyzePayloadAST(sourceText) accepts a source-code string and returns:

- isSafe: compatibility field, true only for no-known-flow. Not a security certification or authorization.
- status: findings, unknown, no-known-flow, or parse-error.
- violations and flows: evidence with sink name, source origins and line numbers.
- ir: bounded source-to-binding/sink edges and observed same-file caller-callee edges.
- unknowns and coverage: unmodeled constructs, resource limits, and parser scope.

The module never runs the analyzed code. It handles JS, TS and JSX parsed by
Babel 7; it does not parse shell, Python, YAML, or other languages. No browser
or model use, external code upload, network calls, secrets, or paid inference.

## Implemented sources and sinks

Known untrusted identifiers: req, request, event, payload, params,
input, userInput, message, webhook. It recognizes process.env,
import.meta.env, and browser location as sensitive origins.

Execution sinks: direct/qualified/aliased eval, Function, imported or
namespace node:child_process shell methods, and tainted string timer calls.
DOM sinks: innerHTML, outerHTML, srcdoc, insertAdjacentHTML,
document.write/writeln, plus sensitive document.cookie access.

The IR walks assignments, destructuring, expressions, templates, branches,
and same-file named/arrow function arguments and returns. Tainted computed
dynamic dispatch is reported as unknown, not cleared.

## Limits and deployment posture

This is a bounded pilot, not a whole-program analyzer. It is not path-,
field-, or context-sensitive; same-name bindings may be conflated and function
returns are approximations. Imported callees other than built-in sink aliases,
callbacks, asynchronous continuations, dynamic dispatch, reflection, complex
method receivers, and cross-file code are not fully modeled. It does not
prove absence of exploits. Source-code snippets rather than arbitrary JSON
values are expected; JSON payloads must not be interpreted as executable code.

The node/size/depth/IR budgets limit work; unsupported control flow or dynamic
dispatch can yield an unknown result. All findings remain advisory. The
scanner is not connected to protected release admission, credential grants,
GitHub writes or deployment authorization. No new permissions are introduced.

Dependencies are exact-pinned in the npm lockfile. The pre-existing audited
dependency graph digest is retained; additions have separately checked
integrity metadata and remain subject to CI's npm audit.

## Replay and next increments

Run: node --test test/ast-taint-analyzer.test.mjs (after npm ci).
The corpus covers positives, constants, aliases, direct and imported sinks,
computed properties, same-file calls, TypeScript, syntax rejection, unknown
dynamic dispatch and non-execution.

Next work for issue #349: add held-out fixtures with ground truth, compare
against the existing deterministic scanner, measure precision/recall/false
negatives and latency, add cross-file summary graphs and SARIF, and decide
whether an opt-in no-cost fallback is justified. None of those later
capabilities are claimed complete by this PR.
