/** Typed facade for the Node ESM AST/IR pilot. Runtime implementation remains .mjs for Node >=20. */
export interface TaintFlow {
  sink: string;
  line: number;
  sources: string[];
  kind: 'unconditional-sink' | 'taint-flow';
}
export interface TaintAnalysisResult {
  schema: 'ultron.taint-ir.v1';
  isSafe: boolean;
  status: 'findings' | 'unknown' | 'no-known-flow' | 'parse-error';
  violations: string[];
  flows: TaintFlow[];
  ir: {
    edges: { from: string; to: string; line: number }[];
    callGraph: { caller: string; callee: string; line: number }[];
  };
  unknowns: string[];
  coverage: { parsed: boolean; visitedNodes: number; language: string; scope: string };
}
export { analyzePayloadAST, TAINT_IR_VERSION } from './ast_taint_analyzer.mjs';
